// Category rules set by the editors, shared by every agent that picks a category
// (triage of Telegram / WhatsApp posts, the editor agent, quick compose, the news agents).

/** Never chosen by an agent: only the Home Front Command feed creates these. */
export const AGENT_EXCLUDED_CATEGORIES = new Set(["home-front-alerts", "other"]);

export const CATEGORY_RULES = `
Category rules (they override any other hint):
- force-sighting: ONLY foreign forces documented inside another country or territory — Israeli soldiers / tanks in Lebanon or Syria, Israeli units (IDF, Yamam, Border Police) raiding a Palestinian town (Hebron, Jenin, a West Bank village), US or Russian forces / aircraft in another country. Forces of a country inside that same country (Lebanese army in Lebanon, Iraqi security forces in Kirkuk, IRGC in Iran, IDF inside Israel), settlers, or a photo of commanders: military-activity (or another fitting kind).
- explosion: ONLY when an explosion actually happened (a blast heard or seen, a demolition, a device that went off, a ship hitting a mine). A bomb, shell, missile or device that was FOUND, defused, neutralised or detonated in a controlled way after being found: military-activity (or terror-security-incident) — not explosion.
- home-front-alerts: NEVER. It is only for real Israeli Home Front Command alerts, which come from their own feed. Reports about sirens or alerts (in Israel or abroad, e.g. sirens in Riyadh, alerts in Najran) take the kind of the threat: missile-rocket-attack, uav, drone or infiltration; emergency procedures, evacuations and air-defence activity without a threat named: military-activity / political-event.`;
