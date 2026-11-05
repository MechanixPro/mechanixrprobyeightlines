import { rpc, head } from '../ui.js';

// Dispatch: paid bookings that are not finished, unassigned first, then by day and slot. Area and PIN, never the phone or street address.
// Assign or reassign a mechanic here; the mechanic gets the job link from the lead sheet. Shared with the Admin through crm/flow-core.js.
let rows = [];
export async function render(root, ctx) {
  rows = await rpc('crm_dispatch_list', { p_days: 7 });
  const seen = rows.length ? await rpc('crm_tech_seen', { p_ids: rows.filter((r) => r.mechanic_id).map((r) => r.id) }).catch(() => ({})) : {};   // mechanic last seen, for jobs On the way or Arrived
  const open = rows.filter((r) => !r.mechanic_id).length;
  root.innerHTML = `${head('Dispatch', 'Paid bookings for the next days. Unassigned ones come first, by slot time. Assign a mechanic, then send the job link from the booking.', '')}
    <p class="small muted" role="status">${rows.length} paid ${rows.length === 1 ? 'booking' : 'bookings'} · <b>${open}</b> without a mechanic</p><div id="dispatchList">${ctx.flow.dispatchHtml(rows, seen)}</div>`;
  ctx.flow.bindDispatch(root.querySelector('#dispatchList'), () => rows);
}
