# Stage A — Access tiers (guest / free / pro / max)

Date: 2026-11-03 · Status: approved in chat, awaiting spec review
Follow-ups: Stage B (monthly token system) replaces the daily counters built here; Stage C (ads + Google terms).

## Goal
Open osintfront.com to everyone. Paid features (Pro/Max) need an account. A free account gives a little more than a guest, to encourage sign-up.

## Decisions (owner)
| Feature | Guest (no account) | Free (registered, verified) | Pro / Max |
|---|---|---|---|
| Live map + feed (24 h) | ✓ | ✓ | ✓ |
| Ships + aircraft | ✓ | ✓ | ✓ |
| Control map, Lebanon testimony layers | ✓ | ✓ | ✓ |
| "Expand" | ✗ (sign-up prompt) | 3 / day | per existing plan limits (until Stage B) |
| Satellite | greyed out (sign-up prompt) | 3 / day; 1 use = turning the layer on | ✓ |
| Archive | none (24 h live only) | 1 day back | 30 days / full |
| Push | ✗ (sign-up prompt) | high severity only | all levels |

- Every "expand" click counts, including events already expanded (cached).
- Sign-up: Google and email + password. Email verification required; until verified the user is treated as a guest. Google sign-ins count as verified.
- A feature whose daily allowance is used up opens an upgrade window inviting a paid plan when clicked. Paid billing is still off, so the window links to the plans/contact page.
- The 118 existing invited viewers (plan `free`) move to Pro with no expiry.
- Staff roles (analyst, admin, super_admin) are never limited (unchanged).

## Design
1. **Plans data** — new plan `guest` in `plans`; `plan_features` rows for `guest`; `free` updated per the table. `ships_aircraft` enabled for every plan. Admin Licensing page shows the guest column.
2. **Server counter** — table `feature_usage(user_id, feature_key, day, count)`; RPC `use_feature(key)` checks plan + verification, increments atomically, returns remaining or raises `quota_exceeded` / `signup_required`. `event-agent` "expand" calls it on every request (cached too). Satellite: the site calls it when the layer is turned on; on refusal the layer stays off. Stage B swaps this counter for tokens.
3. **Open access** — `/` without login; `/archive` stays login-only. RLS: guests read published events of the last 24 h only (today the `events: public archive` policy lets `anon` read everything).
4. **Sign-up** — sign-up tab + Google button on the login page; Supabase public sign-ups on, email confirmation on; `handle_new_auth_user` must create `viewer` + `free` for users who were not invited. Owner action: create a Google OAuth client and paste it into Supabase (instructions given at that step).
5. **UI** — lock + sign-up prompt for guests (expand, push, satellite); "2/3 left today" counter for free; upgrade window on exhaustion.
6. **Rollout** — Playwright tests on a Vercel preview as guest, free and pro; switch `enforce_plans` on only after they pass; existing viewers moved to Pro first.

## Error handling
- `use_feature` failure (network/DB) → feature refused with a retry message, never silently granted.
- Unverified email → treated as guest with a "verify your email" hint.

## Out of scope
Tokens (Stage B), ads/CMP (Stage C), paid checkout.
