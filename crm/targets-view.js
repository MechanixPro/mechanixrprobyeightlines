// Sales targets: HTML builders shared by Crew (My day) and the Admin (Sales page). crm/targets-view.js is the source, admin/targets-view.js an identical copy.
// Pure strings, everything escaped. Counts only, never money. Rules live in targets.js.
import { statusTone } from './targets.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (s) => `<span class="tg-pill tg-${statusTone(s)}">${esc(s)}</span>`;

/** One progress bar per metric. Rows come from metricRows(). Metrics without a target show the count only. */
export function barsHtml(rows) {
  return `<ul class="tg-bars">${rows.map((r) => `<li><div class="tg-line"><span class="tg-label">${esc(r.label)}</span><b class="tg-num">${r.actual}${r.target ? ' of ' + r.target : ''}</b>${r.status === 'No target' ? '' : pill(r.status)}</div>${r.target ? `<div class="tg-track" role="progressbar" aria-label="${esc(r.label)}" aria-valuemin="0" aria-valuemax="${r.target}" aria-valuenow="${Math.min(r.actual, r.target)}"><span class="tg-fill tg-${statusTone(r.status)}" style="width:${r.width}%"></span></div>` : '<div class="tg-none">No target set</div>'}</li>`).join('')}</ul>`;
}

/** The signed-in member's card: today and this week. mine = { day: row, week: row } from myRows(). */
export function myTargetsHtml(mine) {
  if (!mine) return '';
  const blk = (title, r) => `<div class="tg-block"><div class="tg-bh"><h3>${esc(title)}</h3>${pill(r.status)}</div>${barsHtml(r.rows)}</div>`;
  if (mine.day.status === 'No target' && mine.week.status === 'No target') return `<section class="card tg-card" aria-label="Your targets"><h3>Your targets</h3><p class="muted">No targets set for you yet. Ask your admin.</p></section>`;
  return `<section class="card tg-card" aria-label="Your targets"><div class="tg-cols">${blk('Today', mine.day)}${blk('This week', mine.week)}</div></section>`;
}

/** Admin team table for one period: one row per person with a short count and status per metric. */
export function teamTableHtml(team) {
  const cell = (r) => `<td class="num">${r.target ? `${r.actual}/${r.target}` : `${r.actual}`}${r.target ? `<div class="tg-mini"><span class="tg-fill tg-${statusTone(r.status)}" style="width:${r.width}%"></span></div>` : ''}</td>`;
  return `<div class="sp-scroll"><table class="inv-table sp-table tg-table"><thead><tr><th scope="col">Person</th><th scope="col" class="num">Calls</th><th scope="col" class="num">Quotes</th><th scope="col" class="num">Paid</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>
    ${team.map((p) => `<tr><th scope="row">${esc(p.name)}</th>${p.rows.map(cell).join('')}<td>${pill(p.status)}</td><td><button type="button" class="btn sm" data-tg-set="${esc(p.id)}">Set targets</button></td></tr>`).join('')}</tbody></table></div>`;
}
