// Run: node --experimental-strip-types --test tests/ask/askStatsInput.test.ts
//
// Statistics dashboard — the server's pure request rules: language, clarify reply, preset, metric,
// period, cache key, which mode a question ends in, who pays the plan call, when the text cache may
// answer, the dashboard gate and a dead build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheServes, cleanClarifyReply, cleanLang, cleanMetric, cleanPreset, dashboardGate, finalMode, planUsage,
  presetPeriod, previousPeriod, resolvePeriod, staleBuild, statsCacheKey,
} from '../../supabase/functions/_shared/askStatsInput.ts';

const now = Date.parse('2026-11-14T10:00:00Z');
const U = 'u1';
const iso = (ms: number) => new Date(ms).toISOString();

test('cleanLang / cleanClarifyReply / cleanPreset', () => {
  assert.equal(cleanLang('he'), 'he');
  assert.equal(cleanLang('ar'), null);
  assert.equal(cleanLang(7), null);
  assert.equal(cleanLang(undefined), null);
  assert.equal(cleanClarifyReply('dashboard', 'x'.repeat(300)), 'dashboard');
  assert.equal(cleanClarifyReply('typed', 'x'.repeat(40)), 'typed');
  assert.equal(cleanClarifyReply('typed', 'x'.repeat(41)), null);
  assert.equal(cleanClarifyReply(true, 'x'), null);
  assert.equal(cleanPreset('7d'), '7d');
  assert.equal(cleanPreset('1y'), null);
});

test('cleanMetric keeps known categories, trims and cuts, needs title and subject', () => {
  const base = { title: ' T ', subject: 's', actor: '', target: 'Syria', target_country: 'Syria', categories: ['infiltration', 'nope'], countries: ['Syria'], places: [], terms: [] };
  const m = cleanMetric(base, new Set(['infiltration']))!;
  assert.equal(m.title, 'T');
  assert.equal(m.actor, null);
  assert.deepEqual(m.categories, ['infiltration']);
  assert.equal(m.target, 'Syria');
  assert.equal(cleanMetric({ ...base, title: undefined }, new Set()), null);
  assert.equal(cleanMetric({ ...base, subject: undefined }, new Set()), null);
  assert.equal(cleanMetric({ ...base, title: 'x'.repeat(500) }, new Set())!.title.length, 80);
});

test('resolvePeriod: default, snapped preset, custom range, 90-day floor, bad until', () => {
  assert.deepEqual(resolvePeriod('nonsense', null, now), { since: '2026-11-07T10:00:00.000Z', until: '2026-11-14T10:00:00.000Z', preset: '7d' });
  const day = resolvePeriod(iso(now - 86400_000 + 30_000), null, now);
  assert.equal(day.preset, '24h');
  assert.equal(day.since, '2026-11-13T10:00:00.000Z');
  const custom = resolvePeriod('2026-11-01T00:00:00+02:00', '2026-11-08T00:00:00+02:00', now);
  assert.equal(custom.preset, null);
  assert.equal(custom.since, '2026-10-31T22:00:00.000Z');
  assert.equal(resolvePeriod(iso(now - 200 * 86400_000), null, now).since, '2026-08-16T10:00:00.000Z');
  assert.equal(resolvePeriod(iso(now - 86400_000), iso(now + 86400_000), now).until, iso(now));
  assert.equal(resolvePeriod(iso(now - 3600_000), iso(now - 7200_000), now).until, iso(now));
});

test('presetPeriod and previousPeriod', () => {
  const p = presetPeriod('48h', now);
  assert.equal(p.since, '2026-11-12T10:00:00.000Z');
  assert.deepEqual(previousPeriod(p), { since: '2026-11-10T10:00:00.000Z', until: '2026-11-12T10:00:00.000Z' });
});

test('statsCacheKey: question, language and period', () => {
  const week = presetPeriod('7d', now);
  assert.equal(statsCacheKey('  How Many  X ', week, 'en'), 'how many x|en|p:7d');
  assert.notEqual(statsCacheKey('how many x', week, 'he'), statsCacheKey('how many x', week, 'en'));
  assert.notEqual(statsCacheKey('how many x', presetPeriod('24h', now), 'en'), statsCacheKey('how many x', week, 'en'));
  const a = { since: '2026-11-01T08:05:00.000Z', until: '2026-11-03T08:00:00.000Z', preset: null };
  const b = { since: '2026-11-01T08:15:00.000Z', until: '2026-11-03T08:00:00.000Z', preset: null };
  const c = { since: '2026-11-02T08:05:00.000Z', until: '2026-11-03T08:00:00.000Z', preset: null };
  assert.equal(statsCacheKey('q', a, 'he'), statsCacheKey('q', b, 'he'));
  assert.notEqual(statsCacheKey('q', a, 'he'), statsCacheKey('q', c, 'he'));
});

test('finalMode', () => {
  const o = (x: Partial<{ client: boolean; canDashboard: boolean; clarify: any; hasMetric: boolean }>) =>
    ({ client: true, canDashboard: true, clarify: null, hasMetric: true, ...x });
  assert.deepEqual(finalMode('stats', o({})), { mode: 'stats', upgradeHint: false });
  assert.deepEqual(finalMode('stats', o({ canDashboard: false })), { mode: 'answer', upgradeHint: true });
  assert.deepEqual(finalMode('clarify_stats', o({ canDashboard: false })), { mode: 'answer', upgradeHint: false });
  assert.equal(finalMode('clarify_stats', o({ clarify: 'typed' })).mode, 'answer');
  assert.equal(finalMode('answer', o({ clarify: 'dashboard' })).mode, 'stats');
  assert.equal(finalMode('answer', o({ clarify: 'dashboard', hasMetric: false })).mode, 'answer');
  assert.equal(finalMode('stats', o({ clarify: 'text' })).mode, 'answer');
  assert.equal(finalMode('summary', o({ clarify: 'text' })).mode, 'summary');
  assert.deepEqual(finalMode('stats', o({ client: false })), { mode: 'answer', upgradeHint: false });
  assert.equal(finalMode('weird', o({})).mode, 'answer');
});

test('planUsage: clarify turns and replies are free', () => {
  assert.deepEqual(planUsage('clarify_stats', null, U), { uid: null, purpose: 'ask_plan' });
  assert.deepEqual(planUsage('stats', null, U), { uid: U, purpose: 'ask_dashboard_plan' });
  assert.deepEqual(planUsage('stats', 'dashboard', U), { uid: null, purpose: 'ask_plan' });
  assert.deepEqual(planUsage('answer', 'text', U), { uid: null, purpose: 'ask_plan' });
  assert.deepEqual(planUsage('answer', null, U), { uid: U, purpose: 'ask_plan' });
});

test('cacheServes: a text answer never stands in for a dashboard', () => {
  assert.deepEqual(cacheServes(undefined, { canDashboard: true, clarify: null }), { serve: true, upgradeHint: false });
  assert.equal(cacheServes('stats', { canDashboard: true, clarify: null }).serve, false);
  assert.deepEqual(cacheServes('stats', { canDashboard: false, clarify: null }), { serve: true, upgradeHint: true });
  assert.deepEqual(cacheServes('stats', { canDashboard: true, clarify: 'text' }), { serve: true, upgradeHint: false });
  assert.equal(cacheServes('clarify_stats', { canDashboard: true, clarify: null }).serve, false);
  assert.deepEqual(cacheServes('clarify_stats', { canDashboard: false, clarify: null }), { serve: true, upgradeHint: false });
});

test('dashboardGate: busy, staff, budget, credits', () => {
  const q = (x: object) => ({ enabled: true, staff: false, limit: 10, used: 0, budget_usd: null, spent_today_usd: 0, ...x });
  assert.deepEqual(dashboardGate(null, 0), { ok: true });
  assert.deepEqual(dashboardGate(q({ enabled: false }), 0), { ok: true });
  assert.deepEqual(dashboardGate(q({ staff: true, used: 99 }), 0), { ok: true });
  assert.deepEqual(dashboardGate(q({ staff: true }), 1), { ok: false, status: 409, error: 'busy' });
  assert.deepEqual(dashboardGate(q({ used: 7.2 }), 0), { ok: false, status: 429, error: 'quota_dashboard', needed: 3, left: 2 });
  assert.deepEqual(dashboardGate(q({ used: 7 }), 0), { ok: true });
  assert.deepEqual(dashboardGate(q({ limit: null, used: 50 }), 0), { ok: true });
  assert.equal((dashboardGate(q({ used: 12 }), 0) as any).left, 0);
  assert.equal((dashboardGate(q({ budget_usd: 10, spent_today_usd: 10 }), 0) as any).error, 'budget');
});

test('staleBuild: a running build older than 5 minutes is dead', () => {
  assert.equal(staleBuild({ status: 'running', created_at: iso(now - 5 * 60_000 - 1000) }, now), true);
  assert.equal(staleBuild({ status: 'running', created_at: iso(now - 4 * 60_000) }, now), false);
  assert.equal(staleBuild({ status: 'done', created_at: iso(now - 60 * 60_000) }, now), false);
  assert.equal(staleBuild(null, now), false);
});
