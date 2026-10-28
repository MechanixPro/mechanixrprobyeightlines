import { rpc, esc, head, chips, empty, when, day, tag, modal, field, toast, label, parseCsv, downloadFile, PIPE, confirmBox } from '../ui.js';
import { schedule } from './visits.js';

const CATS = [['2-wheeler', 'Two-wheeler'], ['4-wheeler', 'Four-wheeler'], ['heavy', 'Heavy vehicles'], ['ev', 'Electric'], ['bodywork', 'Bodywork']];
const NEXT = { applied: 'visited', visited: 'kyc_done', kyc_done: 'trained', trained: 'pilot', pilot: 'live' };
const st = { status: '', q: '', hub: '' };
const TEMPLATE = 'name,owner_name,mobile,address,landmark,pincode,lat,lng,categories,open_days,open_time,close_time,bays,trade_id,legal_name,notes\nSample Motors,Ravi Kumar,9876543210,"12 Main Road, HSR Layout",Near BDA complex,560102,12.9116,77.6389,2-wheeler;ev,Mon-Sat,09:00,19:00,4,,,\n';

export async function render(root, ctx) {
  const [list, hubs, load] = await Promise.all([rpc('crm_garage_list', { p_status: st.status || null, p_search: st.q || null, p_hub: st.hub ? Number(st.hub) : null }), rpc('crm_garage_hub_summary'), rpc('crm_garage_load').catch(() => [])]);
  const ld = new Map(load.map((x) => [x.id, x]));
  const manage = ctx.can('manage_garages');
  root.innerHTML = `${head('Garages', 'Partner garages from application to live. Hubs show where Bengaluru is covered and where it is not.',
    `<input id="q" type="search" placeholder="Search name, mobile or code" value="${esc(st.q)}" aria-label="Search garages">${manage ? '<button class="btn primary" type="button" id="new">+ Garage</button><button class="btn" type="button" id="import">Import CSV</button>' : ''}`)}
    ${chips([['', 'All'], ...PIPE.map(([k, t]) => [k, t])], st.status)}
    <details class="hubs"><summary>Coverage by hub (${hubs.filter((h) => h.live).length} of ${hubs.length} hubs have a live garage)</summary><div class="hub-grid">${hubs.map((h) => `<button type="button" class="hub ${h.live ? 'ok' : h.garages ? 'part' : ''}${String(h.id) === st.hub ? ' on' : ''}" data-hub="${h.id}"><b>${h.id}. ${esc(h.name)}</b><small>${esc(h.direction)} · ${esc(h.ring)}</small><span>${h.live} live · ${h.garages} total</span></button>`).join('')}</div></details>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Garage</th><th>Owner</th><th>Hub</th><th>Stage</th><th class="n">Score</th><th>Tier</th><th>Operating</th><th>Jobs today</th><th>Next visit</th><th class="n">Mechanics</th></tr></thead><tbody>
      ${list.map((g) => `<tr class="row-open" data-id="${g.id}"><td><b>${esc(g.name)}</b><br><small class="muted">${esc(g.code)} · ${esc(g.mobile)} · ${esc(g.pincode || '')}</small></td><td>${esc(g.owner_name || '—')}</td><td>${esc(g.hub || '—')}</td><td>${tag(label(PIPE, g.status), g.status === 'live' ? 'st-completed' : g.status === 'paused' ? 'late' : 'st-new')}${g.status === 'live' && !g.open_now ? ' ' + tag('On leave', 'late') : ''}</td><td class="n">${g.score ?? '—'}</td><td>${esc(g.tier || '—')}</td><td>${opsTag(ld.get(g.id))}</td><td>${jobsToday(ld.get(g.id))}</td><td>${when(g.next_visit)}</td><td class="n">${g.mechanics}</td></tr>`).join('')}</tbody></table></div>` : empty('No garages in this view.')}`;
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.f; ctx.reload(); }));
  root.querySelectorAll('[data-hub]').forEach((b) => b.addEventListener('click', () => { st.hub = st.hub === b.dataset.hub ? '' : b.dataset.hub; ctx.reload(); }));
  root.querySelector('#q').addEventListener('change', (e) => { st.q = e.target.value.trim(); ctx.reload(); });
  root.querySelectorAll('tr.row-open').forEach((tr) => tr.addEventListener('click', () => detail(tr.dataset.id, ctx, hubs)));
  const nb = root.querySelector('#new'); if (nb) nb.addEventListener('click', () => edit(null, ctx, hubs));
  const im = root.querySelector('#import'); if (im) im.addEventListener('click', () => importCsv(ctx));
}

const OPS = [['active', 'Active'], ['inactive', 'Inactive'], ['suspended', 'Suspended'], ['maintenance', 'Maintenance']];
const opsTag = (l) => (!l ? '—' : l.ops_state === 'active' ? (l.dispatchable ? tag('Taking jobs', 'st-completed') : l.full ? tag('Full today', 'late') : tag('Not live', 'soft')) : tag(label(OPS, l.ops_state), 'late'));
const jobsToday = (l) => (!l ? '—' : l.capacity ? `${l.today} of ${l.capacity}` : `${l.today}`);

function form(g, hubs) {
  return `<div class="grid2">${field('Garage name', 'name', { required: true, value: g?.name, half: true })}${field('Owner name', 'owner_name', { value: g?.owner_name, half: true })}
    ${field('Owner mobile', 'mobile', { type: 'tel', inputmode: 'tel', required: true, value: g?.mobile, half: true })}${field('Trade licence id', 'trade_id', { value: g?.trade_id, half: true })}</div>
    ${field('Address', 'address', { type: 'textarea', rows: 2, required: true, max: 300, value: g?.address })}
    <div class="grid2">${field('Landmark', 'landmark', { value: g?.landmark, half: true })}${field('PIN code', 'pincode', { inputmode: 'numeric', required: true, value: g?.pincode, half: true })}
    ${field('Latitude', 'lat', { inputmode: 'decimal', required: true, value: g?.lat, half: true })}${field('Longitude', 'lng', { inputmode: 'decimal', required: true, value: g?.lng, half: true })}
    ${field('Working days', 'open_days', { required: true, value: g?.open_days || 'Mon-Sat', half: true })}${field('Repair bays', 'bays', { type: 'number', min: 1, max: 60, required: true, value: g?.bays, half: true })}
    ${field('Opens (HH:MM)', 'open_time', { required: true, value: g?.open_time || '09:00', half: true })}${field('Closes (HH:MM)', 'close_time', { required: true, value: g?.close_time || '19:00', half: true })}
    ${field('Hub', 'hub_id', { type: 'select', blank: 'Suggest from location', value: g?.hub_id || '', options: hubs.map((h) => [h.id, `${h.id}. ${h.name}`]), half: true })}</div>
    ${field('Service categories', 'categories', { type: 'checks', value: g?.categories || [], options: CATS })}${field('Notes', 'notes', { type: 'textarea', rows: 2, value: g?.notes })}`;
}

function edit(g, ctx, hubs) {
  modal({ title: g ? 'Edit garage' : 'New garage', wide: true, body: form(g, hubs), submit: 'Save', onSubmit: async (f, d, close) => {
    const r = await rpc('crm_garage_save', { p: { ...d, id: g?.id || null, categories: d.categories || [], hub_id: d.hub_id || null }, p_commit: true });
    if (!r.ok) throw new Error(r.errors.join('. '));
    close(); toast('Garage saved.'); ctx.reload(); } });
}

function importCsv(ctx) {
  let rows = [];
  const m = modal({ title: 'Import garages from CSV', wide: true, cancel: 'Close', intro: 'Columns: name, owner_name, mobile, address, pincode, lat, lng, categories (separate with ;), open_days, open_time, close_time, bays. Every row is checked first. Nothing is saved until you confirm.',
    body: `<div class="row"><button class="btn" type="button" id="tpl">Download template</button><input type="file" id="file" accept=".csv,text/csv" aria-label="CSV file"></div><div id="report"></div><button class="btn primary" type="button" id="go" hidden>Import the valid rows</button>` });
  const f = m.form, rep = f.querySelector('#report'), go = f.querySelector('#go');
  f.querySelector('#tpl').addEventListener('click', () => downloadFile('garages-template.csv', TEMPLATE));
  f.querySelector('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    rows = parseCsv(await file.text()).map((r) => ({ ...r, categories: (r.categories || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean) }));
    if (!rows.length) { rep.innerHTML = '<p class="err">No rows found. Check the header row.</p>'; go.hidden = true; return; }
    if (rows.length > 500) { rep.innerHTML = '<p class="err">Import at most 500 garages at a time.</p>'; go.hidden = true; return; }
    try {
      const r = await rpc('crm_garage_import', { p_rows: rows, p_dry: true });
      rep.innerHTML = `<p><b>${r.ok}</b> ready, <b class="${r.failed ? 'badtxt' : ''}">${r.failed}</b> with problems.</p><div class="table-wrap"><table><thead><tr><th>Row</th><th>Garage</th><th>Result</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${x.row}</td><td>${esc(x.name || '—')}</td><td>${x.ok ? 'Ready' : `<span class="badtxt">${esc(x.errors.join('. '))}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
      go.hidden = !r.ok; go.textContent = `Import ${r.ok} valid ${r.ok === 1 ? 'row' : 'rows'}`;
    } catch (x) { rep.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { const r = await rpc('crm_garage_import', { p_rows: rows, p_dry: false }); toast(`${r.ok} garages imported.`); m.close(); ctx.reload(); } catch (x) { f.querySelector('.err').textContent = x.message; go.disabled = false; }
  });
}

async function detail(id, ctx, hubs) {
  const d = await rpc('crm_garage_get', { p_id: id }); const g = d.garage, manage = ctx.can('manage_garages'); const gl = (await rpc('crm_garage_load').catch(() => [])).find((x) => x.id === id);
  const next = NEXT[g.status];
  const m = modal({ title: `${g.name} (${g.code})`, wide: true, cancel: 'Close',
    body: `<p class="muted small">${tag(label(PIPE, g.status), g.status === 'live' ? 'st-completed' : 'st-new')} ${g.tier ? tag(g.tier, 'soft') : ''} Score ${g.score ?? '—'} · Hub: ${esc(d.hub || '—')}</p>
      <div class="facts"><div><span>Owner</span><b>${esc(g.owner_name || '—')}</b></div><div><span>Mobile</span><b>${esc(g.mobile)}</b></div><div><span>Address</span><b>${esc(g.address || '—')} ${esc(g.pincode || '')}</b></div><div><span>Hours</span><b>${esc(g.open_days)} ${esc(g.open_time)}–${esc(g.close_time)}</b></div>
        <div><span>Bays</span><b>${g.bays ?? '—'}</b></div><div><span>Categories</span><b>${esc((g.categories || []).join(', ') || '—')}</b></div></div>
      ${g.lat ? `<p class="small"><a href="https://www.google.com/maps?q=${g.lat},${g.lng}" target="_blank" rel="noopener">Open on the map</a></p>` : ''}
      ${g.status === 'paused' ? `<p class="alert">Paused: ${esc(g.paused_reason || '')}</p>` : ''}
      ${manage ? `<div class="row wrap">${next ? `<button class="btn primary" type="button" data-to="${next}">Mark ${esc(label(PIPE, next))}</button>` : ''}${g.status === 'paused' ? `<button class="btn primary" type="button" data-to="${g.paused_from}">Resume</button>` : '<button class="btn ghost" type="button" data-to="paused">Pause</button>'}<button class="btn" type="button" id="edit">Edit details</button>${ctx.can('schedule_visits') ? '<button class="btn" type="button" id="visit">Schedule a visit</button>' : ''}<button class="btn" type="button" id="leave">Leave and availability</button><button class="btn" type="button" id="ops">Operating state and daily jobs</button></div>` : ''}${gl ? `<p class="small muted">Operating: ${opsTag(gl)} · Jobs today ${jobsToday(gl)}${gl.ops_note ? ' · ' + esc(gl.ops_note) : ''}</p>` : ''}
      <h3>Payout details</h3>${d.bank ? `<div class="facts"><div><span>Holder</span><b>${esc(d.bank.holder_name)}</b></div><div><span>Account ends</span><b>${esc(d.bank.account_last4)}</b></div><div><span>IFSC</span><b>${esc(d.bank.ifsc)}</b></div><div><span>UPI</span><b>${esc(d.bank.upi_id || '—')}</b></div></div>` : '<p class="muted small">Not added yet.</p>'}
      ${ctx.can('view_garage_bank') && manage ? '<button class="btn" type="button" id="bank">Add or change payout details</button>' : ''}
      <h3>Visits</h3>${d.visits.length ? `<ul class="timeline">${d.visits.map((v) => `<li><b>${esc(v.kind)}</b> · ${when(v.scheduled_at)} · ${esc(v.status)}${v.score != null ? ' · score ' + v.score : ''}<span class="muted small"> ${esc(v.inspector || '')}</span></li>`).join('')}</ul>` : '<p class="muted small">No visits yet.</p>'}
      <h3>Mechanics</h3>${d.mechanics.length ? `<ul class="timeline">${d.mechanics.map((x) => `<li>${esc(x.name)} · ${esc(x.phone)} · ${esc(x.status)}</li>`).join('')}</ul>` : '<p class="muted small">None linked.</p>'}` });
  const f = m.form;
  f.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.to;
    const run = async (note) => { await rpc('crm_garage_set_status', { p_id: id, p_status: to, p_note: note || null }); toast('Updated.'); m.close(); ctx.reload(); };
    if (to === 'paused') return modal({ title: 'Pause this garage', body: field('Why?', 'note', { required: true, max: 200 }), submit: 'Pause', onSubmit: async (x, dd, close) => { await run(dd.note); close(); } });
    try { await run(); } catch (e) { f.querySelector('.err').textContent = e.message; }
  }));
  const on = (sel, fn) => { const el = f.querySelector(sel); if (el) el.addEventListener('click', fn); };
  on('#edit', () => { m.close(); edit(g, ctx, hubs); });
  on('#visit', () => { m.close(); schedule(ctx, id); });
  on('#leave', () => modal({ title: 'Availability', body: `${field('On leave until', 'leave', { type: 'date', value: g.on_leave_until || '' })}${field('Not taking jobs until', 'pause', { type: 'date', value: g.paused_until || '' })}${field('Reason', 'reason', { max: 200, value: g.paused_reason })}`,
    onSubmit: async (x, dd, close) => { await rpc('crm_garage_set_availability', { p_id: id, p_on_leave_until: dd.leave || null, p_paused_until: dd.pause || null, p_reason: dd.reason || null }); close(); toast('Saved.'); m.close(); ctx.reload(); } }));
  on('#ops', () => modal({ title: 'Operating state', intro: 'Controls whether this garage is sent jobs. Suspended and Maintenance need a short reason.', body: `${field('State', 'state', { type: 'select', blank: false, value: (gl && gl.ops_state) || 'active', options: OPS })}${field('Daily jobs it can take', 'cap', { type: 'number', min: 1, max: 200, value: (gl && gl.capacity) || '', hint: 'Leave empty for no limit.' })}${field('Note', 'note', { max: 200, value: (gl && gl.ops_note) || '' })}`,
    onSubmit: async (x, dd, close) => { await rpc('crm_garage_ops_set', { p_id: id, p_state: dd.state, p_capacity: dd.cap ? Number(dd.cap) : null, p_note: dd.note || null }); close(); m.close(); toast('Saved.'); ctx.reload(); } }));
  on('#bank', () => modal({ title: 'Payout details', intro: 'Only the last four digits of the account number. Never the full number.', body: `${field('Account holder', 'holder', { required: true })}${field('Last 4 digits of the account number', 'last4', { inputmode: 'numeric', max: 4, required: true })}${field('IFSC', 'ifsc', { required: true })}${field('UPI id (optional)', 'upi')}`,
    onSubmit: async (x, dd, close) => { await rpc('crm_garage_bank_set', { p_id: id, p_holder: dd.holder, p_last4: dd.last4, p_ifsc: dd.ifsc.toUpperCase(), p_upi: dd.upi || null }); close(); toast('Saved. Payout details need to be verified again.'); m.close(); detail(id, ctx, hubs); } }));
}
