# Osintfront Telegram worker (Windows)

Reads the channels in your Telegram **tabs (folders)** — public and private — and sends new posts to the site. Each tab = one agent.

## One-time setup
1. **Python:** install from https://www.python.org/downloads/ (tick **"Add python.exe to PATH"**).
2. **Telegram API keys:** go to https://my.telegram.org → log in → **API development tools** → create an app (any name). Copy `api_id` and `api_hash` into `.env` (`API_ID=` / `API_HASH=`).
3. **Pick tabs (optional):** in `.env`, `FOLDERS=Lebanon|Iran|Yemen` (exact tab names). Empty = all tabs.
4. Double-click **`start.bat`**. First run installs what it needs, then asks in the window for your **phone number** (+972…), the **code** Telegram sends you, and your **2-step password** if you have one. You type these yourself.

After that, `start.bat` runs without asking. Leave the window open; posts arrive on the map within seconds. When the computer was off, it catches up on posts from the last `CATCH_UP_HOURS` (default 2).

## Good to know
- Files `osintfront.session` and `.env` = access to your Telegram account and to the site. Don't share or upload them. To cut access: Telegram → Settings → Devices → end the "Osintfront" session.
- Read-only: it never sends, marks as read, joins or leaves.
- Only channels by default. Group chats in a tab are skipped unless `INCLUDE_GROUPS=1`.
- New channel added to a tab → picked up within 10 minutes. A new channel starts from "now" (no history flood).
- Every post goes through classification + translation (Claude API). Many busy channels = higher API cost.
- Auto-start with Windows: press Win+R → `shell:startup` → put a shortcut to `start.bat` there.
- Log: `worker.log` in this folder.
