// Category rules set by the editors, shared by every agent that picks a category
// (triage of Telegram / WhatsApp posts, the editor agent, quick compose, the news agents).

/** Never chosen by an agent: only the Home Front Command feed creates these. */
export const AGENT_EXCLUDED_CATEGORIES = new Set(["home-front-alerts", "other"]);

export const CATEGORY_RULES = `
Category rules (they override any other hint):
- force-sighting: ONLY foreign forces documented inside another country or territory — Israeli soldiers / tanks in Lebanon or Syria, Israeli units (IDF, Yamam, Border Police) raiding a Palestinian town (Hebron, Jenin, a West Bank village), US or Russian forces / aircraft in another country. Forces of a country inside that same country (Lebanese army in Lebanon, Iraqi security forces in Kirkuk, IRGC in Iran, IDF inside Israel), settlers, or a photo of commanders: military-activity (or another fitting kind).
- explosion: ONLY when an explosion actually happened (a blast heard or seen, a demolition, a device that went off, a ship hitting a mine). A bomb, shell, missile or device that was FOUND, defused, neutralised or detonated in a controlled way after being found: military-activity (or terror-security-incident) — not explosion.
- home-front-alerts: NEVER. It is only for real Israeli Home Front Command alerts, which come from their own feed. Reports about sirens or alerts (in Israel or abroad, e.g. sirens in Riyadh, alerts in Najran) take the kind of the threat: missile-rocket-attack, uav, drone or infiltration; emergency procedures, evacuations and air-defence activity without a threat named: military-activity / political-event.
- assassination: a targeted killing — an announcement that a specific person was the target and was killed (a commander killed in a strike on his car → main assassination, secondary killed).
- killed: people were killed and it is not a targeted killing → main killed, secondary the kind of the attack ("Three killed in an airstrike on X" → main killed, secondary airstrike).
- killed and wounded: main killed; secondary the kind of the attack and/or wounded ("An airstrike on X killed two and wounded five" → main killed, secondary airstrike, wounded).
- wounded only (nobody killed): the kind of the attack stays the main type, wounded is secondary ("Airstrike on X, two wounded" → main airstrike, secondary wounded).
- If anyone died in a violent incident (killed, dead, a body; נהרג / נהרגה / הרוגים / מת), killed is the main type (secondary for an assassination) — never Wounded alone ("A woman was killed and her children wounded in shelling on X" → main killed, secondary artillery-shelling, wounded).
- no kind of attack known: main killed, or wounded when nobody died ("Two bodies found in X" → main killed).
- Deaths not caused by violence (accident, illness, disaster) keep their own kind (fire, natural-disaster, infrastructure-incident…), not killed / wounded.
- A place is tagged with the kind of the attack there, never killed / wounded, unless the means is unknown.

Secondary types (secondary_category_slugs): other kinds of the SAME incident, at most two — e.g. the strike behind the dead, or forces seen at the strike site. Empty for most reports. Never the main type. Never a different incident in another place (that is a separate place with its own kind, and the report is split).
- A report that is a party's claim or announcement (a military, a group or its spokesman says it hit / destroyed something) → add statements as a secondary type; the attack itself stays the main type ("IRGC: an American radar in Bahrain was destroyed" → main missile-rocket-attack, secondary military-activity, statements).
- airstrike only when aircraft or drones struck. A target hit by missiles or rockets is not an airstrike.`;
