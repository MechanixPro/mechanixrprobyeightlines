import { rpc, esc, head, bar, empty } from '../ui.js';
import { sourceName } from '../crm-rules.js';

const iso = (d) => d.toISOString().slice(0, 10);
const range = { from: null, to: null };

export async function render(root, ctx) {
  const d = await rpc('crm_dashboard', { p_from: range.from, p_to: range.to });
  const L = d.leads, T = d.targets, from = range.from || iso(new Date(d.range.from));
  const card = (n, t, tone = '') => `<div class="stat ${tone}"><b>${n}</b><span>${t}</span></div>`;
  const target = (title, x) => `<div class="stat wide"><span>${title}</span><div class="two-num"><b>${x.daily_done}</b><small>of ${x.daily_target} today</small></div>${bar(x.daily_done, x.daily_target)}
    <div class="two-num"><b>${x.monthly_done}</b><small>of ${x.monthly_target} this month</small></div>${bar(x.monthly_done, x.monthly_target)}</div>`;
  root.innerHTML = `${head('Dashboard', 'Won is a booking that has been completed. Bookings made count toward targets.',
    `<label class="small muted">From <input id="dFrom" type="date" value="${from}"></label><label class="small muted">To <input id="dTo" type="date" value="${range.to || ''}"></label>`)}
    <div class="stat-row">
      ${card(L.total, 'Leads in range')}${card(L.won, `Won (${L.won_pct}%)`, 'good')}${card(L.lost, `Lost (${L.lost_pct}%)`)}${card(d.unassigned, 'Unassigned and open', d.unassigned ? 'bad' : '')}
      ${ctx.page('inbox') ? card(d.chats.unreplied, `Chats waiting of ${d.chats.total}`, d.chats.unreplied ? 'bad' : '') : ''}
    </div>
    <div class="stat-row">${target('Team targets', T.team)}${target('Your targets', T.me)}</div>
    ${d.agents ? `<h3>Care Buddies</h3>${agents(d.agents)}` : ''}
    ${d.attribution ? `<h3>Where leads come from</h3>${attribution(d.attribution)}` : ''}`;
  root.querySelector('#dFrom').addEventListener('change', (e) => { range.from = e.target.value || null; ctx.reload(); });
  root.querySelector('#dTo').addEventListener('change', (e) => { range.to = e.target.value || null; ctx.reload(); });
}

function agents(list) {
  if (!list.length) return empty('No Care Buddies yet. Add the first one in Team.');
  return `<div class="table-wrap"><table><thead><tr><th>Name</th><th class="n">Assigned</th><th class="n">Won</th><th class="n">Won %</th><th class="n">Lost</th><th class="n">Lost %</th><th>Today</th><th>This month</th></tr></thead><tbody>
    ${list.map((a) => `<tr><td>${esc(a.name)} <small class="muted">${esc(a.designation || '')}</small></td><td class="n">${a.assigned}</td><td class="n"><b>${a.won}</b></td><td class="n">${a.won_pct}%</td><td class="n">${a.lost}</td><td class="n">${a.lost_pct}%</td>
      <td class="meter">${a.daily_done} / ${a.daily_target}${bar(a.daily_done, a.daily_target)}</td><td class="meter">${a.monthly_done} / ${a.monthly_target}${bar(a.monthly_done, a.monthly_target)}</td></tr>`).join('')}</tbody></table></div>`;
}

function attribution(list) {
  if (!list.length) return empty('No leads in this range.');
  const max = Math.max(...list.map((x) => x.leads));
  return `<ul class="bars">${list.map((x) => `<li><span>${esc(sourceName(x.platform))}</span><b>${x.leads}</b><i style="width:${Math.round((x.leads / max) * 100)}%"></i><small>${x.share}% · ${x.booked} booked</small></li>`).join('')}</ul>`;
}
