# OFI Insights — design (approved 2026-11-06)

Experimental module: admin-defined events, each with a deterministic probability of happening
within its horizon (default 24 h), explained by weighted signals. Users only view.

## Decisions
- **Resolution (Iran event):** YES only for a direct strike — IDF/US forces strike Iranian territory,
  or Iran launches missiles/drones from its territory at Israel or a US target. Interceptions of
  Iranian projectiles and Iran-attributed proxy actions are high-weight *signals*, not occurrence.
- **Base rate:** 2% / 24 h (~16 days of direct exchanges in ~900 days, 2024 – mid 2026). Editable.
- **No LLM** anywhere. Free public sources only; one call per source per cycle; responses cached
  in `insight_source_cache`.
- **Schedule:** one `pg_cron` job every 15 min invokes `ofi-runner`, which handles events whose
  `next_run_at` is due. Internal-data signals (incl. HFC) refresh hourly at zero cost and feed the
  circuit breaker; external sources refresh every `refresh_interval_hours` (default 24).
  Page views never compute or call out.
- **Market horizon → 24 h:** `p24 = 1 − (1 − P)^(24 / H)`, H = hours left to the market's end date.

## Engine (phase 3, pure code)
- `logit(p) = logit(base) + Σ wᵢ · k · (sᵢ − 0.5) · fᵢ` — fᵢ = freshness (1 fresh → 0 stale).
- Market anchor: `logit(p) = (1 − α)·logit(p_signals) + α·logit(p_market24)`, α = 0.5 when fresh.
- Smoothing vs. previous cycle in logit space (0.6 new / 0.4 previous) unless a circuit breaker fires.
- Clamp 1%–95%. Confidence band from signal disagreement + stale weight share.
- Contributions in percentage points per signal. Full formula in `docs/ofi-model.md`.

## Data & access (phase 1 — done)
Tables: `insight_events`, `insight_signals`, `insight_signal_readings`, `insight_forecasts`,
`insight_resolutions`, `insight_lexicon`, `insight_source_cache`. RLS: super admin only.
Readers use security-definer functions that return only what their tier may see:

| Tier (`ofi_tier`) | Who | Gets |
|---|---|---|
| 0 | guest | card + title, no number |
| 1 | Free | probability, previous probability, last/next update, 1 teaser signal |
| 2 | Pro | + band, all contributions, signals with weights + 30-day readings, summary, 30-day history, sparkline |
| 3 | Max / Intel / staff | + full history, early-access events (`min_tier = 3`) |

`ofi_track_record(slug)` is public: closed windows only, with the Brier score.
Plan switches: `plan_features` keys `insights_basic`, `insights_pro`, `insights_max`.

## Phases
1. Schema + RLS + gating + seed ✔
2. Adapters: internal events, Polymarket, finance (Stooq), advisories
3. Engine + scheduler + admin controls
4. UI + OFI persona + intro/disclaimer + Terms section
5. Alerts, brief, track record page, scenario explorer, API
6. Unit tests for the math + backtest (markets/finance only — our own event data starts Oct 2026)
