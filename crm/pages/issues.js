import { rpc, head } from '../ui.js';

// Issues: problems customers reported from their tracking page (open first, oldest first), and the resolved ones with who resolved them and when.
// Agents see the issues of leads they can see; supervisors and admins see all. Shared screen code with the Admin: crm/flow-core.js.
const st = { status: 'open' };
export async function render(root, ctx) {
  const rows = await rpc('crm_open_issues', { p_status: st.status, p_limit: 100 });
  const open = st.status === 'open' ? rows.length : null;
  root.innerHTML = `${head('Issues', 'Problems customers reported on their tracking page. Open the booking to see their added details and photos, then resolve the issue once it is handled.', '')}
    <div class="flow-seg" role="group" aria-label="Show">${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, t]) => `<button class="flow-btn" type="button" data-f="${k}" aria-pressed="${st.status === k}">${t}</button>`).join('')}</div>
    <p class="small muted" role="status">${open == null ? rows.length + ' shown' : open + ' open'}</p><div id="issueList">${ctx.flow.issuesHtml(rows)}</div>`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; ctx.reload(); }));
  ctx.flow.bindIssues(root.querySelector('#issueList'), () => ctx.reload());
}
