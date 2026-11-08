// Lead speed and the follow-up queue: pure rules, no DOM, no Supabase. Shared by Crew and the Admin: crm/speed.js is the source and admin/speed.js is an identical
// copy (scripts/sync_shared.sh). Tests: tests/speed.test.mjs. Fields used are the ones the desk already has: created_at, crm_first_contact_at, crm_next_action_at,
// crm_owner, status, est_total. Every function survives null, missing and odd values: one bad row must never blank the screen.
export const OPEN_STATUSES = ['new', 'contacted', 'quoted', 'payment_sent'];
export const SPEED_WINDOW_MIN = 15;
const MIN = 60e3, IST = 330 * MIN;
const ms = (v) => { if (v == null || v === '') return NaN; const t = new Date(v).getTime(); return Number.isFinite(t) ? t : NaN; };
const num = (v) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : 0; };
const rows = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && x.status !== 'junk') : []);
export const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);

/** Minutes from arrival to first contact. Null when not contacted yet or the dates are unusable. A contact stamped before arrival counts as 0. */
export function firstReplyMinutes(lead) {
  const a = ms(lead && lead.created_at), b = ms(lead && lead.crm_first_contact_at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / MIN));
}

export function median(list) {
  const v = (list || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
}

/** Speed of a set of leads: how many arrived, how many got a first contact, median minutes, and the share contacted within the target. */
export function speedStats(leads, windowMin = SPEED_WINDOW_MIN) {
  const list = rows(leads), mins = list.map(firstReplyMinutes).filter((x) => x != null);
  const within = mins.filter((m) => m <= windowMin).length;
  return { leads: list.length, replied: mins.length, waiting: list.length - mins.length, medianMin: median(mins), pctWithin: mins.length ? Math.round((within / mins.length) * 100) : null, within };
}

/** One row per owner (null owner = "Unassigned"), most leads first. names maps user id to display name. */
export function speedByPerson(leads, names = {}) {
  const by = new Map();
  for (const l of rows(leads)) { const k = l.crm_owner || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  return [...by.entries()].map(([id, ls]) => ({ id: id || null, name: id ? (names && names[id]) || 'Team member ' + String(id).slice(0, 4) : 'Unassigned', ...speedStats(ls) }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
}

/** Open leads nobody has contacted yet, longest wait first. */
export function longestWaiting(leads, now = Date.now(), limit = 10) {
  return rows(leads).filter((l) => l.status === 'new' && !l.crm_first_contact_at && Number.isFinite(ms(l.created_at)))
    .map((l) => ({ ...l, waitMin: Math.max(0, Math.round((now - ms(l.created_at)) / MIN)) }))
    .sort((a, b) => b.waitMin - a.waitMin).slice(0, limit);
}

export function fmtMinutes(m) {
  if (m == null || !Number.isFinite(Number(m)) || Number(m) < 0) return 'n/a';
  m = Number(m);
  if (m < 1) return '<1 min';
  if (m < 90) return Math.round(m) + ' min';
  if (m < 48 * 60) return (Math.round(m / 6) / 10) + ' h';
  return (Math.round(m / 144) / 10) + ' days';
}

/** Which bucket a lead's next follow-up falls in, by India-time day: overdue (earlier today or before), today, later, nodate. */
export function followUpBucket(lead, now = Date.now()) {
  const t = ms(lead && lead.crm_next_action_at);
  if (!Number.isFinite(t)) return 'nodate';
  if (t < now) return 'overdue';
  return istDay(t) === istDay(now) ? 'today' : 'later';
}
const RANK = { overdue: 0, today: 1, later: 2, nodate: 3 };

/** Follow-up queue: open leads, overdue first, then due today, then later, then no date. Inside a bucket: higher value first, then older lead first. */
export function followUpQueue(leads, now = Date.now()) {
  return rows(leads).filter((l) => OPEN_STATUSES.includes(l.status))
    .map((l) => ({ ...l, bucket: followUpBucket(l, now), value: num(l.est_total) }))
    .sort((a, b) => RANK[a.bucket] - RANK[b.bucket] || b.value - a.value || (ms(a.created_at) || 0) - (ms(b.created_at) || 0));
}
export function bucketCounts(queue) { const c = { overdue: 0, today: 0, later: 0, nodate: 0 }; for (const l of queue || []) if (l.bucket in c) c[l.bucket]++; return c; }

/** Snooze time as an ISO string: 10:00 India time, 1 or 3 days after today (India date). */
export function snoozeAt(days, now = Date.now()) {
  const d = new Date(istDay(now) + 'T10:00:00+05:30'); d.setUTCDate(d.getUTCDate() + Math.max(1, Math.round(num(days) || 1)));
  return d.toISOString();
}

/** Removes money from rows for people who must not see it (supervisors). */
export const withoutMoney = (list, canSee) => (canSee ? list : (list || []).map((l) => { const c = { ...l }; delete c.est_total; delete c.value; return c; }));

/** An IVR call nobody has picked up yet: page 'ivr' (or, when the queue rows carry no page, source 'phone'), the missed-call note, still open, never contacted. */
export function isMissedCall(lead) {
  if (!lead) return false;
  const ivr = lead.page === 'ivr' || (lead.page == null && lead.source === 'phone');
  return ivr && /missed call/i.test(String(lead.notes || '')) && !lead.crm_first_contact_at && OPEN_STATUSES.includes(lead.status);
}

/** Missed-call leads, oldest first, with minutesWaiting. */
export function missedCallQueue(leads, now = Date.now()) {
  return rows(leads).filter(isMissedCall).filter((l) => Number.isFinite(ms(l.created_at)))
    .map((l) => ({ ...l, minutesWaiting: Math.max(0, Math.round((now - ms(l.created_at)) / MIN)) }))
    .sort((a, b) => b.minutesWaiting - a.minutesWaiting);
}

/** Quotes waiting: the latest sent quote has had no decision for 2 hours or more and is not expired. Oldest first, with hoursWaiting and a stale flag (24 h+).
 *  Money is kept only when canSee is true (admin); otherwise total is removed. */
export const QUOTE_WAIT_MIN = 120, QUOTE_STALE_MIN = 24 * 60;
export function quotesWaiting(list, now = Date.now(), canSee = false) {
  return rows(list).filter((q) => {
    const s = ms(q.sent_at), v = ms(q.valid_until);
    if (!Number.isFinite(s) || (now - s) < QUOTE_WAIT_MIN * MIN) return false;
    if (q.decided_at || (q.status && q.status !== 'sent')) return false;
    return !(Number.isFinite(v) && v <= now);
  }).map((q) => { const c = { ...q, minutesWaiting: Math.round((now - ms(q.sent_at)) / MIN) }; c.stale = c.minutesWaiting >= QUOTE_STALE_MIN; if (!canSee) delete c.total; return c; })
    .sort((a, b) => b.minutesWaiting - a.minutesWaiting);
}

/** Not paid yet: /book/ customers with a payment order who have not paid. 15 minutes minimum (they may still be paying), 3 days maximum.
 *  Newest first (fresh abandons convert best): those under 24 h come first, then the older ones, each group newest first. Money kept only when canSee (admin). */
export const UNPAID_MIN = 15, UNPAID_MAX_MIN = 3 * 24 * 60, UNPAID_FRESH_MIN = 24 * 60;
export function unpaidBookings(list, now = Date.now(), canSee = false) {
  return rows(list).filter((r) => {
    const c = ms(r.created_at); if (!Number.isFinite(c) || r.confirm_paid_at) return false;
    const age = (now - c) / MIN;
    return age >= UNPAID_MIN && age <= UNPAID_MAX_MIN;
  }).map((r) => { const m = Math.round((now - ms(r.created_at)) / MIN), o = { ...r, minutesWaiting: m, older: m >= UNPAID_FRESH_MIN }; if (!canSee) delete o.confirm_fee; return o; })
    .sort((a, b) => (a.older - b.older) || (a.minutesWaiting - b.minutesWaiting));
}
