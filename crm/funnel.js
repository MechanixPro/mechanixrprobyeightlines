// The funnel: Lead, Contacted, Quote sent, Quote approved, Paid and booked, Completed, Invoiced. Shared by Crew and the Admin: ONE file. crm/funnel.js is the source and
// admin/funnel.js is an identical copy (scripts/sync_shared.sh). The database does the counting (crm_funnel, supabase/migrations/20270104000000_funnel_quote.sql) and
// sends counts and median hours, plus the internal ref and age of the late leads; the browser never downloads every lead. No customer names, phones or addresses appear here.
// Everything in the "pure rules" part runs in Node (tests/funnel.test.mjs) and survives null, missing and odd values: one bad row must never blank the screen.
import { chip, emptyState, errorState, skeleton } from './ds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => { const n = v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
const cleanErr = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^Error:\s*/, '');

/* ---------- pure rules (no DOM, no Supabase) ---------- */
export const STAGES = [['lead', 'Lead'], ['contacted', 'Contacted'], ['quote_sent', 'Quote sent'], ['quote_approved', 'Quote approved'], ['paid', 'Paid and booked'], ['completed', 'Completed'], ['invoiced', 'Invoiced']];
export const DEFAULT_TARGETS = { claim_minutes: 15, quote_hours: 2, valid_days: 3 };
export const PERIODS = [['today', 'Today', 1], ['d7', 'Last 7 days', 7], ['d30', 'Last 30 days', 30], ['d90', 'Last 90 days', 90]];
export const istDay = (ms = Date.now()) => new Date(ms + 330 * 60e3).toISOString().slice(0, 10);
/** { from, to } as India-time dates for the last n days, today included. */
export function periodDates(days, now = Date.now()) { const n = Math.max(1, num(days, 1)); return { from: istDay(now - (n - 1) * 86400e3), to: istDay(now) }; }

/** Hours as the desk reads them: "12 min", "3.5 h", "2.1 days". Null, negative or odd values read "n/a". */
export function fmtHours(h) {
  if (h == null || h === '') return 'n/a';
  const v = Number(h); if (!Number.isFinite(v) || v < 0) return 'n/a';
  if (v < 1) return Math.max(1, Math.round(v * 60)) + ' min';
  if (v < 48) return (Math.round(v * 10) / 10) + ' h';
  return (Math.round(v / 2.4) / 10) + ' days';
}
export const fmtAge = (min) => { const m = num(min, NaN); if (!Number.isFinite(m) || m < 0) return 'n/a'; return m < 90 ? Math.round(m) + ' min' : fmtHours(m / 60); };

/** Makes whatever the RPC returned (or failed to return) safe to draw: seven stages in order, numbers as numbers, lists as lists. */
export function normalizeFunnel(data) {
  const d = data && typeof data === 'object' ? data : {};
  const by = new Map((Array.isArray(d.stages) ? d.stages : []).filter((s) => s && typeof s === 'object').map((s) => [s.key, s]));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const t = d.targets && typeof d.targets === 'object' ? d.targets : {};
  const qo = d.quote_outcomes && typeof d.quote_outcomes === 'object' ? d.quote_outcomes : {};
  return {
    money: d.money === true,
    targets: { claim_minutes: num(t.claim_minutes, 15) > 0 ? num(t.claim_minutes, 15) : 15, quote_hours: num(t.quote_hours, 2) > 0 ? num(t.quote_hours, 2) : 2, valid_days: num(t.valid_days, 3) > 0 ? num(t.valid_days, 3) : 3 },
    stages: STAGES.map(([key, label]) => { const s = by.get(key) || {}; return { key, label, n: Math.max(0, Math.round(num(s.n))), medianHours: s.median_hours == null ? null : num(s.median_hours, null) }; }),
    lost: list(d.lost).map((x) => ({ reason: String(x.reason || 'No reason recorded'), n: Math.max(0, Math.round(num(x.n))) })),
    quoteOutcomes: { sent: num(qo.sent), approved: num(qo.approved), declined: num(qo.declined), changes: num(qo.changes), expired: num(qo.expired) },
    overdueClaim: list(d.overdue_claim).map((x) => ({ id: x.id || null, ref: String(x.ref || ''), vehicle: String(x.vehicle || 'bike'), ageMin: num(x.age_min, null) })),
    overdueQuote: list(d.overdue_quote).map((x) => ({ id: x.id || null, ref: String(x.ref || ''), vehicle: String(x.vehicle || 'bike'), ageHours: num(x.age_hours, null) })),
    invoicedTotal: d.invoiced_total == null ? null : num(d.invoiced_total, null),
  };
}

/** The funnel table: count, percent of the previous stage, drop-off from it (people and percent), percent of all leads, median time to reach the stage. */
export function stageRows(f) {
  const s = (f && f.stages) || [], top = s.length ? s[0].n : 0;
  return s.map((x, i) => {
    const prev = i ? s[i - 1].n : null;
    const pctPrev = prev == null ? null : prev > 0 ? Math.round((x.n / prev) * 100) : null;
    const drop = prev == null ? null : Math.max(0, prev - x.n);
    return { key: x.key, label: x.label, n: x.n, pctPrev, drop, dropPct: pctPrev == null ? null : 100 - Math.min(100, pctPrev), pctAll: top > 0 ? Math.round((x.n / top) * 100) : null, medianHours: x.medianHours };
  });
}

/** Names the biggest leak: the stage after which the largest share of leads is lost. Null when there is nothing to compare. */
export function biggestDrop(rows) {
  let best = null;
  for (const r of rows || []) if (r.dropPct != null && r.drop > 0 && (!best || r.dropPct > best.dropPct)) best = r;
  return best;
}

const csvCell = (v) => { let c = String(v ?? ''); if (/^[=+\-@\t\r]/.test(c)) c = "'" + c; return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
/** CSV of the whole screen: the stages, then the lost reasons, then the late leads. Plain numbers, not words, so it opens cleanly in a sheet. */
export function funnelCsv(f, meta = {}) {
  const rows = [['Funnel', meta.label || ''], ['Stage', 'Leads', 'Percent of previous stage', 'Dropped from previous stage', 'Percent of all leads', 'Median hours to reach']];
  for (const r of stageRows(f)) rows.push([r.label, r.n, r.pctPrev ?? '', r.drop ?? '', r.pctAll ?? '', r.medianHours == null ? '' : Math.round(r.medianHours * 100) / 100]);
  rows.push([], ['Lost reason', 'Leads']);
  for (const x of (f && f.lost) || []) rows.push([x.reason, x.n]);
  rows.push([], ['Late: not claimed in time', 'Age (minutes)']);
  for (const x of (f && f.overdueClaim) || []) rows.push([x.ref, x.ageMin ?? '']);
  rows.push([], ['Late: quote not sent in time', 'Age (hours)']);
  for (const x of (f && f.overdueQuote) || []) rows.push([x.ref, x.ageHours ?? '']);
  if (f && f.money && f.invoicedTotal != null) rows.push([], ['Invoiced total (Rs)', f.invoicedTotal]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

/* ----- routing: the owner, the one next step, and how late it is against the targets ----- */
const OPEN_FOR_CLAIM = ['new'];
const t = (v) => { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : null; };
/**
 * How late is this lead against the targets? claim: unclaimed (no owner, never contacted) beyond claim_minutes. quote: contacted, no quote sent, beyond quote_hours.
 * lead: { status, created_at, crm_first_contact_at, crm_owner, booking_id, quote_sent_at, has_quote }. Returns { late, kind, label, minutes } and never throws.
 */
export function timingOf(lead, targets = DEFAULT_TARGETS, now = Date.now()) {
  const l = lead && typeof lead === 'object' ? lead : {}, tg = { ...DEFAULT_TARGETS, ...(targets || {}) }, none = { late: false, kind: null, label: '', minutes: 0 };
  if (!l.status || ['lost', 'junk', 'completed'].includes(l.status) || l.deleted_at) return none;
  const created = t(l.created_at), first = t(l.crm_first_contact_at || l.first_contact_at);
  if (first == null && !l.crm_owner && OPEN_FOR_CLAIM.includes(l.status) && created != null) {
    const min = Math.floor((now - created) / 60e3);
    return min > num(tg.claim_minutes, 15) ? { late: true, kind: 'claim', label: 'Unclaimed ' + fmtAge(min), minutes: min } : { late: false, kind: 'claim', label: 'Claim within ' + num(tg.claim_minutes, 15) + ' min', minutes: Math.max(0, min) };
  }
  const quoted = l.has_quote || l.quote_sent_at || ['quoted', 'payment_sent', 'paid', 'scheduled'].includes(l.status) || (l.booking_id && String(l.booking_id).trim());
  if (first != null && !quoted && ['new', 'contacted'].includes(l.status)) {
    const min = Math.floor((now - first) / 60e3);
    return min > num(tg.quote_hours, 2) * 60 ? { late: true, kind: 'quote', label: 'Quote late ' + fmtAge(min), minutes: min } : { late: false, kind: 'quote', label: 'Quote due within ' + num(tg.quote_hours, 2) + ' h', minutes: Math.max(0, min) };
  }
  return none;
}
/** What the Today board and the Crew lead sheet show for one booking: who owns it, the one Next step button, and the late flag. `next` is that app's own nextAction(lead). */
export function routeInfo(lead, { targets = DEFAULT_TARGETS, now = Date.now(), next = null, ownerName = '' } = {}) {
  const l = lead && typeof lead === 'object' ? lead : {};
  const owner = String(ownerName || l.owner_name || l.crm_owner_name || '').trim() || (l.crm_owner || l.owner_id ? 'Assigned' : 'Unassigned');
  return { owner, next: next && next.label ? { key: next.key || '', label: String(next.label) } : null, timing: timingOf(l, targets, now), ref: String(l.ref || ''), id: l.id || '' };
}
/** The small chip: "Asha · Next: Send quote · Late 2 h". Late shows red, on time shows plain. Returns '' when there is nothing to say. */
export function routeChipHtml(info, { action = 'routeNext' } = {}) {
  if (!info) return '';
  const late = info.timing && info.timing.late, bits = [chip(info.owner, info.owner === 'Unassigned' ? 'warn' : '')];
  if (info.next) bits.push(`<button class="mx-chip mx-chip--info route-next" type="button" data-id="${esc(info.id)}" data-act="${esc(action)}" data-step="${esc(info.next.key)}">Next: ${esc(info.next.label)}</button>`);
  if (info.timing && info.timing.label && (late || info.timing.kind)) bits.push(chip(info.timing.label, late ? 'bad' : '', late ? 'route-late' : ''));
  return `<span class="route-chip" data-late="${late ? '1' : '0'}">${bits.join(' ')}</span>`;
}

/** Fetches the targets and the Crew names once, then answers for every card without another call. `onReady` redraws the screen once the first answer arrives. */
export function createRouting({ rpc, onReady } = {}) {
  let tg = null, names = new Map(), started = false;
  const start = () => {
    if (started || !rpc) return; started = true;
    Promise.all([rpc('funnel_targets', {}).catch(() => null), rpc('crm_funnel_options', {}).catch(() => null)]).then(([a, b]) => {
      if (a && typeof a === 'object') tg = { ...DEFAULT_TARGETS, ...a };
      if (b && Array.isArray(b.owners)) names = new Map(b.owners.filter((o) => o && o.id).map((o) => [o.id, String(o.name || '')]));
      if (onReady) onReady();
    });
  };
  const targets = () => tg || DEFAULT_TARGETS, ownerName = (id) => (id && names.get(id)) || '';
  /** The chip for one lead: the owner (the technician once a mechanic is assigned to a booked job), the late flag, and the Next step button when `next` is given. */
  const chip = (lead, next = null, now = Date.now()) => {
    start(); const l = lead || {}, booked = ['paid', 'scheduled'].includes(l.status) && l.mechanic_name;
    return routeChipHtml(routeInfo(l, { targets: targets(), now, next, ownerName: booked ? l.mechanic_name : l.owner_name || ownerName(l.crm_owner) }));
  };
  return { start, targets, ownerName, chip };
}

/* ---------- the screen ---------- */
export function createFunnelDesk(deps = {}) {
  const S = { period: 'd30', source: '', campaign: '', owner: '', vehicle: '', data: null, opts: null, error: null, loading: false, root: null, seq: 0 };
  const params = () => { const p = periodDates((PERIODS.find((x) => x[0] === S.period) || PERIODS[2])[2]); return { p_from: p.from, p_to: p.to, p_source: S.source || null, p_campaign: S.campaign || null, p_owner: S.owner || null, p_vehicle: S.vehicle || null }; };
  const label = () => { const p = params(); return p.p_from + ' to ' + p.p_to + (S.source ? ', source ' + S.source : '') + (S.campaign ? ', campaign ' + S.campaign : '') + (S.vehicle ? ', ' + S.vehicle : ''); };

  function sel(id, name, value, options) { return `<label class="small muted">${esc(name)} <select id="${id}" aria-label="${esc(name)}"><option value="">All</option>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`; }
  function filters() {
    const o = S.opts || {}, list = (a) => (Array.isArray(a) ? a : []);
    return `<div class="fn-tools"><label class="small muted">Period <select id="fnPeriod" aria-label="Period">${PERIODS.map(([k, l]) => `<option value="${k}"${k === S.period ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${sel('fnSource', 'Source', S.source, list(o.sources).map((x) => [x, x]))}${sel('fnCampaign', 'Campaign', S.campaign, list(o.campaigns).map((x) => [x, x]))}
      ${sel('fnOwner', 'Crew member', S.owner, list(o.owners).map((x) => [x && x.id, (x && x.name) || 'Unknown']))}${sel('fnVehicle', 'Vehicle', S.vehicle, [['bike', 'Bike'], ['car', 'Car'], ['parts', 'Parts']])}
      <button class="btn btn-ghost btn-sm" type="button" data-fn="csv"${S.data ? '' : ' disabled'}>Export CSV</button><button class="btn btn-ghost btn-sm" type="button" data-fn="reload">Refresh</button></div>`;
  }
  function overdue(title, items, unitText, targetText) {
    if (!items.length) return `<div class="fn-card"><h4>${esc(title)}</h4><p class="small muted">None. ${esc(targetText)}</p></div>`;
    return `<div class="fn-card"><h4>${esc(title)} <span class="mx-chip mx-chip--bad">${items.length}</span></h4><p class="small muted">${esc(targetText)}</p><ul class="fn-late">${items.slice(0, 50).map((x) => `<li><button class="link" type="button" data-fn="open" data-id="${esc(x.id || '')}"${x.id ? '' : ' disabled'}>${esc(x.ref || 'No ref')}</button> <span class="small muted">${esc((x.vehicle || '').toUpperCase())}</span> <b class="fn-red">${esc(unitText(x))}</b></li>`).join('')}${items.length > 50 ? `<li class="small muted">and ${items.length - 50} more (see the CSV)</li>` : ''}</ul></div>`;
  }
  function body() {
    if (S.loading && !S.data) return skeleton(5, 'Loading the funnel');
    if (S.error) return errorState({ title: 'The funnel could not load.', detail: cleanErr(S.error), retry: { label: 'Try again', attr: 'data-fn="reload"' } });
    const f = normalizeFunnel(S.data), rows = stageRows(f);
    if (!f.stages[0].n) return emptyState({ title: 'No leads in this period', text: 'Try a longer period or clear a filter.' });
    const max = Math.max(1, ...rows.map((r) => r.n)), leak = biggestDrop(rows), q = f.quoteOutcomes, lostMax = Math.max(1, ...f.lost.map((x) => x.n));
    return `<div class="fn-sum">${rows.map((r) => `<div class="stat"><b>${r.n}</b><span>${esc(r.label)}</span></div>`).join('')}</div>
      ${leak ? `<p class="small">Biggest leak: <b>${esc(leak.label)}</b> keeps only ${leak.pctPrev}% of the stage before it (${leak.drop} dropped).</p>` : ''}
      <div class="table-wrap"><table class="fn-table"><thead><tr><th>Stage</th><th class="n">Leads</th><th class="n">% of previous</th><th class="n">Dropped</th><th class="n">% of all</th><th class="n">Median time to reach</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n"><b>${r.n}</b></td><td class="n">${r.pctPrev == null ? '' : r.pctPrev + '%'}</td><td class="n">${r.drop == null ? '' : r.drop}</td><td class="n">${r.pctAll == null ? '' : r.pctAll + '%'}</td><td class="n">${r.key === 'lead' ? '' : esc(fmtHours(r.medianHours))}</td><td class="fn-barcell"><i class="fn-bar" style="width:${Math.round((r.n / max) * 100)}%"></i></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Median time is from the previous stage. Contacted is measured from the enquiry, Quote sent from first contact. Junk and deleted leads are left out.${f.money && f.invoicedTotal != null ? ' Invoiced total: Rs ' + f.invoicedTotal.toLocaleString('en-IN') + '.' : ''}</p>
      <div class="fn-grid">
        ${overdue('Not claimed in time', f.overdueClaim, (x) => fmtAge(x.ageMin), 'Target: claimed within ' + f.targets.claim_minutes + ' minutes.')}
        ${overdue('Quote not sent in time', f.overdueQuote, (x) => (x.ageHours == null ? 'n/a' : fmtHours(x.ageHours)), 'Target: quote sent within ' + f.targets.quote_hours + ' hours of first contact.')}
      </div>
      <h4>Quote answers</h4><div class="fn-sum"><div class="stat"><b>${q.sent}</b><span>Sent</span></div><div class="stat"><b>${q.approved}</b><span>Approved</span></div><div class="stat"><b>${q.declined}</b><span>Declined</span></div><div class="stat"><b>${q.changes}</b><span>Changes asked</span></div><div class="stat"><b>${q.expired}</b><span>Expired (valid ${f.targets.valid_days} days)</span></div></div>
      <h4>Why leads were lost</h4>${f.lost.length ? `<div class="table-wrap"><table><thead><tr><th>Reason</th><th class="n">Leads</th><th></th></tr></thead><tbody>${f.lost.map((x) => `<tr><td>${esc(x.reason)}</td><td class="n">${x.n}</td><td class="fn-barcell"><i class="fn-bar" style="width:${Math.round((x.n / lostMax) * 100)}%"></i></td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No lost leads in this period.</p>'}`;
  }
  function draw() {
    const r = S.root; if (!r || r.isConnected === false) return;
    r.innerHTML = `<section class="fn"><h3>Conversion <span class="small muted">${esc(label())}</span></h3>${filters()}<div id="fnBody" aria-live="polite" aria-busy="${S.loading ? 'true' : 'false'}">${body()}</div></section>`;
  }
  async function load() {
    const my = ++S.seq; S.loading = true; S.error = null; draw();
    try {
      if (!S.opts) S.opts = await deps.rpc('crm_funnel_options', {}).catch(() => ({}));
      const data = await deps.rpc('crm_funnel', params());
      if (my !== S.seq) return;
      S.data = data;
    } catch (e) { if (my !== S.seq) return; S.error = e; S.data = null; }
    S.loading = false; draw();
  }
  function mount(root) {
    S.root = root; if (!root) return;
    if (!root.__fnBound) {
      root.__fnBound = true;
      root.addEventListener('change', (e) => { const id = e.target && e.target.id, m = { fnPeriod: 'period', fnSource: 'source', fnCampaign: 'campaign', fnOwner: 'owner', fnVehicle: 'vehicle' }[id]; if (m) { S[m] = e.target.value; load(); } });
      root.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-fn]'); if (!b) return; const a = b.getAttribute('data-fn');
        if (a === 'reload') { S.opts = null; load(); }
        else if (a === 'csv' && S.data && deps.download) deps.download('mechanix-funnel-' + istDay() + '.csv', '﻿' + funnelCsv(normalizeFunnel(S.data), { label: label() }));
        else if (a === 'open' && b.getAttribute('data-id') && deps.openLead) deps.openLead(b.getAttribute('data-id'));
      });
    }
    return load();
  }
  return { mount, state: S, reload: load };
}
