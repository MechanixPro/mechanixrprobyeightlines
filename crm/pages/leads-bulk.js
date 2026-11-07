// Bulk action bar for the Leads list: assign, change status, snooze. Selection rules live in ../bulk.js.
import { rpc, esc, toast, clean, modal, field } from '../ui.js';
import { LOST_REASONS } from '../crm-rules.js';
import { validateAction, summaryText } from '../bulk.js';

const STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['quoted', 'Quoted'], ['payment_sent', 'Payment link sent'], ['lost', 'Lost']];
const RPC = { assign: 'crm_bulk_assign', status: 'crm_bulk_status', snooze: 'crm_bulk_snooze' };

export function bulkBar(count, ctx, users, extra = '') {
  if (!count) return '';
  const assign = ctx.can('assign_leads'), edit = ctx.can('edit_leads');
  return `<div class="bulk-bar" role="region" aria-label="Bulk actions"><b class="bulk-count">${count} selected</b><div class="bulk-acts">
    ${assign && users.length ? '<button class="btn sm" type="button" data-bulk="assign">Assign to…</button>' : ''}
    ${edit ? '<button class="btn sm" type="button" data-bulk="status">Change status…</button><button class="btn sm" type="button" data-bulk="snooze1">Snooze: Tomorrow</button><button class="btn sm" type="button" data-bulk="snooze3">Snooze: 3 days</button>' : ''}
    ${extra}<button class="btn ghost sm" type="button" id="bulkClear">Clear</button></div></div>`;
}

async function run(kind, ids, args, ctx, done) {
  const res = await rpc(RPC[kind], { p_ids: ids, ...args }).catch((e) => {
    const m = String((e && e.message) || e);
    if (/could not find|does not exist|schema cache|404/i.test(m)) throw new Error('Bulk actions are not available yet. The database update has not been applied.');
    throw e;
  });
  const r = Array.isArray(res) ? res[0] : res;
  toast(`${(r && r.done) || 0} updated, ${(r && r.skipped) || 0} skipped`);
  done();
}

const wired = new WeakMap();
// The listener is added once per root (the page re-renders into the same root); fresh state is swapped in each render.
export function bindBulk(root, ctx, picked, users, done) {
  const had = wired.has(root); wired.set(root, { ctx, picked, users, done }); if (had) return;
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-bulk]'); if (b) handle(b.dataset.bulk, wired.get(root)); });
}

function handle(k, { ctx, picked, users, done }) {
  const ids = () => [...picked];
  const isAdmin = ctx.can('view_all_leads');
  const fail = (e) => toast(clean(e), true);
  const sum = (kind, detail) => `<p class="bulk-sum">${esc(summaryText(kind, ids().length, detail, isAdmin))}</p>`;
  if (!ids().length) return;
  {
    if (k === 'assign') {
      const opts = users.filter((u) => u.active).map((u) => [u.user_id, u.name]);
      modal({ title: 'Assign leads', body: sum('assign', '') + field('Assign to', 'to', { type: 'select', blank: 'Choose a person', options: opts, required: true }), submit: 'Confirm assign',
        onSubmit: async (f, d, close) => { const name = (opts.find((o) => o[0] === d.to) || [])[1]; const v = validateAction({ kind: 'assign', to: d.to }, ids().length); if (!v.ok) throw new Error(v.error);
          close(); try { await run('assign', ids(), { p_owner: d.to }, ctx, done); } catch (x) { fail(x); } void name; } });
    } else if (k === 'status') {
      modal({ title: 'Change status', body: sum('status', '') + field('New status', 'status', { type: 'select', blank: 'Choose a status', options: STATUSES, required: true }) + field('Reason (required for Lost)', 'reason', { type: 'select', blank: 'Choose a reason', options: LOST_REASONS.map((r) => [r, r]) }), submit: 'Confirm status change',
        onSubmit: async (f, d, close) => { const v = validateAction({ kind: 'status', status: d.status, reason: d.reason }, ids().length); if (!v.ok) throw new Error(v.error);
          close(); try { await run('status', ids(), { p_status: d.status, p_reason: d.status === 'lost' ? d.reason : null }, ctx, done); } catch (x) { fail(x); } } });
    } else if (k === 'snooze1' || k === 'snooze3') {
      const days = k === 'snooze1' ? 1 : 3;
      modal({ title: 'Snooze leads', body: sum('snooze', String(days)), submit: 'Confirm snooze',
        onSubmit: async (f, d, close) => { close(); try { await run('snooze', ids(), { p_days: days }, ctx, done); } catch (x) { fail(x); } } });
    }
  }
}
