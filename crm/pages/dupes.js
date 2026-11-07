import { rpc, toast } from '../ui.js';
import { createDupes } from '../dupes-view.js';

// Duplicates: customers who share one phone number. Supervisors and admins only (the database checks the merge permission too).
// Money amounts show for admins only. The screen code is shared with the Admin: crm/dupes-view.js.
export async function render(root, ctx) {
  const view = createDupes({ rpc, toast, isAdmin: !!ctx.me?.is_admin, desk: 'crew' });
  await view.mount(root);
}
