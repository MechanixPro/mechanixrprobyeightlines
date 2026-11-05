import { rpc, esc, empty } from '../ui.js';
import { conversionReport, lastDays, VEHICLES, VEHICLE_LABEL } from '../crm-rules.js';

// Conversion view for supervisors and admins: leads to bookings, by vehicle and by source. The database sends one row per lead and crm-rules.js adds them up.
// Cost per booking is left out on purpose: no ad spend is stored in the desk, and numbers are not invented.
const RANGES = [['today', 'Today', 1], ['d7', 'Last 7 days', 7], ['d30', 'Last 30 days', 30]];
const st = { range: 'd7' };

export async function section(ctx) {
  const days = RANGES.find(([k]) => k === st.range)[2], r = lastDays(days);
  const rows = await rpc('crm_conversion_rows', { p_from: r.from, p_to: r.to });
  const rep = conversionReport(rows, { slaMin: (ctx.me && ctx.me.sla_minutes) || 15 }), t = rep.total, n = rep.slaMin;
  const cell = (m) => `<td class="n">${m.leads}</td><td class="n">${m.withinPct}% <small class="muted">${m.within}/${m.leads}</small></td><td class="n">${m.quotes}</td><td class="n"><b>${m.confirmed}</b> <small class="muted">${m.confirmedPct}%</small></td><td class="n">${m.scheduled}</td><td class="n">${m.done}</td><td class="n">${m.lost}</td>`;
  const table = (first, list, all) => `<div class="table-wrap"><table><thead><tr><th>${first}</th><th class="n">Leads</th><th class="n">Called in ${n} min</th><th class="n">Quotes sent</th><th class="n">Confirmed</th><th class="n">Scheduled or done</th><th class="n">Done</th><th class="n">Lost</th></tr></thead><tbody>
    ${list.map(([name, m]) => `<tr><td>${esc(name)}</td>${cell(m)}</tr>`).join('')}${all ? `<tr><td><b>All</b></td>${cell(all)}</tr>` : ''}</tbody></table></div>`;
  const max = Math.max(1, ...t.lostReasons.map((x) => x.n));
  return `<section id="conv"><h3>Conversion <span class="small muted">${esc(r.from)} to ${esc(r.to)}</span></h3>
    <div class="conv-tools"><label class="small muted">Range <select id="convRange" aria-label="Conversion range">${RANGES.map(([k, l]) => `<option value="${k}"${k === st.range ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="small muted">All sources, website included. Junk is left out. Quotes sent counts leads that reached the quote step or later, from their status today.</span></div>
    ${t.leads ? `<div class="stat-row"><div class="stat"><b>${t.leads}</b><span>Leads</span></div><div class="stat ${t.withinPct >= 50 ? 'good' : 'bad'}"><b>${t.withinPct}%</b><span>Called within ${n} min (${t.within} of ${t.leads})</span></div><div class="stat"><b>${t.quotes}</b><span>Quotes sent</span></div><div class="stat good"><b>${t.confirmed}</b><span>Bookings confirmed (${t.confirmedPct}%)</span></div><div class="stat"><b>${t.scheduled}</b><span>Scheduled or done (${t.done} done)</span></div><div class="stat"><b>${t.lost}</b><span>Lost</span></div></div>
    <h4>By vehicle</h4>${table('Vehicle', VEHICLES.map((v) => [VEHICLE_LABEL[v], rep.byVehicle[v]]), t)}
    <h4>By source</h4>${table('Source', rep.bySource.map((x) => [x.source, x]))}
    <h4>By day</h4>${table('Day', rep.daily.map((x) => [x.date, x]))}
    <h4>Why leads were lost</h4>${t.lostReasons.length ? `<ul class="bars">${t.lostReasons.map((x) => `<li><span>${esc(x.reason)}</span><b>${x.n}</b><i style="width:${Math.round((x.n / max) * 100)}%"></i></li>`).join('')}</ul>` : '<p class="small muted">No lost leads in this range.</p>'}
    <p class="small muted">Cost per booking is not shown: no ad spend is saved in the desk.</p>` : empty('No leads in this range.')}</section>`;
}

export function bind(root, ctx) {
  const s = root.querySelector('#convRange'); if (s) s.addEventListener('change', () => { st.range = s.value; ctx.reload(); });
}
