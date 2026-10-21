"""
Osintfront Telegram worker — runs on your own computer.

Logs in to YOUR Telegram account (you type the phone number, login code and
2-step password yourself, once; the session stays in this folder only), reads
your Telegram tabs (folders), and treats each tab as one "agent": every new
post in a channel of that tab is sent to the Osintfront ingest endpoint, which
classifies it, de-duplicates it, translates it and puts it on the map.

Read-only: this script never sends, reads-marks, joins or leaves anything.

Run:  start.bat   (or: python worker.py)
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from telethon import TelegramClient, events, functions, types

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / "state.json"
SESSION = str(HERE / "osintfront")  # -> osintfront.session (keep it private: it is a login to your account)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(HERE / "worker.log", encoding="utf-8")],
)
log = logging.getLogger("worker")
logging.getLogger("telethon").setLevel(logging.WARNING)


# ─── Config ──────────────────────────────────────────────────────────────
def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = HERE / ".env"
    if not path.exists():
        sys.exit("Missing .env — copy .env.example to .env and fill in API_ID, API_HASH and INGEST_TOKEN.")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    for k in ("API_ID", "API_HASH", "INGEST_URL", "INGEST_TOKEN"):
        if not env.get(k):
            sys.exit(f".env: {k} is empty")
    return env


ENV = load_env()
WANTED_FOLDERS = {f.strip() for f in ENV.get("FOLDERS", "").split("|") if f.strip()}
INCLUDE_GROUPS = ENV.get("INCLUDE_GROUPS", "0") == "1"
CATCH_UP_HOURS = float(ENV.get("CATCH_UP_HOURS", "2") or 2)
# Claude API use per channel type: full = classify + Sonnet editor (translation, places),
# light = classify only (cheap; used only for Hebrew posts — other languages still get the editor),
# off = ignore that type.
PUBLIC_MODE = (ENV.get("PUBLIC_MODE", "light") or "light").lower()
PRIVATE_MODE = (ENV.get("PRIVATE_MODE", "full") or "full").lower()
MIN_TEXT = int(ENV.get("MIN_TEXT", "25") or 25)
FOLDER_REFRESH_SEC = 600
BATCH = 10
MAX_IMAGE = 1_900_000


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"last_id": {}}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    tmp.replace(STATE_FILE)


STATE = load_state()


# ─── Ingest endpoint ─────────────────────────────────────────────────────
def _post(body: dict, timeout: int = 150) -> dict:
    req = urllib.request.Request(
        ENV["INGEST_URL"],
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-ingest-token": ENV["INGEST_TOKEN"]},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8") or "{}")


async def post(body: dict) -> dict:
    return await asyncio.to_thread(_post, body)


# ─── Folders (tabs) → agents ─────────────────────────────────────────────
class Channels:
    """channel_id -> {title, username, folder, broadcast}"""

    def __init__(self) -> None:
        self.by_id: dict[int, dict] = {}

    def __contains__(self, cid: int) -> bool:
        return cid in self.by_id


CHANNELS = Channels()


def _title(t) -> str:
    return getattr(t, "text", t) or ""


async def load_folders(client: TelegramClient) -> list[dict]:
    # Every channel/group you are in, by id (folders refer to them by id).
    known: dict[int, types.Channel] = {}
    async for d in client.iter_dialogs():
        if isinstance(d.entity, types.Channel):
            known[d.entity.id] = d.entity

    res = await client(functions.messages.GetDialogFiltersRequest())
    filters = getattr(res, "filters", res)
    folders: list[dict] = []
    by_id: dict[int, dict] = {}
    for f in filters:
        if not isinstance(f, (types.DialogFilter, getattr(types, "DialogFilterChatlist", types.DialogFilter))):
            continue  # "All chats"
        name = _title(f.title).strip()
        if not name or (WANTED_FOLDERS and name not in WANTED_FOLDERS):
            continue
        # Rule-only tabs like "Unread" (all unread chats) are not a topic: skip unless named in FOLDERS.
        if getattr(f, "exclude_read", False) and name not in WANTED_FOLDERS:
            log.info("Skipping tab '%s' (an 'unread' rule tab, not a topic)", name)
            continue
        ids: list[int] = []
        for p in list(getattr(f, "pinned_peers", []) or []) + list(getattr(f, "include_peers", []) or []):
            if isinstance(p, types.InputPeerChannel):
                ids.append(p.channel_id)
        # Folder rules like "all channels" / "all groups".
        if getattr(f, "broadcasts", False):
            ids += [cid for cid, e in known.items() if e.broadcast]
        if getattr(f, "groups", False):
            ids += [cid for cid, e in known.items() if e.megagroup]
        excluded = {p.channel_id for p in (getattr(f, "exclude_peers", []) or []) if isinstance(p, types.InputPeerChannel)}
        chans = []
        for cid in dict.fromkeys(ids):
            e = known.get(cid)
            if not e or cid in excluded:
                continue
            if not e.broadcast and not INCLUDE_GROUPS:
                continue  # groups/chats are skipped unless INCLUDE_GROUPS=1
            info = {"id": str(cid), "title": e.title or "", "username": e.username or ""}
            chans.append(info)
            by_id.setdefault(cid, {**info, "folder": name, "broadcast": bool(e.broadcast)})
        folders.append({"name": name, "channels": chans})
    CHANNELS.by_id = by_id
    return folders


async def sync_folders(client: TelegramClient) -> None:
    folders = await load_folders(client)
    log.info("Tabs: %s", ", ".join(f"{f['name']} ({len(f['channels'])})" for f in folders) or "none")
    try:
        await post({"telegram_folders": folders})
    except Exception as e:
        log.warning("Could not report tabs to the site: %s", e)


# ─── Posts ───────────────────────────────────────────────────────────────
QUEUE: asyncio.Queue = asyncio.Queue()


# ─── Free filters (no API) ───────────────────────────────────────────────
SEEN_TEXT: dict[str, float] = {}  # normalised text hash -> time first sent
DEDUPE_SEC = 3 * 3600
_URL = re.compile(r"https?://\S+|t\.me/\S+|@\w+")
_NONWORD = re.compile(r"[^\w\u0590-\u05FF\u0600-\u06FF]+")
_HEBREW = re.compile(r"[\u0590-\u05FF]")
_LETTER = re.compile(r"[^\W\d_]")


def text_key(text: str) -> str:
    """Same post forwarded/copied by several channels -> same key."""
    t = _NONWORD.sub(" ", _URL.sub(" ", text.lower())).split()
    return hashlib.sha1(" ".join(t)[:400].encode("utf-8")).hexdigest()


def is_hebrew(text: str) -> bool:
    letters = _LETTER.findall(text)
    return bool(letters) and len(_HEBREW.findall(text)) / len(letters) >= 0.6


def worth_sending(text: str) -> bool:
    core = _URL.sub(" ", text).strip()
    if len(core) < MIN_TEXT:
        return False  # bare link, emoji, "📌", channel promo line…
    now = time.time()
    for k, t in list(SEEN_TEXT.items()):
        if now - t > DEDUPE_SEC:
            del SEEN_TEXT[k]
    key = text_key(core)
    if key in SEEN_TEXT:
        return False  # the same text already went out from another channel
    SEEN_TEXT[key] = now
    return True


def post_text(msg: types.Message) -> str:
    text = msg.message or ""
    # Hidden links (text with a link behind it): add the address so sources keep their URL.
    urls = [e.url for e in (msg.entities or []) if isinstance(e, types.MessageEntityTextUrl) and e.url]
    extra = [u for u in dict.fromkeys(urls) if u not in text]
    if extra:
        text += "\n" + "\n".join(extra)
    return text.strip()


async def to_payload(client: TelegramClient, msg: types.Message, cid: int) -> dict | None:
    ch = CHANNELS.by_id.get(cid)
    text = post_text(msg)
    if not ch:
        return None
    mode = PUBLIC_MODE if ch["username"] else PRIVATE_MODE
    if mode == "off" or not worth_sending(text):
        return None
    light = mode == "light" and is_hebrew(text)
    username = ch["username"]
    media = []
    if msg.photo or msg.video:
        try:
            data = await client.download_media(msg, file=bytes, thumb=-1 if msg.video else None)
            if data and len(data) <= MAX_IMAGE:
                media.append({"kind": "video_thumb" if msg.video else "image", "mime": "image/jpeg", "data": base64.b64encode(data).decode()})
        except Exception as e:
            log.debug("media skipped: %s", e)
    return {
        "msg_id": f"{username}/{msg.id}" if username else f"c{cid}/{msg.id}",
        "url": f"https://t.me/{username}/{msg.id}" if username else f"https://t.me/c/{cid}/{msg.id}",
        "platform": "telegram",
        "chat": ch["title"],
        "agent": ch["folder"],
        "sent_at": msg.date.astimezone(timezone.utc).isoformat(),
        "text": text[:8000],
        "media": media,
        "light": light,
        "_cid": cid,
        "_id": msg.id,
    }


async def sender() -> None:
    """Sends queued posts in small batches; on failure waits and retries (nothing is lost while running)."""
    while True:
        batch = [await QUEUE.get()]
        await asyncio.sleep(2)
        while not QUEUE.empty() and len(batch) < BATCH:
            batch.append(QUEUE.get_nowait())
        delay = 5
        while True:
            try:
                body = {"messages": [{k: v for k, v in m.items() if not k.startswith("_")} for m in batch]}
                res = await post(body)
                failed_ids = set()
                for r in res.get("results", []):
                    status = r.get("status")
                    if status == "error":
                        failed_ids.add(r.get("msg_id"))
                        log.warning("[%s] %s → error: %s", r.get("agent"), r.get("msg_id"), str(r.get("error", ""))[:160])
                    else:
                        log.info("[%s] %s → %s", r.get("agent"), r.get("msg_id"), status)
                for m in batch:
                    if m["msg_id"] in failed_ids:
                        continue
                    key = str(m["_cid"])
                    STATE["last_id"][key] = max(int(STATE["last_id"].get(key, 0)), m["_id"])
                save_state(STATE)
                # Server-side failure (e.g. Claude API out of credit or overloaded): keep the
                # failed posts and try them again later instead of losing them.
                batch = [m for m in batch if m["msg_id"] in failed_ids]
                if not batch:
                    break
                log.warning("%d post(s) failed on the site, retry in %ss", len(batch), delay)
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 403):
                    log.error("Site refused the posts (%s): %s — check INGEST_TOKEN. Skipping this batch.", e.code, e.read()[:200])
                    break
                log.warning("Site error %s, retry in %ss", e.code, delay)
            except Exception as e:
                log.warning("Send failed (%s), retry in %ss", e, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)


async def catch_up(client: TelegramClient) -> None:
    """Posts that came in while the worker was off (only since the last run, max CATCH_UP_HOURS)."""
    since = datetime.now(timezone.utc) - timedelta(hours=CATCH_UP_HOURS)
    first_run = not STATE["last_id"]
    for cid, ch in list(CHANNELS.by_id.items()):
        key = str(cid)
        try:
            if key not in STATE["last_id"]:
                # New channel: start from now, don't flood the map with its history.
                last = await client.get_messages(types.PeerChannel(cid), limit=1)
                STATE["last_id"][key] = last[0].id if last else 0
                continue
            msgs = await client.get_messages(types.PeerChannel(cid), limit=30, min_id=int(STATE["last_id"][key]))
            for m in reversed(msgs):
                if isinstance(m, types.Message) and m.date >= since:
                    p = await to_payload(client, m, cid)
                    if p:
                        await QUEUE.put(p)
        except Exception as e:
            log.warning("Catch-up %s: %s", ch.get("title"), e)
    save_state(STATE)
    if first_run:
        log.info("First run: starting from now (older posts are not sent).")


async def main() -> None:
    client = TelegramClient(SESSION, int(ENV["API_ID"]), ENV["API_HASH"], flood_sleep_threshold=120)
    await client.start()  # first time: asks for phone, code and 2-step password in this window
    me = await client.get_me()
    if getattr(me, "bot", False):
        # A bot token was typed at the phone prompt. Bots can't read your tabs or other channels.
        await client.log_out()  # removes the bot session file
        sys.exit("This logged in as a BOT. Run start.bat again and type your PHONE NUMBER (+972...), not a bot token.")
    log.info("Logged in as %s", me.first_name)

    try:
        ping = await post({"ping": True})
        if ping.get("client") != "worker":
            log.warning("Site answered, but not as the Telegram worker: %s", ping)
    except Exception as e:
        log.error("Cannot reach the site: %s", e)

    await sync_folders(client)
    asyncio.create_task(sender())
    await catch_up(client)

    @client.on(events.NewMessage())
    async def on_new(ev: events.NewMessage.Event) -> None:
        peer = ev.message.peer_id
        if not isinstance(peer, types.PeerChannel) or peer.channel_id not in CHANNELS:
            return
        p = await to_payload(client, ev.message, peer.channel_id)
        if p:
            await QUEUE.put(p)

    async def refresh() -> None:
        while True:
            await asyncio.sleep(FOLDER_REFRESH_SEC)
            try:
                await sync_folders(client)
            except Exception as e:
                log.warning("Tab refresh failed: %s", e)

    asyncio.create_task(refresh())
    log.info("Listening for new posts. Leave this window open (Ctrl+C to stop).")
    await client.run_until_disconnected()


if __name__ == "__main__":
    while True:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            break
        except SystemExit:
            raise
        except Exception as e:  # network drop etc.: restart after a pause
            log.error("Stopped: %s — restarting in 30 s", e)
            time.sleep(30)
