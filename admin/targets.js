// Sales targets: pure rules, no DOM, no Supabase. crm/targets.js is the source and admin/targets.js an identical copy (scripts/sync_shared.sh). Tests: tests/targets.test.mjs.
// Counts only, never money. Input comes from crm_targets_progress: { now_ist, people: [{ user_id, name, day: { target, actual }, week: { target, actual } }] }.
// Every function survives null and odd values: one bad row must never blank the screen.
export const METRICS = [['calls', 'Calls'], ['quotes_sent', 'Quotes sent'], ['paid_bookings', 'Paid bookings']];
export const WORK_START_HOUR = 9, WORK_END_HOUR = 19, WORK_DAYS = 6;   // Monday to Saturday, 9 AM to 7 PM India time
export const BEHIND_BELOW = 0.8;                                        // under 80% of the pace so far counts as Behind
const num = (v) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Share of the target reached, as a whole percent (can pass 100). Null when there is no target. */
export function progressPct(actual, target) {
  const t = num(target); if (t <= 0) return null;
  return Math.round((num(actual) / t) * 100);
}
/** Width for a bar: 0 to 100. */
export const barPct = (actual, target) => Math.min(100, Math.max(0, progressPct(actual, target) || 0));

function parts(nowIst) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(nowIst || ''));
  if (!m) return null;
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();   // 0 = Sunday
  return { hour: +m[4] + +m[5] / 60, weekday: dow === 0 ? 7 : dow };
}
/** How much of the working day has passed, 0 to 1, from an India-time stamp like 2027-01-11T14:30:00. Unusable input gives 0 (nobody is called Behind on bad data). */
export function dayFraction(nowIst) {
  const p = parts(nowIst); if (!p) return 0;
  return Math.min(1, Math.max(0, (p.hour - WORK_START_HOUR) / (WORK_END_HOUR - WORK_START_HOUR)));
}
/** How much of the working week has passed, 0 to 1. Sunday counts as the end of the week. */
export function weekFraction(nowIst) {
  const p = parts(nowIst); if (!p) return 0;
  if (p.weekday > WORK_DAYS) return 1;
  return Math.min(1, ((p.weekday - 1) + dayFraction(nowIst)) / WORK_DAYS);
}
/** What the pace says should be done by now. Not rounded. */
export const expectedNow = (target, fraction) => num(target) * Math.min(1, Math.max(0, Number(fraction) || 0));

/** Status of one number against its target: 'Done', 'On track', 'Behind', or 'No target'. */
export function statusOf(actual, target, fraction) {
  const t = num(target); if (t <= 0) return 'No target';
  const a = num(actual); if (a >= t) return 'Done';
  return a < expectedNow(t, fraction) * BEHIND_BELOW ? 'Behind' : 'On track';
}
export const statusTone = (s) => (s === 'Done' ? 'good' : s === 'Behind' ? 'bad' : s === 'On track' ? 'ok' : 'muted');

/** One row per metric for a period block ({ target, actual }). */
export function metricRows(block, fraction) {
  const t = (block && block.target) || {}, a = (block && block.actual) || {};
  return METRICS.map(([key, label]) => ({ key, label, actual: num(a[key]), target: t[key] == null ? null : num(t[key]), pct: progressPct(a[key], t[key]), width: barPct(a[key], t[key]), status: statusOf(a[key], t[key], fraction) }));
}
/** One status for a person and period: Done when every set target is met, Behind when any is behind, On track otherwise, 'No target' when none is set. */
export function overallStatus(rows) {
  const set = (rows || []).filter((r) => r.status !== 'No target');
  if (!set.length) return 'No target';
  if (set.every((r) => r.status === 'Done')) return 'Done';
  return set.some((r) => r.status === 'Behind') ? 'Behind' : 'On track';
}
/** Fraction for a period name. */
export const fractionFor = (period, nowIst) => (period === 'week' ? weekFraction(nowIst) : dayFraction(nowIst));
/** Team rows for one period: [{ id, name, rows, status }], names A to Z. */
export function teamRows(progress, period = 'day') {
  const f = fractionFor(period, progress && progress.now_ist);
  return (progress && Array.isArray(progress.people) ? progress.people : []).filter((p) => p && typeof p === 'object')
    .map((p) => { const rows = metricRows(p[period], f); return { id: p.user_id, name: p.name || 'Team member', rows, status: overallStatus(rows) }; })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
/** The signed-in member's own row. Null when the list has nobody with that id. */
export function myRows(progress, userId, period = 'day') { return teamRows(progress, period).find((r) => r.id === userId) || null; }
/** Validate the set-targets form. Returns { ok, values } or { ok: false, error }. */
export function parseTargetForm(v) {
  const out = {};
  for (const [k, label] of METRICS) {
    const raw = String((v && v[k]) ?? '').trim(); if (raw === '') return { ok: false, error: label + ' needs a number. Use 0 for none.' };
    const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > 1000) return { ok: false, error: label + ' must be a whole number from 0 to 1000.' };
    out[k] = n;
  }
  return { ok: true, values: out };
}
