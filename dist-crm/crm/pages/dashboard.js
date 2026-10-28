import { rpc, esc, head, bar, empty } from '../ui.js';
import { sourceName } from '../crm-rules.js';
import { PRESETS, presetRange, presetOf } from '../data-tools.js';
import { exportButtons, bindExports } from '../exports.js';

const iso = (d) => d.toISOString().slice(0, 10);
const range = { from: null, to: null };

export async function render(root, ctx) {
  const [d, rt, fc, duty] = await Promise.all([rpc('crm_dashboard', { p_from: range.from, p_to: range.to }), rpc('crm_rating_summary', { p_from: range.from, p_to: range.to }).catch(() => null), rpc('crm_followup_capacity', { p_from: range.from, p_to: range.to }).catch(() => null), rpc('crm_on_duty').catch(() => null)]);
  const L = d.leads, T = d.targets, from = range.from || iso(new Date(d.range.from));
  const card = (n, t, tone = '') => `<div class="stat ${tone}"><b>${n}</b><span>${t}</span></div>`;
  const target = (title, x) => `<div class="stat wide"><span>${title}</span><div class="two-num"><b>${x.daily_done}</b><small>of ${x.daily_target} today</small></div>${bar(x.daily_done, x.daily_target)}
    <div class="two-num"><b>${x.monthly_done}</b><small>of ${x.monthly_target} this month</small></div>${bar(x.monthly_done, x.monthly_target)}</div>`;
  root.innerHTML = `${head('Dashboard', 'Won is a booking that has been completed. Bookings made count toward targets.',
    `<label class="small muted">Range <select id="dPreset" aria-label="Date range">${PRESETS.map(([k, t]) => `<option value="${k}"${k === presetOf(range.from || from, range.to || new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)) ? ' selected' : ''}>${t}</option>`).join('')}</select></label><label class="small muted">From <input id="dFrom" type="date" value="${from}"></label><label class="small muted">To <input id="dTo" type="date" value="${range.to || ''}"></label>`)}
    <div class="stat-row">
      ${card(L.total, 'Leads in range')}${card(L.won, `Won (${L.won_pct}%)`, 'good')}${card(L.lost, `Lost (${L.lost_pct}%)`)}${card(d.unassigned, 'Unassigned and open', d.unassigned ? 'bad' : '')}
      ${rt && rt.count ? card(`${rt.avg}/5`, `Average rating (${rt.count} ${rt.count === 1 ? 'rating' : 'ratings'}${rt.low ? ', ' + rt.low + ' low' : ''})`, rt.avg >= 4 ? 'good' : rt.avg < 3.5 ? 'bad' : '') : ''}
      ${ctx.page('inbox') ? card(d.chats.unreplied, `Chats waiting of ${d.chats.total}`, d.chats.unreplied ? 'bad' : '') : ''}
    </div>
    ${duty ? `<p class="small"><b>On duty today:</b> ${duty.on.length ? duty.on.map(esc).join(', ') : 'nobody listed'}${duty.off.length ? ` <span class="muted">· Not working: ${duty.off.map((x) => esc(x.name) + ' (' + (x.status === 'leave' ? 'leave' : 'off') + ')').join(', ')}</span>` : ''}</p>` : ''}
    ${fc ? `<h3>Follow-ups</h3><div class="stat-row">${card(fc.overdue, 'Overdue', fc.overdue ? 'bad' : '')}${card(fc.today, 'Due today')}${card(fc.upcoming, 'Scheduled later')}${card(fc.none, 'Owned, no follow-up set', fc.none ? 'bad' : '')}${card(fc.contacts, 'Calls and WhatsApp logged')}</div>` : ''}
    <div class="stat-row">${target('Team targets', T.team)}${target('Your targets', T.me)}</div>
    ${d.agents ? `<h3>Care Buddies <span class="small muted">${exportButtons('team')}</span></h3>${agents(d.agents, fc && fc.agents)}` : ''}
    ${d.attribution ? `<h3>Where leads come from</h3>${attribution(d.attribution)}` : ''}`;
  const pre = root.querySelector('#dPreset'); pre.addEventListener('change', () => { const r = presetRange(pre.value); if (r) { range.from = r.from; range.to = r.to; ctx.reload(); } });
  if (d.agents) bindExports(root, () => { const cap = new Map(((fc && fc.agents) || []).map((x) => [x.user_id, x])); return { name: 'team-performance', what: 'Team performance', title: 'Mechanix Pro team performance', subtitle: `${from} to ${range.to || 'today'}`, by: ctx.me && ctx.me.name, rows: d.agents, filters: { from: range.from, to: range.to },
    columns: [['name', 'Care Buddy'], ['assigned', 'Assigned'], ['won', 'Won'], ['won_pct', 'Won %'], ['lost', 'Lost'], ['lost_pct', 'Lost %'], ['daily_done', 'Won today'], ['monthly_done', 'Won this month'], [(a) => (cap.get(a.user_id) || {}).open ?? '', 'Open leads'], [(a) => (cap.get(a.user_id) || {}).load_pct ?? '', 'Load % of capacity'], [(a) => (cap.get(a.user_id) || {}).overdue ?? '', 'Overdue follow-ups'], [(a) => (cap.get(a.user_id) || {}).contacts ?? '', 'Calls and WhatsApp logged']] }; }, 'team');
  root.querySelector('#dFrom').addEventListener('change', (e) => { range.from = e.target.value || null; ctx.reload(); });
  root.querySelector('#dTo').addEventListener('change', (e) => { range.to = e.target.value || null; ctx.reload(); });
}

function agents(list, caps) {
  const cap = new Map((caps || []).map((x) => [x.user_id, x]));
  if (!list.length) return empty('No Care Buddies yet. Add the first one in Team.');
  return `<div class="table-wrap"><table><thead><tr><th>Name</th><th class="n">Assigned</th><th class="n">Won</th><th class="n">Won %</th><th class="n">Lost</th><th class="n">Lost %</th><th>Today</th><th>This month</th>${caps ? '<th>Workload</th><th class="n">Overdue</th><th class="n">Due today</th><th class="n">Contacts</th>' : ''}</tr></thead><tbody>
    ${list.map((a) => `<tr><td>${esc(a.name)} <small class="muted">${esc(a.designation || '')}</small></td><td class="n">${a.assigned}</td><td class="n"><b>${a.won}</b></td><td class="n">${a.won_pct}%</td><td class="n">${a.lost}</td><td class="n">${a.lost_pct}%</td>
      <td class="meter">${a.daily_done} / ${a.daily_target}${bar(a.daily_done, a.daily_target)}</td><td class="meter">${a.monthly_done} / ${a.monthly_target}${bar(a.monthly_done, a.monthly_target)}</td>${caps ? (() => { const c = cap.get(a.user_id); return c ? `<td class="meter">${c.open} of ${c.capacity} open${bar(Math.min(c.open, c.capacity), c.capacity)}${c.load_pct > 100 ? '<small class="badtxt">Over capacity</small>' : ''}</td><td class="n ${c.overdue ? 'badtxt' : ''}">${c.overdue}</td><td class="n">${c.today}</td><td class="n">${c.contacts}</td>` : '<td></td><td></td><td></td><td></td>'; })() : ''}</tr>`).join('')}</tbody></table></div>`;
}

function attribution(list) {
  if (!list.length) return empty('No leads in this range.');
  const max = Math.max(...list.map((x) => x.leads));
  return `<ul class="bars">${list.map((x) => `<li><span>${esc(sourceName(x.platform))}</span><b>${x.leads}</b><i style="width:${Math.round((x.leads / max) * 100)}%"></i><small>${x.share}% · ${x.booked} booked</small></li>`).join('')}</ul>`;
}
