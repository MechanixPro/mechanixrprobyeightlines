import { rpc, esc, head, chips, empty, when, tag, STAGE } from '../ui.js';
import { sourceName } from '../crm-rules.js';

const st = { filter: 'open', q: '' };

export async function render(root, ctx) {
  const rows = await rpc('crm_web_leads', { p_filter: st.filter, p_search: st.q || null });
  root.innerHTML = `${head('Web leads', 'Bookings made on mechanixpro.in. They are kept apart from the desk numbers. Open one to call, take it or log what happened.',
    `<input id="wq" type="search" placeholder="Search name, mobile or ref" value="${esc(st.q)}" aria-label="Search web leads">`)}
    ${chips([['open', 'Open', null], ['all', 'All', null]], st.filter)}
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Name</th><th>Mobile</th><th>Service</th><th>Area</th><th>Status</th><th>Owner</th><th>Booked</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="row-open" data-id="${r.id}"><td>${esc(r.booking_id || 'Lead')}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.phone)}</td><td>${esc(r.service || '')}</td><td>${esc(r.area || '')}</td><td>${tag(STAGE[r.status] || r.status)}</td><td>${esc(r.owner || 'Unassigned')}</td><td>${when(r.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No web leads here.')}`;
  root.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('click', () => { st.filter = c.dataset.f; ctx.reload(); }));
  root.querySelectorAll('tr.row-open').forEach((r) => r.addEventListener('click', () => ctx.openLead(r.dataset.id)));
  const q = root.querySelector('#wq');
  q.addEventListener('change', () => { st.q = q.value.trim(); ctx.reload(); });
}
