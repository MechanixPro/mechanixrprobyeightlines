import { rpc, esc, head, chips, empty, day, tag, modal, field, toast, label, PROBLEMS } from '../ui.js';

const st = { tab: 'playbooks', q: '', problem: '' };
const TABS = [['playbooks', 'RSA playbooks'], ['fitments', 'Fitment guide'], ['sops', 'SOPs']];
let ctxRef = null;

export async function render(root, ctx) {
  ctxRef = ctx;
  root.innerHTML = `${head('Knowledge', 'Playbooks to guide a customer over the phone, parts and fitment notes, and the standard operating procedures.', `<input id="q" type="search" placeholder="Search" value="${esc(st.q)}" aria-label="Search knowledge">`)}${chips(TABS, st.tab, 'data-tab')}<div id="kbody"></div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; ctx.reload(); }));
  root.querySelector('#q').addEventListener('change', (e) => { st.q = e.target.value.trim(); ctx.reload(); });
  const body = root.querySelector('#kbody');
  if (st.tab === 'playbooks') await playbooks(body, ctx); else if (st.tab === 'fitments') await fitments(body, ctx); else await sops(body, ctx);
}

async function playbooks(body, ctx) {
  const list = await rpc('crm_playbooks_list', { p_search: st.q || null, p_problem: st.problem || null });
  const edit = ctx.can('edit_knowledge');
  body.innerHTML = `<div class="row wrap"><select id="prob" aria-label="Problem">${'<option value="">Every problem</option>'}${PROBLEMS.map(([k, t]) => `<option value="${k}"${k === st.problem ? ' selected' : ''}>${t}</option>`).join('')}</select>${edit ? '<button class="btn primary" type="button" id="new">+ Playbook</button>' : ''}</div>
    ${list.length ? `<div class="cards">${list.map((b) => `<article class="lead-card tone-${b.status === 'published' ? 'good' : 'next'}" data-open="${b.id}" tabindex="0" role="button"><div class="lc-top"><div><h2>${esc(b.title)}</h2><p class="muted small">${esc(b.symptom || '')}</p></div></div>
      <div class="lc-meta">${b.safety_critical ? tag('Safety critical', 'late') : ''}${b.status !== 'published' ? tag('Draft, not visible to agents', 'late') : tag('v' + b.version + (b.reviewed_by ? ' · reviewed by ' + b.reviewed_by : ''), 'soft')}${b.open_flags ? tag(b.open_flags + ' flagged', 'late') : ''}</div></article>`).join('')}</div>` : empty('No playbooks match.')}`;
  body.querySelector('#prob').addEventListener('change', (e) => { st.problem = e.target.value; ctx.reload(); });
  body.querySelectorAll('[data-open]').forEach((c) => c.addEventListener('click', () => showPlaybook(c.dataset.open)));
  const nb = body.querySelector('#new'); if (nb) nb.addEventListener('click', () => editPlaybook(null, ctx));
}

export async function showPlaybook(id) {
  const ctx = ctxRef; const b = await rpc('crm_playbook_get', { p_id: id });
  const edit = ctx.can('edit_knowledge'), review = ctx.can('review_knowledge');
  const ol = (a) => (a && a.length ? `<ol>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="muted small">—</p>');
  const m = modal({ title: b.title, wide: true, cancel: 'Close',
    body: `${b.status !== 'published' ? '<p class="alert">Draft. Agents cannot see this until it is reviewed and published.</p>' : ''}${b.safety_note ? `<p class="alert warn"><b>Safety:</b> ${esc(b.safety_note)}</p>` : ''}
      <p class="muted">${esc(b.symptom || '')}</p><h3>Ask first</h3>${ol(b.ask_first)}<h3>Guide the customer</h3>${ol(b.steps)}
      ${b.stop_and_dispatch ? `<h3>Stop and dispatch when</h3><p>${esc(b.stop_and_dispatch)}</p>` : ''}${b.parts_notes ? `<h3>Parts</h3><p>${esc(b.parts_notes)}</p>` : ''}${b.cost_note ? `<h3>Cost</h3><p>${esc(b.cost_note)}</p>` : ''}
      <p class="small muted">Version ${b.version}${b.reviewed_by ? ` · reviewed by ${esc(b.reviewed_by)}` : ''}${b.review_date ? ` · review again by ${day(b.review_date)}` : ''}</p>
      <div class="row wrap">${b.status === 'published' ? '<button class="btn ghost" type="button" id="flag">This did not work</button>' : ''}${edit ? '<button class="btn" type="button" id="edit">Edit</button>' : ''}${review && b.status !== 'published' ? '<button class="btn primary" type="button" id="publish">Review and publish</button>' : ''}</div>` });
  const on = (s, fn) => { const el = m.form.querySelector(s); if (el) el.addEventListener('click', fn); };
  on('#flag', () => modal({ title: 'Flag this playbook', body: field('What went wrong?', 'note', { type: 'textarea', rows: 3, max: 400, required: true }), submit: 'Send', onSubmit: async (f, d, close) => { await rpc('crm_playbook_flag', { p_id: id, p_note: d.note }); close(); toast('Thanks. A supervisor will review it.'); } }));
  on('#edit', () => { m.close(); editPlaybook(b, ctx); });
  on('#publish', () => modal({ title: 'Review and publish', intro: b.safety_critical ? 'This is safety critical. Enter the technical head who reviewed it.' : 'Confirm you have read it and it is correct.', body: `${field('Reviewed by', 'by', { required: b.safety_critical, hint: 'Name of the technical head' })}${field('Review again in (months)', 'months', { type: 'number', min: 1, max: 24, value: 6 })}`, submit: 'Publish',
    onSubmit: async (f, d, close) => { await rpc('crm_playbook_publish', { p_id: id, p_reviewed_by: d.by || null, p_review_months: Number(d.months) || 6 }); close(); m.close(); toast('Published. Agents can see it now.'); ctx.reload(); } }));
}

function editPlaybook(b, ctx) {
  const lines = (a) => (a || []).join('\n');
  modal({ title: b ? 'Edit playbook' : 'New playbook', wide: true, intro: b && b.status === 'published' ? 'Saving sends it back to draft. It must be reviewed and published again.' : '',
    body: `${field('Title', 'title', { required: true, value: b?.title })}${field('Problem types', 'problems', { type: 'checks', value: b?.problems || [], options: PROBLEMS })}${field('Symptom', 'symptom', { type: 'textarea', rows: 2, value: b?.symptom })}
      ${field('Safety note', 'safety_note', { type: 'textarea', rows: 2, value: b?.safety_note })}${field('Ask first (one per line)', 'ask_first', { type: 'textarea', rows: 3, value: lines(b?.ask_first) })}${field('Steps in plain words (one per line)', 'steps', { type: 'textarea', rows: 6, value: lines(b?.steps) })}
      ${field('Stop and dispatch when', 'stop', { type: 'textarea', rows: 2, value: b?.stop_and_dispatch })}${field('Parts and fitment notes', 'parts', { type: 'textarea', rows: 2, value: b?.parts_notes })}${field('Cost note', 'cost', { value: b?.cost_note })}
      <label class="check"><input type="checkbox" name="crit" ${b?.safety_critical ? 'checked' : ''}><span>Safety critical (needs a technical head to review before it shows to agents)</span></label>`,
    submit: 'Save as draft', onSubmit: async (f, d, close) => {
      const split = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      await rpc('crm_playbook_save', { p: { id: b?.id || null, title: d.title, problems: d.problems || [], symptom: d.symptom, safety_note: d.safety_note, ask_first: split(d.ask_first), steps: split(d.steps), stop_and_dispatch: d.stop, parts_notes: d.parts, cost_note: d.cost, safety_critical: f.crit.checked } });
      close(); toast('Saved as draft.'); ctx.reload(); } });
}

async function fitments(body, ctx) {
  const list = await rpc('crm_fitments_list', { p_search: st.q || null }); const edit = ctx.can('edit_knowledge');
  body.innerHTML = `${edit ? '<div class="row"><button class="btn primary" type="button" id="new">+ Fitment</button></div>' : ''}${list.length ? `<div class="table-wrap"><table><thead><tr><th>Brand</th><th>Model</th><th>Part</th><th>Specification</th><th>Alternatives</th><th>OEM notes</th><th>Source</th><th>Checked</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
    ${list.map((f) => `<tr><td>${esc(f.brand)}</td><td>${esc(f.model)}</td><td>${esc(f.part)}</td><td>${esc(f.spec || '—')}</td><td>${esc(f.alternatives || '—')}</td><td>${esc(f.oem_notes || '—')}</td><td>${esc(f.source || '—')}</td><td>${day(f.last_checked)}</td>${edit ? `<td><button class="btn sm" type="button" data-edit="${f.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('No fitment notes yet. Add the first one from a verified source.')}`;
  const nb = body.querySelector('#new'); if (nb) nb.addEventListener('click', () => editFit(null, ctx));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editFit(list.find((f) => f.id === b.dataset.edit), ctx)));
}
function editFit(f, ctx) {
  modal({ title: f ? 'Edit fitment' : 'New fitment', intro: 'Add only what you have verified. Write the source.', body: `<div class="grid2">${field('Brand', 'brand', { required: true, value: f?.brand, half: true })}${field('Model', 'model', { required: true, value: f?.model, half: true })}${field('Part', 'part', { required: true, value: f?.part, half: true })}${field('Specification', 'spec', { value: f?.spec, half: true })}</div>
    ${field('Compatible alternatives', 'alternatives', { value: f?.alternatives })}${field('OEM notes', 'oem', { value: f?.oem_notes })}<div class="grid2">${field('Source', 'source', { value: f?.source, half: true })}${field('Last checked', 'checked', { type: 'date', value: f?.last_checked || '', half: true })}</div>`,
    onSubmit: async (x, d, close) => { await rpc('crm_fitment_save', { p: { id: f?.id || null, brand: d.brand, model: d.model, part: d.part, spec: d.spec, alternatives: d.alternatives, oem_notes: d.oem, source: d.source, last_checked: d.checked || null } }); close(); toast('Saved.'); ctx.reload(); } });
}

async function sops(body, ctx) {
  const list = (await rpc('crm_sops_list')).filter((s) => !st.q || (s.title + s.body).toLowerCase().includes(st.q.toLowerCase())); const edit = ctx.can('edit_knowledge');
  body.innerHTML = `${edit ? '<div class="row"><button class="btn primary" type="button" id="new">+ SOP</button></div>' : ''}${list.length ? list.map((s) => `<details class="sop"><summary><b>${esc(s.title)}</b> <small class="muted">${esc(s.category || '')} · v${s.version}${s.status === 'draft' ? ' · draft' : ''}</small></summary><div class="sop-body">${esc(s.body).replace(/\n/g, '<br>')}${edit ? `<p><button class="btn sm" type="button" data-edit="${s.id}">Edit</button></p>` : ''}</div></details>`).join('') : empty('No SOPs yet.')}`;
  const nb = body.querySelector('#new'); if (nb) nb.addEventListener('click', () => editSop(null, ctx));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editSop(list.find((s) => s.id === b.dataset.edit), ctx)));
}
function editSop(s, ctx) {
  const pub = ctx.can('review_knowledge');
  modal({ title: s ? 'Edit SOP' : 'New SOP', wide: true, body: `${field('Title', 'title', { required: true, value: s?.title })}${field('Category', 'category', { value: s?.category })}${field('Text', 'body', { type: 'textarea', rows: 10, max: 6000, required: true, value: s?.body })}
    ${pub ? '<label class="check"><input type="checkbox" name="pub"><span>Publish now (agents can read it)</span></label>' : '<p class="small muted">Saved as a draft. A reviewer publishes it.</p>'}`,
    onSubmit: async (f, d, close) => { await rpc('crm_sop_save', { p_id: s?.id || null, p_title: d.title, p_category: d.category || null, p_body: d.body, p_publish: !!(f.pub && f.pub.checked) }); close(); toast('Saved.'); ctx.reload(); } });
}
