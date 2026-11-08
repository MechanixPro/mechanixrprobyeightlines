import { rpc, head, toast, clean } from '../ui.js';
import { emptyState, errorState, skeleton } from '../ds.js';
import { watchList, watchCard } from '../watch.js';

// Service Watch: every paid job that is stuck or at risk, urgent first, longest stuck first. One tap to call, message, open or reassign. Amounts only for the admin.
export async function render(root, ctx) {
  const title = 'Service Watch', sub = 'Jobs that are stuck or at risk. Urgent first, then the longest stuck.';
  root.innerHTML = head(title, sub) + skeleton(4, 'Loading Service Watch');
  try {
    const list = watchList(await rpc('crm_service_watch'), !!(ctx.me && ctx.me.is_admin));
    const red = list.filter((x) => x.severity === 'red').length;
    root.innerHTML = head(title, sub) + (list.length ? `<p class="small muted" role="status"><b>${red}</b> urgent · ${list.length - red} to watch</p>` + list.map(watchCard).join('') : emptyState({ title: 'Nothing is stuck. All jobs are moving.', text: 'This list refreshes when you open it.' }));
    root.onclick = async (e) => {
      const b = e.target.closest('[data-w]'); if (!b) return;
      const i = list.find((x) => x.lead_id === b.dataset.id); if (!i) return;
      try {
        if (b.dataset.w === 'open') return ctx.openLead(i.lead_id, 'call');
        if (b.dataset.w === 'reassign') { const gd = ctx.garageDesk; if (!gd) return toast('Reassign is not available for your role.', true); return await gd.assignDialog({ lead: { id: i.lead_id, booking_id: i.ref, area: i.area }, moveFrom: i.garage_id || undefined }); }
      } catch (err) { toast(clean(err), true); }
    };
  } catch (e) {
    root.innerHTML = head(title, '') + errorState({ title: 'Service Watch could not load.', detail: clean(e) });
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(root, ctx));
  }
}
