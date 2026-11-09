// Admin WhatsApp supervision (Cloud number +91 83106 21498): read only view of every conversation, both sides, with counts and response times.
// An admin can open any thread and reply or add a note from the shared thread component (wa-thread.js). Admin only: the database refuses everyone else.
import { esc, phoneLabel, waitText, secsText, timeLabel, failText } from './wa-rules.js';
import { createWaThread, paidChip, LOADING, errorBox } from './wa-thread.js';

export const OVER = [['', 'Any'], ['15', 'Over 15 min'], ['30', 'Over 30 min'], ['60', 'Over 60 min']];
const dayStr = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const defaultFilters = (now = new Date()) => ({ agent: '', over: '', from: dayStr(new Date(now.getTime() - 6 * 86400e3)), to: dayStr(now) });
/** IST day boundaries as ISO timestamps for the RPC arguments. */
export const rangeArgs = (f) => ({ p_from: new Date(f.from + 'T00:00:00+05:30').toISOString(), p_to: new Date(f.to + 'T23:59:59.999+05:30').toISOString() });

export function cardsHtml(o) {
  const c = (v, l, tone = '') => `<div class="wa-card ${tone}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  return `<div class="wa-cards">${c(o.open ?? 0, 'Open chats')}${c(o.unassigned ?? 0, 'Unassigned', o.unassigned ? 'warn' : '')}${c(o.unanswered_over ?? 0, `Unanswered over ${o.over_minutes ?? 15} min`, o.unanswered_over ? 'bad' : '')}${c(secsText(o.median_first_response_secs), 'Median first response')}${c(o.inbound ?? 0, 'Customer messages')}${c(o.outbound ?? 0, 'Our messages')}</div>`;
}
export function agentsHtml(agents = []) {
  if (!agents.length) return '<p class="muted small">No staff replies in this period yet.</p>';
  return `<div class="table-wrap"><table class="wa-sup-table"><thead><tr><th>Agent</th><th>Replies</th><th>First responses</th><th>Median first response</th><th>Open chats</th></tr></thead><tbody>${agents.map((a) => `<tr><td>${esc(a.name)}</td><td>${Number(a.replies)}</td><td>${Number(a.first_responses)}</td><td>${esc(secsText(a.median_secs))}</td><td>${Number(a.open_assigned)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function filtersHtml(f, agents = []) {
  return `<div class="wa-sup-filters"><label>Agent<select data-f="agent"><option value="">Everyone</option>${agents.filter((a) => a.user_id).map((a) => `<option value="${esc(a.user_id)}"${f.agent === a.user_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label>Unanswered<select data-f="over">${OVER.map(([v, l]) => `<option value="${v}"${f.over === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>From<input type="date" data-f="from" value="${esc(f.from)}"></label><label>To<input type="date" data-f="to" value="${esc(f.to)}"></label><button class="btn" type="button" data-wa="reload">Refresh</button></div>`;
}
export function tableHtml(rows = []) {
  if (!rows.length) return '<div class="empty">No conversations match these filters.</div>';
  return `<div class="table-wrap"><table class="wa-sup-table"><thead><tr><th>Customer</th><th>Last message</th><th>Handled by</th><th>Messages in / out</th><th>Waiting</th></tr></thead><tbody>${rows.map((r) => `<tr data-phone="${esc(r.phone)}" tabindex="0" role="button" aria-label="Open the conversation with ${esc(r.name || phoneLabel(r.phone))}">
    <td><b>${esc(r.name || phoneLabel(r.phone))}</b> ${paidChip(r.paid)}${r.booking_id ? ` <span class="chip soft">${esc(r.booking_id)}</span>` : ''}<div class="muted small">${esc(phoneLabel(r.phone))}</div></td>
    <td>${esc(r.last_preview || '')}<div class="muted small">${esc(timeLabel(r.last_message_at))}</div></td>
    <td>${r.status === 'closed' ? '<span class="chip soft">Closed</span> ' : ''}${r.assigned_name ? esc(r.assigned_name) : '<span class="chip warn">Unassigned</span>'}</td>
    <td>${Number(r.in_count)} / ${Number(r.out_count)}</td><td>${r.waiting_minutes != null ? `<span class="chip ${r.waiting_minutes > 30 ? 'late' : 'warn'}">${esc(waitText(r.waiting_minutes))}</span>` : '<span class="muted">Answered</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
export const shell = () => `<div class="view-head"><h2>WhatsApp supervision</h2><p class="muted">Every conversation on the website number, both sides. Open one to read it or reply as admin.</p></div>
  <div id="waSupTop">${LOADING}</div><div id="waSupFilters"></div><div id="waSupList"></div><section id="waSupThread" class="wa-thread-pane" aria-label="Conversation" hidden></section>`;

/** deps: { sb, url, anonKey, toast } */
export function createWaDesk(deps) {
  const rpc = async (n, a) => { const { data, error } = await deps.sb.rpc(n, a); if (error) throw error; return data; };
  const thread = createWaThread({ ...deps, onChange: () => {} });
  let root = null, f = defaultFilters(), agents = [], timer = null, token = 0;
  const $ = (s) => root?.querySelector(s);
  async function load(quiet) {
    const my = ++token;
    try {
      const r = rangeArgs(f); const over = f.over ? Number(f.over) : null;
      const [o, rows] = await Promise.all([rpc('admin_wa_overview', { ...r, p_over_minutes: over || 15 }), rpc('admin_wa_list', { p_agent: f.agent || null, p_over_minutes: over, p_from: r.p_from, p_to: r.p_to, p_limit: 200 })]);
      if (my !== token || !root?.isConnected) return;
      agents = o.agents || [];
      $('#waSupTop').innerHTML = cardsHtml(o) + '<h3>By agent</h3>' + agentsHtml(agents);
      $('#waSupFilters').innerHTML = filtersHtml(f, agents); $('#waSupList').innerHTML = tableHtml(rows || []);
    } catch (e) { if (my !== token) return; if (quiet) deps.toast(failText(e), true); else { $('#waSupTop').innerHTML = errorBox(e, 'reload'); } }
  }
  function open(phone) { const t = $('#waSupThread'); t.hidden = false; t.classList.add('thread-open'); thread.open(t, phone); t.scrollIntoView({ block: 'nearest' }); }
  return {
    mount(el) {
      this.unmount(); root = el; root.innerHTML = shell();
      root.addEventListener('click', (ev) => { if (ev.target.closest('[data-wa=reload]') && !ev.target.closest('#waSupThread')) { $('#waSupTop').innerHTML = LOADING; return load(); } const tr = ev.target.closest('tr[data-phone]'); if (tr) open(tr.dataset.phone); if (ev.target.closest('[data-wa-back]')) { $('#waSupThread').hidden = true; thread.close(); } });
      root.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('tr[data-phone]')) open(ev.target.dataset.phone); });
      root.addEventListener('change', (ev) => { const k = ev.target.dataset?.f; if (k) { f = { ...f, [k]: ev.target.value }; load(); } });
      timer = setInterval(() => { if (!root?.isConnected) return this.unmount(); if (document.visibilityState === 'visible') load(true); }, 15000);
      return load();
    },
    unmount() { if (timer) clearInterval(timer); timer = null; thread.close(); root = null; token++; },
  };
}
