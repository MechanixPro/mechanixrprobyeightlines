import { rpc, esc, head, chips, empty, when, day, tag, STAGE, toast, clean, modal, field, confirmBox, toCsv, downloadFile, debounce } from '../ui.js';
import { sourceName } from '../crm-rules.js';
import { newBooking } from './booking.js';
import { PRESETS, presetRange, presetOf, parseCsv, toImportRows } from '../data-tools.js';
import { exportButtons, bindExports } from '../exports.js';

const FILTERS = [['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['new', 'New'], ['followups', 'Follow-ups'], ['converted', 'Converted'], ['won', 'Won'], ['lost', 'Lost']];
const st = { filter: 'mine', q: '', from: '', to: '', owner: '', picked: new Set() };

export async function render(root, ctx) {
  const all = ctx.can('view_all_leads');
  if (!all && st.filter === 'all') st.filter = 'mine';
  const filters = FILTERS.filter(([k]) => all || k !== 'new');
  const args = { p_filter: st.filter, p_search: st.q || null };
  const [rows, sum] = await Promise.all([
    all ? rpc('crm_leads_list', { ...args, p_owner: st.owner || null, p_from: st.from || null, p_to: st.to || null }) : rpc('crm_my_leads', args),
    rpc('crm_leads_summary', { p_from: st.from || null, p_to: st.to || null, p_owner: st.owner || null })]);
  const users = all && ctx.can('assign_leads') ? await ctx.users() : [];
  const count = (k) => (k === 'all' ? sum.all : sum[k]);
  const tools = `<input id="q" type="search" placeholder="Search name, mobile or ref" value="${esc(st.q)}" aria-label="Search leads">
    ${all ? `<label class="small muted">Range <select id="preset" aria-label="Date range">${[['all', 'All dates'], ...PRESETS].map(([k, t]) => `<option value="${k}"${k === (st.from || st.to ? presetOf(st.from, st.to) : 'all') ? ' selected' : ''}>${t}</option>`).join('')}</select></label><label class="small muted">From <input id="from" type="date" value="${st.from}"></label><label class="small muted">To <input id="to" type="date" value="${st.to}"></label>` : ''}
    ${users.length ? `<select id="owner" aria-label="Care Buddy"><option value="">Everyone</option>${users.filter((u) => u.active).map((u) => `<option value="${u.user_id}"${u.user_id === st.owner ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
    ${ctx.can('create_bookings') ? '<button class="btn primary" type="button" id="newBooking">+ Booking</button>' : ''}${ctx.can('add_leads') ? '<button class="btn" type="button" id="newLead">+ Lead</button>' : ''}${ctx.can('export') ? exportButtons('leads') : ''}${ctx.can('assign_leads') ? '<button class="btn ghost" type="button" id="importLeads">Import leads</button>' : ''}`;
  const sel = st.picked.size;
  root.innerHTML = `${head('Leads', 'Every lead from every source. Open a row to call, message, log what happened or edit the booking.', tools)}
    ${chips(filters.map(([k, t]) => [k, t, ['all', 'converted', 'won', 'followups', 'lost'].includes(k) ? count(k) : null]), st.filter)}
    <p class="small muted">${sum.pct ? `Converted ${sum.pct.converted}% · Won ${sum.pct.won}% · Lost ${sum.pct.lost}% · Follow-ups due ${sum.pct.followups}% of ${sum.all} leads` : ''}</p>
    ${sel && (ctx.can('assign_leads') || ctx.can('delete_leads')) ? `<div class="bulk"><b>${sel} selected</b>${ctx.can('assign_leads') ? '<button class="btn sm" type="button" id="bulkAssign">Assign</button>' : ''}${ctx.can('delete_leads') ? '<button class="btn sm danger" type="button" id="bulkDelete">Delete</button>' : ''}<button class="btn ghost sm" type="button" id="bulkClear">Clear</button></div>` : ''}
    ${rows.length ? table(rows, ctx) : empty('No leads match these filters.')}`;
  bind(root, ctx, rows, users);
}

function table(rows, ctx) {
  const pick = ctx.can('assign_leads') || ctx.can('delete_leads');
  return `<div class="table-wrap"><table class="leads"><thead><tr>${pick ? '<th><input type="checkbox" id="pickAll" aria-label="Select all"></th>' : ''}<th>Lead</th><th>Mobile number</th><th>Source</th><th>Stage</th><th>Owner</th><th>Disposition</th><th>Sub disposition</th><th>Follow-up</th><th>Created date</th><th>Last activity date</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="row-open${r.is_late || r.overdue ? ' late' : ''}" data-id="${r.id}">${pick ? `<td><input type="checkbox" class="pick" data-id="${r.id}" ${st.picked.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.lead)}"></td>` : ''}
      <td><b>${esc(r.lead)}</b><br><small class="muted">${esc([r.bike, r.area].filter(Boolean).join(' · '))}</small></td><td>${esc(r.mobile)}</td><td>${esc(sourceName(r.platform || r.source))}</td>
      <td>${tag(STAGE[r.stage] || r.stage, 'st-' + r.stage)}${r.is_late ? ' ' + tag('Late', 'late') : ''}</td><td>${esc(r.owner_name || 'Unassigned')}</td><td>${esc(r.disposition || '—')}</td><td>${esc(r.sub_disposition || '—')}</td>
      <td class="${r.overdue ? 'badtxt' : ''}">${when(r.follow_up)}</td><td>${day(r.created_at)}</td><td>${when(r.last_activity)}</td></tr>`).join('')}</tbody></table></div>`;
}

function bind(root, ctx, rows, users) {
  const again = () => ctx.reload();
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.f; st.picked.clear(); again(); }));
  const q = root.querySelector('#q');
  q.addEventListener('input', debounce(async () => { st.q = q.value.trim(); await again(); const n = document.querySelector('#q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 350));
  for (const [id, key] of [['from', 'from'], ['to', 'to'], ['owner', 'owner']]) { const el = root.querySelector('#' + id); if (el) el.addEventListener('change', () => { st[key] = el.value; again(); }); }
  root.querySelectorAll('tr.row-open').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('input')) return; ctx.openLead(tr.dataset.id); }));
  root.querySelectorAll('input.pick').forEach((c) => c.addEventListener('change', () => { c.checked ? st.picked.add(c.dataset.id) : st.picked.delete(c.dataset.id); again(); }));
  const all = root.querySelector('#pickAll'); if (all) all.addEventListener('change', () => { rows.forEach((r) => (all.checked ? st.picked.add(r.id) : st.picked.delete(r.id))); again(); });
  const nb = root.querySelector('#newBooking'); if (nb) nb.addEventListener('click', () => newBooking(ctx));
  const nl = root.querySelector('#newLead'); if (nl) nl.addEventListener('click', () => ctx.addLead());
  bindExports(root, () => ({ name: 'leads', what: 'Leads', title: 'Mechanix Pro leads', subtitle: [st.from || st.to ? `${st.from || 'start'} to ${st.to || 'today'}` : 'All dates', st.filter !== 'all' ? 'Filter: ' + st.filter : ''].filter(Boolean).join(' · '), by: ctx.me && ctx.me.name, rows, filters: { filter: st.filter, from: st.from || null, to: st.to || null, owner: st.owner || null, q: st.q || null },
    columns: [['ref', 'Ref'], ['lead', 'Lead'], ['mobile', 'Mobile number'], [(r) => sourceName(r.platform || r.source), 'Source'], [(r) => STAGE[r.stage] || r.stage, 'Stage'], ['owner_name', 'Owner'], ['disposition', 'Disposition'], ['sub_disposition', 'Sub disposition'], ['follow_up', 'Follow-up'], ['created_at', 'Created date'], ['last_activity', 'Last activity date']] }), 'leads');
  const pre = root.querySelector('#preset'); if (pre) pre.addEventListener('change', () => { if (pre.value === 'all') { st.from = ''; st.to = ''; again(); return; } const r = presetRange(pre.value); if (r) { st.from = r.from; st.to = r.to; again(); } });
  const imp = root.querySelector('#importLeads'); if (imp) imp.addEventListener('click', () => importDialog(ctx, again));
  const clear = root.querySelector('#bulkClear'); if (clear) clear.addEventListener('click', () => { st.picked.clear(); again(); });
  const ba = root.querySelector('#bulkAssign'); if (ba) ba.addEventListener('click', () => modal({ title: `Assign ${st.picked.size} leads`, body: field('Care Buddy', 'user', { type: 'select', blank: 'Back to the unassigned queue', options: (users || []).filter((u) => u.active).map((u) => [u.user_id, u.name]) }),
    submit: 'Assign', onSubmit: async (f, d, close) => { const n = await rpc('crm_assign_many', { p_ids: [...st.picked], p_user: d.user || null }); st.picked.clear(); close(); toast(n + ' leads assigned.'); again(); } }));
  const bd = root.querySelector('#bulkDelete'); if (bd) bd.addEventListener('click', () => modal({ title: `Delete ${st.picked.size} leads`, intro: 'Deleted leads leave every list and report. A supervisor can restore them. Give a reason.', danger: true, submit: 'Delete',
    body: field('Reason', 'reason', { type: 'textarea', rows: 2, required: true, max: 200 }), onSubmit: async (f, d, close) => { if (d.reason.length < 3) throw new Error('Write a reason.'); const n = await rpc('crm_delete_leads', { p_ids: [...st.picked], p_reason: d.reason }); st.picked.clear(); close(); toast(n + ' leads deleted.'); again(); } }));
}

function importDialog(ctx, done) {
  let parsed = [];
  modal({ title: 'Import leads from a file', wide: true, intro: 'A CSV file with a name and a mobile number on each row (and an area, if you have it). A header row is read by name. Up to 500 rows. A mobile number that is already an open lead in the last 30 days, or repeats in the file, is skipped. Save an Excel sheet as CSV first.',
    body: `<label class="label" for="impFile">CSV file</label><input id="impFile" type="file" accept=".csv,text/csv"><div id="impPreview" class="small muted" role="status"></div>${field('Where did these leads come from?', 'source', { type: 'select', blank: false, options: [['phone', 'Phone'], ['walk_in', 'Walk-in'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['website', 'Website']] })}<div id="impResult"></div>`,
    submit: 'Import', onOpen: (f) => {
      const file = f.querySelector('#impFile'), pv = f.querySelector('#impPreview');
      file.addEventListener('change', async () => {
        const t = file.files[0]; parsed = []; if (!t) return;
        if (t.size > 1_000_000) { pv.textContent = 'That file is too big. Keep it under 500 rows.'; return; }
        parsed = toImportRows(parseCsv(await t.text())); pv.textContent = parsed.length ? `${parsed.length} rows found. First: ${parsed[0].name || '(no name)'}, ${parsed[0].phone || '(no number)'}.` : 'No rows found in that file.';
      });
    },
    onSubmit: async (f, d) => {
      if (!parsed.length) throw new Error('Choose a CSV file first.'); if (parsed.length > 500) throw new Error('Import at most 500 rows at a time.');
      const r = await rpc('crm_import_leads', { p_rows: parsed, p_source: d.source || 'phone' });
      const list = (a) => a.slice(0, 8).map((x) => `row ${x.row} ${esc(x.name || '')} ${esc(x.phone || '')}`).join(', ') + (a.length > 8 ? ` and ${a.length - 8} more` : '');
      f.querySelector('#impResult').innerHTML = `<p class="alert good"><b>${r.created}</b> leads added.</p>${r.duplicates.length ? `<p class="small"><b>${r.duplicates.length} skipped as duplicates:</b> ${list(r.duplicates)}</p>` : ''}${r.invalid.length ? `<p class="small"><b>${r.invalid.length} skipped, name or mobile number not valid:</b> ${list(r.invalid)}</p>` : ''}`;
      f.querySelector('button[type=submit]').remove(); const c = f.querySelector('[data-close]'); if (c) c.textContent = 'Done'; parsed = []; done();
    } });
}
