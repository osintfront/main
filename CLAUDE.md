# Osintfront — working rules

## UX/UI check — fixed step in every feature

Before asking the owner to merge, every feature branch gets a UX/UI review of the screens it changes
(frontend-design guidance + Playwright screenshots). Check:

- desktop + mobile (390 px)
- Hebrew (RTL) + English
- dark + light
- guest / Free / Pro states, including the "not in your plan" upgrade window
- loading / empty / error states
- clear wording and buttons; tap targets large enough
- nothing hidden by the in-feed ad slots or the anchor ad

Report findings to the owner in Hebrew. Fix blockers before merge; list minor items in the branch ledger.
