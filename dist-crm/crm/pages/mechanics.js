import { rpc, esc, head, chips, empty, tag, modal, field, toast, label, PIPE } from '../ui.js';

const SKILLS = [['two-wheeler', 'Two-wheeler'], ['scooter', 'Scooter'], ['royal-enfield', 'Royal Enfield'], ['electric', 'Electric'], ['tyre', 'Tyre'], ['battery', 'Battery'], ['superbike', 'Superbike']];
const DOCS = [['agreement', 'Signed agreement'], ['training', 'Training done'], ['photo', 'Photo on file'], ['id_seen', 'ID seen (do not store the number)'], ['address_seen', 'Address checked']];
const SHIFTS = [['morning', 'Morning'], ['day', 'Day'], ['evening', 'Evening'], ['full', 'Full day']];
const st = { status: '', q: '' };

export async function render(root, ctx) {
  const list = await rpc('crm_mechanic_list', { p_status: st.status || null, p_search: st.q || null, p_skill: null });
  root.innerHTML = `${head('Mechanics', 'Onboard each mechanic one step at a time. Going live needs the full checklist, skills and service PIN codes.',
    `<input id="q" type="search" placeholder="Search name or mobile" value="${esc(st.q)}" aria-label="Search mechanics">${ctx.can('manage_mechanics') ? '<button class="btn primary" type="button" id="new">+ Mechanic</button>' : ''}`)}
    ${chips([['', 'All'], ...PIPE.map(([k, t]) => [k, t])], st.status)}
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th>Stage</th><th>Skills</th><th>PIN codes</th><th>Garage</th><th class="n">Checklist</th><th></th></tr></thead><tbody>
      ${list.map((m) => `<tr><td><b>${esc(m.name)}</b><br><small class="muted">${esc(m.area || '')}</small></td><td>${esc(m.phone)}</td><td>${tag(label(PIPE, m.status), m.status === 'live' ? 'st-completed' : m.status === 'paused' ? 'late' : 'st-new')}</td><td>${esc((m.skills || []).join(', ') || '—')}</td><td>${esc((m.pincodes || []).join(', ') || '—')}</td><td>${esc(m.garage || '—')}</td><td class="n">${m.docs_done} / 5</td>
      <td>${ctx.can('manage_mechanics') ? `<button class="btn sm" type="button" data-edit="${m.id}">Edit</button> ${step(m)}` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No mechanics in this view.')}`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; ctx.reload(); }));
  const q = root.querySelector('#q'); q.addEventListener('change', () => { st.q = q.value.trim(); ctx.reload(); });
  const nb = root.querySelector('#new'); if (nb) nb.addEventListener('click', () => edit(null, ctx));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(list.find((m) => m.id === b.dataset.edit), ctx)));
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => move(b.dataset.step, b.dataset.to, ctx)));
}

const NEXT = { applied: 'visited', visited: 'kyc_done', kyc_done: 'trained', trained: 'pilot', pilot: 'live' };
const step = (m) => (m.status === 'paused' ? `<button class="btn ghost sm" type="button" data-step="${m.id}" data-to="live">Resume</button>` : NEXT[m.status] ? `<button class="btn ghost sm" type="button" data-step="${m.id}" data-to="${NEXT[m.status]}">Mark ${esc(label(PIPE, NEXT[m.status]))}</button> <button class="btn ghost sm" type="button" data-step="${m.id}" data-to="paused">Pause</button>` : `<button class="btn ghost sm" type="button" data-step="${m.id}" data-to="paused">Pause</button>`);

function move(id, to, ctx) {
  const run = async (note) => { await rpc('crm_mechanic_set_status', { p_id: id, p_status: to, p_note: note || null }); toast('Updated.'); ctx.reload(); };
  if (to === 'paused') return modal({ title: 'Pause this mechanic', body: field('Why?', 'note', { required: true, max: 200 }), submit: 'Pause', onSubmit: async (f, d, close) => { await run(d.note); close(); } });
  run().catch((e) => toast(e.message, true));
}

async function edit(m, ctx) {
  let garages = []; try { garages = await rpc('crm_garage_picker'); } catch (e) { garages = []; }
  modal({ title: m ? 'Edit mechanic' : 'New mechanic', wide: true, intro: 'Never enter Aadhaar or PAN numbers. Tick that the ID was seen instead.',
    body: `<div class="grid2">${field('Name', 'name', { required: true, value: m?.name, half: true })}${field('Mobile number', 'phone', { type: 'tel', inputmode: 'tel', required: true, value: m?.phone, half: true })}
      ${field('Area', 'area', { value: m?.area, half: true })}${field('Experience (years)', 'experience_years', { type: 'number', min: 0, max: 60, value: m?.experience_years, half: true })}
      ${field('Shift', 'shift', { type: 'select', value: m?.shift, options: SHIFTS, half: true })}${garages.length ? field('Garage', 'garage_id', { type: 'select', blank: 'Independent', value: m?.garage_id || '', options: garages.map((g) => [g.id, g.name]), half: true }) : ''}</div>
      ${field('Skills', 'skills', { type: 'checks', value: m?.skills || [], options: SKILLS })}${field('Service PIN codes (comma separated)', 'pincodes', { value: (m?.pincodes || []).join(', ') })}
      ${field('Languages (comma separated)', 'languages', { value: (m?.languages || []).join(', ') })}${field('Checklist', 'docs', { type: 'checks', value: DOCS.filter(([k]) => m?.docs?.[k] === true || m?.docs?.[k] === 'true').map(([k]) => k), options: DOCS })}`,
    submit: 'Save', onSubmit: async (f, d, close) => {
      const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      await rpc('crm_mechanic_save', { p: { id: m?.id || null, name: d.name, phone: d.phone, area: d.area, experience_years: d.experience_years, shift: d.shift || null, garage_id: d.garage_id || null, skills: d.skills || [], pincodes: list(d.pincodes), languages: list(d.languages),
        docs: Object.fromEntries(DOCS.map(([k]) => [k, (d.docs || []).includes(k)])) } });
      close(); toast('Saved.'); ctx.reload(); } });
}
