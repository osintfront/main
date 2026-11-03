# Stage C — Ads (Google AdSense)

Approved in chat 4 Nov 2026 (owner chose option A "combined"; feed ad every 3 events).

- Who: guests and Free viewers only. Pro/Max/staff: no ads; the app sets localStorage `ofm.adfree=1`, and index.html sets `adsbygoogle.pauseAdRequests=1` before Google's script (also stops Auto ads).
- Feed: AdSense in-feed unit (slot 3071595781, layout key -fb+5w+4e-db+86) after every `ads_feed_every` events (3), labelled "Advertisement" in a dashed frame unlike event cards; requested only near the viewport. None in the archive or on empty pages.
- Anchor (top/bottom, closable): Google Auto ads with only the Anchor format on — configured in AdSense by the owner, not in code.
- Popup on "expand" / "ask the map": dropped — AdSense forbids custom pop-ups and has no click-triggered rewarded format for sites (Offerwall gates whole pages; rewarded-on-click is Ad Manager only).
- Switches (app_settings, readable by everyone): `ads_enabled` (false until AdSense approves the site), `ads_feed_every`.
- Privacy policy and cookie notice describe AdSense, opt-out links and the EEA/UK/CH consent window (Google CMP, set up by the owner).
