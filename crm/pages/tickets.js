import { rpc, esc, head, chips, empty, when, tag, modal, field, toast, label } from '../ui.js';

const CATS = [['escalation', 'Escalation'], ['booking_issue', 'Booking issue'], ['roadside', 'Roadside assistance'], ['legal_accident', 'Legal or accident'], ['garage_issue', 'Garage partner issue'], ['garage_inspection', 'Garage inspection']];
const STATUS = [['open', 'Open'], ['in_progress', 'In progress'], ['waiting', 'Waiting'], ['resolved', 'Resolved']];
const PRI = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['critical', 'Critical']];
const st = { status: '', mine: false };

export async function render(root, ctx) {
  const list = await rpc('crm_tickets_list', { p_status: st.status || null, p_category: null, p_mine: st.mine });
  root.innerHTML = `${head('Tickets', 'Escalations, booking issues, roadside cases, garage issues and inspections. Legal or accident tickets are seen by supervisors only.',
    `${ctx.can('create_tickets') ? '<button class="btn primary" type="button" id="new">+ Ticket</button>' : ''}`)}
    ${chips([['', 'All'], ...STATUS.map(([k, t]) => [k, t])], st.status)}<label class="check inline"><input type="checkbox" id="mine" ${st.mine ? 'checked' : ''}><span>Only mine</span></label>
    ${list.length ? `<div class="cards">${list.map(card).join('')}</div>` : empty('No tickets here.')}`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; ctx.reload(); }));
  root.querySelector('#mine').addEventListener('change', (e) => { st.mine = e.target.checked; ctx.reload(); });
  root.querySelectorAll('[data-open]').forEach((c) => c.addEventListener('click', () => open(c.dataset.open, ctx)));
  const nb = root.querySelector('#new'); if (nb) nb.addEventListener('click', () => create(ctx));
}

const card = (t) => `<article class="lead-card tone-${t.priority === 'critical' || t.priority === 'high' ? 'late' : t.status === 'resolved' ? 'good' : 'next'}" data-open="${t.id}" tabindex="0" role="button">
  <div class="lc-top"><div><h2>${esc(t.title)}</h2><p class="muted small">${esc(t.code)} · ${esc(label(CATS, t.category))}</p></div>${tag(label(STATUS, t.status), t.status === 'resolved' ? 'st-completed' : 'st-new')}</div>
  <div class="lc-meta">${tag(label(PRI, t.priority), t.priority === 'critical' || t.priority === 'high' ? 'late' : 'soft')}${t.legal ? tag('Supervisors only', 'late') : ''}<span class="small muted">${esc(t.owner || 'No owner')} · ${when(t.created_at)}</span></div>
  ${t.lead || t.garage ? `<p class="small muted">${esc(t.lead ? 'Lead: ' + t.lead : 'Garage: ' + t.garage)}</p>` : ''}</article>`;

async function create(ctx, pre = {}) {
  let garages = []; try { garages = await rpc('crm_garage_picker'); } catch (e) { garages = []; }
  modal({ title: 'New ticket', body: `${field('Category', 'category', { type: 'select', required: true, options: CATS, value: pre.category })}${field('Title', 'title', { required: true, max: 120, value: pre.title })}${field('Details', 'body', { type: 'textarea', max: 1500, hint: 'Never write Aadhaar, PAN, bank or card numbers.' })}
    <div class="grid2">${field('Priority', 'priority', { type: 'select', blank: false, options: PRI, value: 'normal', half: true })}${garages.length ? field('Garage (for garage tickets)', 'garage', { type: 'select', blank: 'None', options: garages.map((g) => [g.id, `${g.name} · ${g.code}`]), half: true }) : ''}</div>`,
    submit: 'Create ticket', onSubmit: async (f, d, close) => {
      const r = await rpc('crm_ticket_create', { p_category: d.category, p_title: d.title, p_body: d.body || null, p_priority: d.priority, p_lead: pre.lead || null, p_garage: d.garage || null, p_rsa: pre.rsa || null });
      close(); toast(r.legal ? 'Legal ticket raised. Supervisors have been alerted.' : `Ticket ${r.code} raised.`); ctx.reload(); } });
}
export { create as newTicket };

async function open(id, ctx) {
  const { ticket: t, notes } = await rpc('crm_ticket_get', { p_id: id });
  const users = ctx.can('assign_leads') ? await ctx.users() : [];
  const canResolve = ctx.can('resolve_tickets');
  const m = modal({ title: `${t.code}: ${t.title}`, cancel: 'Close', wide: true,
    body: `<p class="muted small">${esc(label(CATS, t.category))} · raised by ${esc(t.created_by_name || '—')} · ${when(t.created_at)}</p>${t.body ? `<p class="note-box">${esc(t.body)}</p>` : ''}
      <div class="grid2">${field('Status', 'status', { type: 'select', blank: false, value: t.status, options: STATUS.filter(([k]) => canResolve || k !== 'resolved'), half: true })}${field('Priority', 'priority', { type: 'select', blank: false, value: t.priority, options: PRI, half: true })}
      ${users.length ? field('Owner', 'owner', { type: 'select', blank: 'Nobody', value: t.owner || '', options: users.filter((u) => u.active).map((u) => [u.user_id, u.name]), half: true }) : ''}</div>
      <button class="btn" type="button" id="saveT">Save changes</button>
      <h3>Notes</h3><ul class="timeline">${notes.length ? notes.map((n) => `<li><b>${esc(n.actor || 'System')}</b> <span class="muted small">${when(n.created_at)}</span><p>${esc(n.body)}</p></li>`).join('') : '<li class="muted">No notes yet.</li>'}</ul>
      ${field('Add a note', 'note', { type: 'textarea', rows: 2, max: 1000 })}<button class="btn primary" type="button" id="addN">Add note</button>` });
  const f = m.form;
  f.querySelector('#saveT').addEventListener('click', async () => {
    try { await rpc('crm_ticket_set', { p_id: id, p_status: f.status.value, p_priority: f.priority.value, p_owner: f.owner && f.owner.value ? f.owner.value : null }); toast('Saved.'); m.close(); ctx.reload(); } catch (e) { f.querySelector('.err').textContent = e.message; }
  });
  f.querySelector('#addN').addEventListener('click', async () => {
    const v = f.note.value.trim(); if (!v) return;
    try { await rpc('crm_ticket_note', { p_id: id, p_body: v }); toast('Note added.'); m.close(); open(id, ctx); } catch (e) { f.querySelector('.err').textContent = e.message; }
  });
}
