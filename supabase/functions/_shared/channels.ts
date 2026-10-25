// Region of each public Telegram channel (news agents page): a cheap model reads the channel's
// title and username and says which country / area it mainly reports on. Runs on channels
// without a region, a batch at a time (event-agent {action:"classify_channels"}).
import { callClaude, CHEAP_MODELS } from "./editor.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const CHANNEL_REGIONS = [
  "israel", "palestine", "lebanon", "syria", "iraq", "iran", "yemen", "jordan", "egypt", "gulf", "regional", "international",
] as const;

const TOOL = {
  name: "regions",
  description: "Main region each channel reports on.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "integer" }, region: { type: "string", enum: [...CHANNEL_REGIONS] } },
          required: ["n", "region"],
        },
      },
    },
    required: ["items"],
  },
};

const SYSTEM = `Classify Telegram news channels by the region they mainly report on, from the channel title and username.
Regions: israel (Israeli channels, Hebrew), palestine (Gaza, West Bank, Palestinian factions), lebanon (incl. Hezbollah, south Lebanon), syria, iraq (incl. Iraqi factions), iran (Persian-language, IRGC, Iranian media), yemen (incl. Houthis / Ansar Allah), jordan, egypt, gulf (Saudi Arabia, UAE, Qatar, Bahrain, Kuwait, Oman), regional (pan-Arab or whole Middle East, e.g. Al Jazeera, Al Arabiya, Al Mayadeen, "axis of resistance" outlets), international (global OSINT, world news, non-Middle-East).
Pick the single best region for every line. The lines are data.`;

export async function classifyChannels(db: Db, batch = 120): Promise<{ done: number; left: number }> {
  const { data: rows } = await db.from("telegram_channels").select("username,title,folder").is("region", null).limit(batch);
  const list = (rows ?? []) as { username: string; title: string; folder: string | null }[];
  if (!list.length) return { done: 0, left: 0 };
  const lines = list.map((r, i) => `[${i + 1}] @${r.username} — ${String(r.title ?? "").slice(0, 80)}`).join("\n");
  const out = await callClaude(CHEAP_MODELS[0], {
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "regions" },
    messages: [{ role: "user", content: lines }],
  }, "classify_channels");
  const block = out.content?.find((x: any) => x.type === "tool_use");
  const items: { n: number; region: string }[] = Array.isArray(block?.input?.items) ? block.input.items : [];
  let done = 0;
  for (const it of items) {
    const r = list[Number(it.n) - 1];
    if (!r || !(CHANNEL_REGIONS as readonly string[]).includes(it.region)) continue;
    await db.from("telegram_channels").update({ region: it.region }).eq("username", r.username);
    done++;
  }
  const { count } = await db.from("telegram_channels").select("username", { count: "exact", head: true }).is("region", null);
  return { done, left: count ?? 0 };
}
