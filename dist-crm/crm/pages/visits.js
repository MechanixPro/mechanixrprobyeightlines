import { rpc, esc, head, chips, empty, when, tag, modal, field, toast, label } from '../ui.js';

const KIND = [['onboarding', 'Onboarding visit'], ['inspection', 'Inspection'], ['follow_up', 'Follow-up']];
const STATUS = [['scheduled', 'Scheduled'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['no_show', 'No show']];
export const SCORE = [['gap', 'Coverage gap it fills', 20], ['capacity', 'Capacity and bays', 15], ['tools', 'Tools and equipment', 15], ['range', 'Bike range handled', 10], ['compliance', 'Compliance and papers', 10], ['reputation', 'Reputation', 10], ['pricing', 'Pricing fit', 10], ['warranty', 'Warranty and rework policy', 10]];
const st = { status: 'scheduled', from: '', to: '' };

export async function render(root, ctx) {
  const list = await rpc('crm_visits_list', { p_from: st.from || null, p_to: st.to || null, p_status: st.status || null, p_inspector: null });
  root.innerHTML = `${head('Garage Visits', 'Onboarding visits and inspections. A completed visit gives the garage its score out of 100.',
    `<label class="small muted">From <input id="from" type="date" value="${st.from}"></label><label class="small muted">To <input id="to" type="date" value="${st.to}"></label>${ctx.can('schedule_visits') ? '<button class="btn primary" type="button" id="new">+ Visit</button>' : ''}`)}
    ${chips([['scheduled', 'Scheduled'], ['done', 'Done'], ['', 'All']], st.status)}
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Garage</th><th>Type</th><th>Inspector</th><th>Status</th><th class="n">Score</th><th></th></tr></thead><tbody>
      ${list.map((v) => `<tr><td>${when(v.scheduled_at)}</td><td><b>${esc(v.garage)}</b><br><small class="muted">${esc(v.garage_code)} · ${esc(v.mobile)}</small></td><td>${esc(label(KIND, v.kind))}</td><td>${esc(v.inspector || 'Not assigned')}</td><td>${tag(label(STATUS, v.status), v.status === 'done' ? 'st-completed' : 'st-new')}</td><td class="n">${v.score ?? '—'}</td>
      <td>${ctx.can('schedule_visits') && v.status === 'scheduled' ? `<button class="btn sm" type="button" data-done="${v.id}">Complete</button> <button class="btn ghost sm" type="button" data-edit="${v.id}">Change</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No visits in this view.')}`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; ctx.reload(); }));
  for (const k of ['from', 'to']) root.querySelector('#' + k).addEventListener('change', (e) => { st[k] = e.target.value; ctx.reload(); });
  const nb = root.querySelector('#new'); if (nb) nb.addEventListener('click', () => schedule(ctx));
  root.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => complete(b.dataset.done, list.find((v) => v.id === b.dataset.done), ctx)));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => change(list.find((v) => v.id === b.dataset.edit), ctx)));
}

const local = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function schedule(ctx, garageId) {
  const [garages, people] = await Promise.all([rpc('crm_garage_picker'), rpc('crm_inspectors').catch(() => [])]);
  const t = new Date(Date.now() + 86400e3); t.setHours(10, 0, 0, 0);
  modal({ title: 'Schedule a visit', body: `${field('Garage', 'garage', { type: 'select', required: true, value: garageId, options: garages.map((g) => [g.id, `${g.name} · ${g.code}`]) })}${field('Type', 'kind', { type: 'select', blank: false, options: KIND })}
    <div class="grid2">${field('Date and time', 'when', { type: 'datetime-local', value: local(t), required: true, half: true })}${field('Inspector', 'inspector', { type: 'select', blank: 'Decide later', options: people.map((p) => [p.user_id, p.name]), half: true })}</div>
    ${field('Address (leave blank to use the garage address)', 'address', { max: 300 })}${field('Notes', 'notes', { type: 'textarea', rows: 2 })}`,
    submit: 'Schedule', onSubmit: async (f, d, close) => {
      await rpc('crm_visit_schedule', { p_garage: d.garage, p_kind: d.kind, p_when: new Date(d.when).toISOString(), p_address: d.address || null, p_inspector: d.inspector || null, p_notes: d.notes || null });
      close(); toast('Visit scheduled.'); ctx.reload(); } });
}

async function change(v, ctx) {
  const people = await rpc('crm_inspectors').catch(() => []);
  modal({ title: 'Change visit', body: `${field('Date and time', 'when', { type: 'datetime-local', value: local(v.scheduled_at) })}${field('Inspector', 'inspector', { type: 'select', blank: 'Not assigned', value: v.inspector_id || '', options: people.map((p) => [p.user_id, p.name]) })}
    ${field('Status', 'status', { type: 'select', blank: false, value: v.status, options: STATUS })}${field('Notes', 'notes', { type: 'textarea', rows: 2, value: v.notes })}`,
    onSubmit: async (f, d, close) => { await rpc('crm_visit_update', { p_id: v.id, p_when: new Date(d.when).toISOString(), p_inspector: d.inspector || null, p_status: d.status, p_notes: d.notes || null, p_clear_inspector: !d.inspector }); close(); toast('Saved.'); ctx.reload(); } });
}

function complete(id, v, ctx) {
  modal({ title: `Score ${v.garage}`, intro: 'Score each area up to its maximum. 70 or more can go live. 80 is silver, 90 is gold.', wide: true,
    body: `<div class="grid2">${SCORE.map(([k, t, max]) => field(`${t} (max ${max})`, k, { type: 'number', min: 0, max, value: 0, half: true })).join('')}</div><p class="quote" id="tot">Total: 0 / 100</p>${field('Notes', 'notes', { type: 'textarea', rows: 2 })}`,
    submit: 'Complete visit', onOpen: (f) => f.addEventListener('input', () => { f.querySelector('#tot').textContent = 'Total: ' + SCORE.reduce((n, [k]) => n + (Number(f[k].value) || 0), 0) + ' / 100'; }),
    onSubmit: async (f, d, close) => {
      const scores = Object.fromEntries(SCORE.map(([k]) => [k, Number(d[k]) || 0]));
      const total = await rpc('crm_visit_complete', { p_id: id, p_scores: scores, p_notes: d.notes || null });
      close(); toast('Visit completed. Score ' + total + '.'); ctx.reload(); } });
}
