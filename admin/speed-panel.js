// Lead speed panel for the Sales page: per-person first-reply table and the longest-waiting leads. Reads the leads the Admin already loaded; names come from crm_users_list.
// No money anywhere in this panel. The HTML builder is pure (tests/speed.test.mjs); mount() wires the period picker and the loading and error states.
import { speedStats, speedByPerson, longestWaiting, fmtMinutes, SPEED_WINDOW_MIN } from './speed.js';
import { skeleton, errorState, emptyState } from './ds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PERIODS = [['d7', 'Last 7 days', 7], ['d30', 'Last 30 days', 30], ['d90', 'Last 90 days', 90]];

export function inPeriod(leads, days, now = Date.now()) {
  const from = now - days * 86400e3;
  return (Array.isArray(leads) ? leads : []).filter((l) => l && Number.isFinite(new Date(l.created_at).getTime()) && new Date(l.created_at).getTime() >= from);
}

export function speedPanelHtml(leads, { names = {}, days = 30, now = Date.now(), bookingRef = (l) => l.booking_id || l.ref || 'Lead' } = {}) {
  const scoped = inPeriod(leads, days, now);
  const all = speedStats(scoped), people = speedByPerson(scoped, names), wait = longestWaiting(scoped, now, 5);
  const pct = (v) => (v == null ? 'n/a' : v + '%');
  const picker = `<label class="mt-f"><span>Period</span><select id="spPeriod" aria-label="Speed period">${PERIODS.map(([k, n, d]) => `<option value="${d}"${d === days ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
  if (!all.leads) return `<div class="card sp-card"><div class="sp-head"><h3>Lead speed</h3>${picker}</div>${emptyState({ title: 'No leads in this period.', text: 'Pick a longer period.' })}</div>`;
  const table = `<div class="sp-scroll"><table class="inv-table sp-table"><thead><tr><th scope="col">Person</th><th scope="col" class="num">Leads</th><th scope="col" class="num">Replied</th><th scope="col" class="num">Median first reply</th><th scope="col" class="num">Within ${SPEED_WINDOW_MIN} min</th><th scope="col" class="num">Waiting</th></tr></thead><tbody>
    ${people.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td class="num">${p.leads}</td><td class="num">${p.replied}</td><td class="num">${fmtMinutes(p.medianMin)}</td><td class="num">${pct(p.pctWithin)}</td><td class="num">${p.waiting}</td></tr>`).join('')}
    <tr class="sp-total"><th scope="row">Everyone</th><td class="num">${all.leads}</td><td class="num">${all.replied}</td><td class="num">${fmtMinutes(all.medianMin)}</td><td class="num">${pct(all.pctWithin)}</td><td class="num">${all.waiting}</td></tr></tbody></table></div>`;
  const list = wait.length ? `<h4 class="sp-h4">Longest waiting for a first contact</h4><ul class="sp-wait">${wait.map((l) => `<li><b>${esc(bookingRef(l))}</b> <span class="muted">${esc(names[l.crm_owner] || (l.crm_owner ? 'Assigned' : 'No owner'))}</span><span class="sp-age">${fmtMinutes(l.waitMin)}</span></li>`).join('')}</ul>` : '<p class="muted small">Nobody is waiting for a first contact.</p>';
  return `<div class="card sp-card"><div class="sp-head"><h3>Lead speed</h3>${picker}</div>
    <div class="kpis sp-kpis"><div class="kpi"><b>${fmtMinutes(all.medianMin)}</b><span>Median first reply</span></div><div class="kpi"><b>${pct(all.pctWithin)}</b><span>Contacted within ${SPEED_WINDOW_MIN} min</span></div><div class="kpi"><b>${all.waiting}</b><span>Not contacted yet</span></div></div>
    ${table}${list}</div>`;
}

export function createSpeedPanel({ rpc, getLeads }) {
  let names = null, days = 30;
  const loadNames = async () => { if (names) return; try { const r = await rpc('crm_users_list'); names = Object.fromEntries((Array.isArray(r) ? r : []).map((u) => [u.user_id, u.name])); } catch (e) { names = {}; } };
  async function mount(root) {
    if (!root) return;
    root.innerHTML = `<div class="card sp-card">${skeleton(2, 'Loading lead speed')}</div>`;
    try { await loadNames(); const leads = getLeads(); if (!Array.isArray(leads)) throw new Error('Leads are not loaded yet.'); draw(root, leads); }
    catch (e) { root.innerHTML = `<div class="card sp-card">${errorState({ title: 'Lead speed could not load.', detail: String((e && e.message) || e) })}</div>`; root.querySelector('[data-retry]')?.addEventListener('click', () => mount(root)); }
  }
  function draw(root, leads) {
    root.innerHTML = speedPanelHtml(leads, { names: names || {}, days });
    root.querySelector('#spPeriod')?.addEventListener('change', (e) => { days = Number(e.target.value) || 30; draw(root, leads); });
  }
  return { mount };
}
