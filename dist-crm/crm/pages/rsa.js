import { rpc, esc, head, chips, empty, when, tag, modal, field, toast, label, PROBLEMS } from '../ui.js';

const STATUS = [['new', 'New'], ['guiding', 'Guiding on the phone'], ['dispatched', 'Dispatched'], ['on_the_way', 'On the way'], ['working', 'Working on it'], ['resolved_phone', 'Resolved on the phone'], ['resolved_onsite', 'Resolved on site'], ['towed', 'Towed'], ['cancelled', 'Cancelled']];
const st = { open: true };

export async function render(root, ctx) {
  const list = await rpc('crm_rsa_list', { p_status: null, p_open_only: st.open });
  root.innerHTML = `${head('RSA Cases', 'Roadside assistance. Check the rider is safe first, then guide on the phone or dispatch.', `${ctx.can('manage_rsa') ? '<button class="btn primary" type="button" id="new">+ RSA case</button>' : ''}`)}
    ${chips([['1', 'Open'], ['0', 'All']], st.open ? '1' : '0')}
    ${list.length ? `<div class="cards">${list.map(card).join('')}</div>` : empty('No roadside cases here.')}`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.open = b.dataset.f === '1'; ctx.reload(); }));
  root.querySelectorAll('[data-open]').forEach((c) => c.addEventListener('click', () => open(c.dataset.open, ctx)));
  const nb = root.querySelector('#new'); if (nb) nb.addEventListener('click', () => create(ctx));
}

const card = (c) => `<article class="lead-card tone-${c.priority === 'critical' ? 'late' : c.priority === 'high' ? 'next' : 'new'}" data-open="${c.id}" tabindex="0" role="button">
  <div class="lc-top"><div><h2>${esc(c.customer_name)}</h2><p class="muted small">${esc(c.code)} · ${esc(label(PROBLEMS, c.problem))}${c.brand ? ' · ' + esc([c.brand, c.model].filter(Boolean).join(' ')) : ''}</p></div>${tag(label(STATUS, c.status), 'st-new')}</div>
  <div class="lc-meta">${tag(c.priority, c.priority === 'normal' ? 'soft' : 'late')}${c.injured ? tag('Injury reported', 'late') : ''}${c.rider_safe ? '' : tag('Rider not safe', 'late')}<span class="small muted">${c.eta_minutes ? 'ETA ' + c.eta_minutes + ' min · ' : ''}${esc(c.mechanic || 'No mechanic yet')} · ${when(c.created_at)}</span></div>
  <p class="small muted">${esc(c.address || 'Live location shared')}</p></article>`;

function create(ctx) {
  modal({ title: 'New roadside case', wide: true, intro: 'Ask first: is the rider safe, away from traffic, and uninjured?',
    body: `<div class="grid2">${field('Customer name', 'name', { required: true, half: true })}${field('Mobile number', 'phone', { type: 'tel', inputmode: 'tel', required: true, half: true })}
      ${field('Bike brand', 'brand', { half: true })}${field('Bike model', 'model', { half: true })}${field('Fuel', 'fuel', { type: 'select', blank: false, options: [['petrol', 'Petrol'], ['electric', 'Electric'], ['other', 'Other']], half: true })}${field('Problem', 'problem', { type: 'select', required: true, options: PROBLEMS, half: true })}</div>
      ${field('Address or landmark', 'address', { max: 300, hint: 'Or paste the live location below.' })}
      <div class="grid2">${field('Latitude', 'lat', { inputmode: 'decimal', half: true })}${field('Longitude', 'lng', { inputmode: 'decimal', half: true })}</div>
      ${field('Safety check', 'safety', { type: 'checks', options: [['injured', 'Someone is injured'], ['busy_road', 'On a busy road or highway'], ['unsafe', 'Rider is not in a safe place']] })}
      ${field('What happened', 'details', { type: 'textarea', rows: 3 })}`,
    submit: 'Open case', onSubmit: async (f, d, close) => {
      const s = d.safety || [];
      const r = await rpc('crm_rsa_create', { p: { name: d.name, phone: d.phone, brand: d.brand, model: d.model, fuel: d.fuel, problem: d.problem, address: d.address, lat: d.lat, lng: d.lng, details: d.details, injured: s.includes('injured'), busy_road: s.includes('busy_road'), rider_safe: !s.includes('unsafe') } });
      close(); ctx.reload();
      if (r.safety_first && r.safety_first.length) modal({ title: 'Do this first', cancel: 'Open the case', danger: true, body: `<ul class="steps">${r.safety_first.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, onClose: () => open(r.id, ctx) });
      else { toast(`Case ${r.code} opened.`); open(r.id, ctx); }
    } });
}

async function open(id, ctx) {
  const { case: c, events, playbooks } = await rpc('crm_rsa_get', { p_id: id });
  const closed = !!c.closed_at, canManage = ctx.can('manage_rsa') && !closed, canAssign = ctx.can('assign_leads');
  let mechs = []; if (canAssign && canManage) { try { mechs = await rpc('crm_mechanic_picker'); } catch (e) { mechs = []; } }
  const m = modal({ title: `${c.code}: ${c.customer_name}`, wide: true, cancel: 'Close',
    body: `<p class="muted small">${esc(label(PROBLEMS, c.problem))} · ${esc(c.mobile)} · ${esc(c.address || 'live location')}${c.lat ? ` · <a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener">Open map</a>` : ''}</p>
      ${c.injured ? '<p class="alert">Injury reported. A supervisor-only legal ticket is open. Call 112 if anyone needs an ambulance.</p>' : ''}${c.details ? `<p class="note-box">${esc(c.details)}</p>` : ''}
      ${playbooks.length ? `<p class="small">Phone guidance: ${playbooks.map((p) => `<button type="button" class="chip pick" data-pb="${p.id}">${esc(p.title)}</button>`).join(' ')}</p>` : ''}
      ${canManage ? `<div class="grid2">${field('Status', 'status', { type: 'select', blank: false, value: c.status, options: STATUS, half: true })}${field('ETA given (minutes)', 'eta', { type: 'number', min: 5, max: 480, value: c.eta_minutes || '', half: true })}
        ${mechs.length ? field('Mechanic', 'mechanic', { type: 'select', blank: 'None', value: c.mechanic_id || '', options: mechs.map((x) => [x.id, x.name + (x.area ? ' · ' + x.area : '')]), half: true }) : ''}</div>
        ${field('Outcome (needed to close)', 'outcome', { type: 'textarea', rows: 2, max: 500, value: c.outcome })}${field('Note', 'note', { max: 300 })}<button class="btn primary" type="button" id="save">Save</button>` : `<p class="small">${esc(label(STATUS, c.status))}${c.outcome ? ': ' + esc(c.outcome) : ''}</p>`}
      <h3>Timeline</h3><ul class="timeline">${events.map((e) => `<li><b>${esc(e.kind)}</b> <span class="muted small">${esc(e.actor || 'System')} · ${when(e.created_at)}</span>${e.body ? `<p>${esc(e.body)}</p>` : ''}</li>`).join('')}</ul>` });
  m.form.querySelectorAll('[data-pb]').forEach((b) => b.addEventListener('click', () => ctx.showPlaybook(b.dataset.pb)));
  const save = m.form.querySelector('#save'); if (!save) return;
  save.addEventListener('click', async () => {
    const f = m.form;
    try {
      await rpc('crm_rsa_update', { p_id: id, p_status: f.status.value, p_eta: f.eta.value ? Number(f.eta.value) : null, p_mechanic: f.mechanic && f.mechanic.value ? f.mechanic.value : null, p_garage: null, p_outcome: f.outcome.value || null, p_note: f.note.value || null });
      toast('Saved.'); m.close(); ctx.reload();
    } catch (e) { f.querySelector('.err').textContent = e.message; }
  });
}
