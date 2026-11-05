# OFI Insights — probability model (`ofi-1.0`)

Deterministic: the same inputs always give the same output. No LLM anywhere. Code:
`supabase/functions/_shared/ofi/normalize.ts` (signal scores) and `engine.ts` (the estimate).
Tests: `node --experimental-strip-types --test tests/ofi/normalize.test.ts tests/ofi/engine.test.ts`.

## 1. Signal scores (0..1, 0.5 = no evidence)

| Method | Formula | Used by |
|---|---|---|
| ratio vs. baseline | r = (count₂₄ₕ + 1) / (daily avg of previous 7 days + 1); s = r / (1 + r) | event volume, interceptions, proxies, airspace, HFC waves |
| lexicon balance vs. baseline | b = (E + 1) / (E + D + 2) for escalation E / de-escalation D weights; s = σ(logit(b_today) − logit(b_baseline)) | escalation lexicon |
| share shift | share = (high + 2·base) / (n + 2); s = 0.5 + (share − base) | severity mix |
| z-score | z = latest daily log-return vs. mean/sd of the previous 30; s = 0.5 + 0.5·tanh(z/2), averaged over the signal's symbols | defense stocks, oil/gold/VIX, USD/ILS |
| level change | Δ = rise (or fall) of the advisory level vs. the last 7 days; s = 0.5 + 0.2·Δ | US State Dept, UK FCDO |
| market | p₂₄ = 1 − (1 − P)^(24/H), H = hours to the market's end (≥ 24); inverted markets use 1 − P(yes); several markets → max | Polymarket |
| manual | s = 0.5 + level/200, level −100…+100, held for N hours | super admin |

"Our collected events" are matched to the insight by its keyword list; lexicon terms are matched in
the event text (Hebrew / English / Arabic), each event capped at weight 3 per category.

## 2. The estimate

    L0     = logit(base_rate)
    fᵢ     = freshness: 1 while age ≤ stale window, then linearly to 0 at twice the window
    termᵢ  = directionᵢ · wᵢ · k · (sᵢ − 0.5) · fᵢ                      (k = 2)
    α      = 0.5 · f_market                                              (market anchor)
    s      = 0.6 if there is a previous estimate and no circuit breaker, else 1
    L      = L0 + s(1 − α)·Σ termᵢ + s·α·(logit(p_market) − L0) + (1 − s)·(logit(p_prev) − L0)
    p      = clamp(σ(L), 1%, 95%)

**Circuit breaker:** two breaker signals (airspace closure, HFC alerts, NOTAM) at score ≥ 0.75, or one
at ≥ 0.9 → no smoothing, and the hourly check publishes an extra estimate (at most every 6 h).

**Contributions (percentage points):** every item cᵢ (signals, market, previous estimate) gets
cᵢ × (σ(L) − base) / Σc — the average slope along the path from the base rate to the result
(integrated gradients). Base + all items = the final estimate exactly; clamping is its own item.

**Confidence band:** half-width in log-odds = 0.3 + 1.2 · (stale share of weight) + 0.8 · (weighted
spread of the fresh signals); band = σ(logit(p) ± half-width).

## 3. Schedule
pg_cron every 15 min → `ofi-runner tick`: an event whose `next_run_at` is due gets a full cycle
(every source once, then the estimate; next run = now + `refresh_interval_hours`, default 24 h).
In between, once an hour, only our own data is re-read (no external calls) to check the circuit
breaker. Page views never compute anything.

## 4. Cost
Per event per day: 1 Polymarket search, 1 Yahoo call (8 symbols), 1 State Dept RSS, 1 FCDO page —
all free, no keys. Database work ≈ 4 s/hour. Expected monthly cost: **$0**.

## 5. Simplified version (shown to Pro / Max)
Start from how often this happened historically (the base rate). Each signal pushes the estimate up
or down by an amount set by its weight and how unusual today's reading is; old data counts less.
Prediction markets pull the estimate toward what traders expect. The result is blended with the
previous estimate to avoid jumps — unless emergency signals fire — and kept between 1% and 95%.

## 6. Backtest (2026-11-06)
Windows 20 Mar–5 May 2024, 10 Sep–10 Nov 2024, 20 May–10 Jul 2025; outcome = a day with a direct
Israel/US ↔ Iran strike (17 of 161 days). Only the financial signals have free history before Oct 2026,
so this tests them alone (our own event data and the prediction-market history are not available).

| | Brier (lower is better) |
|---|---|
| Model (finance signals) | 0.1006 |
| Base rate 2% alone | 0.1018 |

Mean estimate 2.6% on strike days vs 2.0% on other days: the financial signals carry a small, real
signal, so their weights stay modest (0.3–0.5). The windows were chosen around escalations, so the
event rate in them (10.6%) is far above the base rate — the Brier score here mostly measures that;
calibration on live data (resolved windows) is what will tune the weights. Re-run from the admin panel.
