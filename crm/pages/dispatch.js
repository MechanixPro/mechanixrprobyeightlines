import { rpc, head } from '../ui.js';

// Dispatch: paid bookings that are not finished, unassigned first, then by day and slot. Area and PIN, never the phone or street address.
// Assign or reassign a mechanic here; Tell mechanic opens WhatsApp with the job and the job link, and notes it on the booking. Shared with the Admin through crm/flow-core.js.
let rows = [], seen = {}, tell = {};
export async function render(root, ctx) {
  rows = await rpc('crm_dispatch_list', { p_days: 7 });
  seen = rows.length ? await rpc('crm_tech_seen', { p_ids: rows.filter((r) => r.mechanic_id).map((r) => r.id) }).catch(() => ({})) : {};   // mechanic last seen, for jobs On the way or Arrived
  tell = await ctx.flow.loadTell(rows);
  const open = rows.filter((r) => !r.mechanic_id).length;
  root.innerHTML = `${head('Dispatch', 'Paid bookings for the next days. Unassigned ones come first, by slot time. Assign a mechanic, then press Tell mechanic.', '')}
    <p class="small muted" role="status">${rows.length} paid ${rows.length === 1 ? 'booking' : 'bookings'} · <b>${open}</b> without a mechanic</p><div id="dispatchList">${ctx.flow.dispatchHtml(rows, seen, tell)}</div>`;
  const list = root.querySelector('#dispatchList');
  ctx.flow.bindDispatch(list, () => rows, () => tell, () => { list.innerHTML = ctx.flow.dispatchHtml(rows, seen, tell); });
}
