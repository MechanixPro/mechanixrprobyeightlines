// Duplicates screen, shared by Crew (crm/pages/dupes.js) and Admin (admin/dupes-panel.js). crm/ is the source; admin/ gets a copy.
// Customers that share one phone number. Pick the one to keep, read exactly what moves, confirm, merge. Admins can undo.
// Money shows for admins only. Nothing merges without the confirm dialog. No inline scripts or handlers: one delegated click listener.
import { groupRows, suggestKeeper, mergeConfirmHtml, mergeReason, withoutCustomer, esc, normPhone10, paidBookings } from './dupes.js';
import { skeleton, errorState, emptyState } from './ds.js';

const PAGE = 10;
const dmy = (d) => (d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const clean = (e) => String(e?.message || e || 'Something went wrong').replace(/^Error:\s*/, '');

/** deps: rpc(name, args), toast(msg, bad), isAdmin (boolean), desk ('crew' | 'admin'). */
export function createDupes({ rpc, toast, isAdmin = false, desk = 'crew' }) {
  const S = { rows: [], sums: {}, keep: {}, shown: PAGE, undo: null, busy: false };
  let root = null;

  const cell = (label, v, wide) => `<div class="dp-f${wide ? ' dp-f--wide' : ''}"><span>${esc(label)}</span><b>${v}</b></div>`;
  const card = (r, g) => {
    const s = S.sums[r.customer_id] || {};
    const on = S.keep[g.key] === r.customer_id;
    const bookings = s.bookings ?? r.bookings;
    return `<label class="dp-card${on ? ' on' : ''}"><input type="radio" class="mx-sr" name="k-${esc(g.key)}" value="${esc(r.customer_id)}" data-keep="${esc(g.key)}"${on ? ' checked' : ''}>
      <span class="dp-pick">${on ? 'Keep this one' : 'Keep this one?'}</span>
      <span class="dp-name">${esc(r.name || 'No name')}</span>
      <div class="dp-grid">${cell('Phone', '+91 ' + esc(normPhone10(r.phone)), true)}${cell('Bookings', esc(bookings))}${cell('Paid bookings', esc(paidBookings({ ...r, confirmed_bookings: s.confirmed_bookings })))}${cell('Last visit', esc(dmy(s.last_booking_date)))}${cell('Added', esc(dmy(r.created_at)))}${isAdmin ? cell('Paid total', esc(rupee(r.paid_total))) : ''}</div></label>`;
  };
  const group = (g) => {
    const keepId = S.keep[g.key];
    const others = g.members.filter((m) => m.customer_id !== keepId);
    return `<section class="dp-group mx-card" aria-label="Duplicates for +91 ${esc(g.key)}"><h2 class="dp-h">+91 ${esc(g.key)} <span class="muted">${g.members.length} customers</span></h2>
      <div class="dp-cards">${g.members.map((m) => card(m, g)).join('')}</div>
      <div class="dp-actions">${others.map((o) => `<button class="mx-btn mx-btn--primary" type="button" data-merge="${esc(g.key)}" data-drop="${esc(o.customer_id)}">Merge ${esc(o.name || 'No name')} into the kept one</button>`).join('')}</div></section>`;
  };
  const undoBar = () => (S.undo ? `<div class="mx-notice mx-notice--info dp-undo" role="status"><span>Merged ${esc(S.undo.label)}.</span>${isAdmin ? '<button class="mx-btn mx-btn--sm" type="button" data-undo>Undo this merge</button>' : '<span class="muted">Only an admin can undo a merge.</span>'}</div>` : '');

  function paint() {
    if (!root) return;
    const groups = groupRows(S.rows);
    const list = groups.slice(0, S.shown);
    root.innerHTML = `<div class="dp-wrap"><div class="dp-top"><h1 class="dp-title">Duplicates</h1><p class="muted">Customers who share one phone number. Choose the one to keep, check what moves, then merge. ${isAdmin ? '' : 'Money amounts are for admins.'}</p></div>${undoBar()}
      <p class="dp-count" role="status">${groups.length ? `${groups.length} phone ${groups.length === 1 ? 'number has' : 'numbers have'} duplicates` : ''}</p>
      ${groups.length ? list.map(group).join('') + (groups.length > S.shown ? `<button class="mx-btn dp-more" type="button" data-more>Show more (${groups.length - S.shown} left)</button>` : '') : emptyState({ title: 'No duplicates found.', text: 'Every phone number has one customer.' })}</div>`;
  }

  async function load() {
    root.innerHTML = skeleton(3, 'Loading duplicates');
    try {
      S.rows = (await rpc('crm_duplicate_customers')) || [];
      const groups = groupRows(S.rows);
      S.keep = {}; S.sums = {}; S.shown = PAGE;
      await Promise.all(groups.slice(0, PAGE * 3).flatMap((g) => g.members.map(async (m) => { try { const s = await rpc('crm_customer_summary', { p_customer: m.customer_id }); S.sums[m.customer_id] = Array.isArray(s) ? s[0] : s; } catch (e) { /* summary is optional */ } })));
      for (const g of groups) S.keep[g.key] = suggestKeeper(g.members.map((m) => ({ ...m, confirmed_bookings: S.sums[m.customer_id]?.confirmed_bookings })));
      paint();
    } catch (e) {
      root.innerHTML = `<div class="dp-wrap">${errorState({ title: 'Could not load duplicates.', detail: /permission/i.test(clean(e)) ? 'You do not have permission to merge records. Ask an admin.' : clean(e) })}</div>`;
    }
  }

  function confirmDialog(html) {
    return new Promise((resolve) => {
      const el = document.createElement('div'); el.className = 'modal-back';
      el.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Confirm merge" novalidate><h2>Confirm merge</h2><div class="dp-confirm">${html}</div><p class="err" role="alert"></p><div class="row end"><button class="mx-btn mx-btn--ghost" type="button" data-no>Cancel</button><button class="mx-btn mx-btn--primary" type="submit">Merge</button></div></form>`;
      document.body.appendChild(el);
      const done = (v) => { el.remove(); resolve(v); };
      el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-no]')) done(false); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(true); });
      el.querySelector('[data-no]').focus();
    });
  }

  async function merge(key, dropId) {
    if (S.busy) return;
    const g = groupRows(S.rows).find((x) => x.key === key); if (!g) return;
    const keep = g.members.find((m) => m.customer_id === S.keep[key]), drop = g.members.find((m) => m.customer_id === dropId);
    if (!keep || !drop || keep.customer_id === drop.customer_id) return;
    const withSum = (m) => ({ ...m, bookings: S.sums[m.customer_id]?.bookings ?? m.bookings });
    const ok = await confirmDialog(mergeConfirmHtml(withSum(keep), withSum(drop), { showMoney: isAdmin, rupee }));
    if (!ok) return;
    S.busy = true;
    try {
      const r = await rpc('crm_merge_customers', { p_keep: keep.customer_id, p_drop: drop.customer_id, p_reason: mergeReason(desk) });
      S.rows = withoutCustomer(S.rows, drop.customer_id);
      S.undo = r && r.merge_id && !r.already_merged ? { id: r.merge_id, label: `${drop.name || 'No name'} into ${keep.name || 'No name'}` } : null;
      toast(r?.already_merged ? 'Already merged.' : 'Merged.');
      paint();
    } catch (e) { toast(clean(e), true); } finally { S.busy = false; }
  }

  async function undo() {
    if (!S.undo || S.busy) return;
    S.busy = true;
    try { await rpc('crm_unmerge_customers', { p_merge: S.undo.id }); S.undo = null; toast('Merge undone.'); await load(); }
    catch (e) { toast(clean(e), true); } finally { S.busy = false; }
  }

  function mount(el) {
    root = el; S.undo = null;
    root.onclick = (e) => {
      const t = e.target.closest('[data-merge],[data-undo],[data-more],[data-retry]'); if (!t) return;
      if (t.dataset.merge) merge(t.dataset.merge, t.dataset.drop);
      else if ('undo' in t.dataset) undo();
      else if ('more' in t.dataset) { S.shown += PAGE; paint(); }
      else load();
    };
    root.onchange = (e) => { const k = e.target.closest('[data-keep]'); if (k) { S.keep[k.dataset.keep] = k.value; paint(); } };
    return load();
  }
  return { mount, _state: S };
}
