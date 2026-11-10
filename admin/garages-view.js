// Admin > Garages: add a garage by hand, edit it, delete it (soft delete, can be brought back). Owner and admin only.
// The save uses the same checks as Crew (crm_garage_errors): name, owner mobile, address, a PIN code in the service area,
// GPS near Bengaluru, at least one category, working days and hours, repair bays. Delete is admin_garage_delete (refused while the garage has an open job).
import { parseLatLng, COORD_HELP } from './geo-parse.js';
import { esc } from './kyc-rules.js';
import { skeleton, errorState, emptyState } from './ds.js';
import { agreementHtml, TIERS } from './agreement.js';
import { createAgreementTerms } from './agreement-terms.js';

export const CATS = [['2-wheeler', 'Two-wheeler'], ['4-wheeler', 'Four-wheeler'], ['heavy', 'Heavy vehicles'], ['ev', 'Electric'], ['bodywork', 'Bodywork']];
const STAGE = { applied: 'Applied', visited: 'Visited', kyc_done: 'KYC done', trained: 'Trained', pilot: 'Pilot', live: 'Live', paused: 'Paused' };

/** The form values to the object the save function wants, or { error }. Pure so it can be tested. */
export function garageFromForm(v, id) {
  const geo = parseLatLng(v.lat, v.lng);
  if (!geo) return { error: COORD_HELP };
  const cats = (v.categories || []).filter((c) => CATS.some((x) => x[0] === c));
  return { value: { id: id || undefined, name: String(v.name || '').trim(), owner_name: String(v.owner_name || '').trim(), mobile: String(v.mobile || '').trim(), address: String(v.address || '').trim(),
    landmark: String(v.landmark || '').trim(), pincode: String(v.pincode || '').trim(), lat: geo.lat, lng: geo.lng, categories: cats, open_days: String(v.open_days || '').trim(),
    open_time: String(v.open_time || '').trim(), close_time: String(v.close_time || '').trim(), bays: Number(v.bays) || null, notes: String(v.notes || '').trim() } };
}

export function listHtml(rows, gone) {
  const list = (rows || []);
  const body = list.length ? `<ul class="kv-list">${list.map((g) => `<li class="kv-row"><div class="kv-open"><span class="kv-name">${esc(g.name)}</span>
      <span class="kv-sub">${esc(g.code || '')} · ${esc(g.owner_name || 'No owner name')} · ${esc(g.mobile || '')} · ${esc(g.pincode || '')} · ${esc(STAGE[g.status] || g.status || '')}</span></div>
      <div class="kv-big-row"><button type="button" class="btn btn-ghost" data-edit="${esc(g.id)}">Edit</button><button type="button" class="btn btn-ghost" data-agree="${esc(g.id)}">Agreement</button><button type="button" class="btn btn-ghost" data-hist="${esc(g.id)}">History</button><button type="button" class="btn danger" data-del="${esc(g.id)}" data-name="${esc(g.name)}">Delete</button></div></li>`).join('')}</ul>`
    : emptyState({ title: 'No garages yet.', text: 'Tap Add garage to enter one by hand.' });
  const back = (gone || []).length ? `<details class="gv-gone"><summary>Deleted garages (${gone.length})</summary><ul class="kv-list">${gone.map((g) => `<li class="kv-row"><div class="kv-open"><span class="kv-name">${esc(g.name)}</span><span class="kv-sub">${esc(g.code || '')} · ${esc(g.mobile || '')}</span></div><button type="button" class="btn btn-ghost" data-restore="${esc(g.id)}">Bring back</button></li>`).join('')}</ul></details>` : '';
  return `<div class="kv-tabs"><button type="button" class="btn primary" data-add>Add garage</button><button type="button" class="btn btn-ghost" data-terms>Agreement terms</button></div>${body}${back}`;
}

const formBody = (g = {}) => {
  const cats = new Set(g.categories || ['2-wheeler']);
  const f = (id, label, val, extra = '') => `<label class="flow-f"><span>${label}</span><input name="${id}" value="${esc(val ?? '')}" ${extra}></label>`;
  return `${f('name', 'Garage name', g.name, 'required maxlength="80"')}${f('owner_name', 'Owner name', g.owner_name, 'maxlength="80"')}${f('mobile', 'Owner mobile (10 digits)', g.mobile, 'required inputmode="numeric" maxlength="14"')}
    ${f('address', 'Full address', g.address, 'required maxlength="300"')}${f('landmark', 'Landmark', g.landmark, 'maxlength="120"')}${f('pincode', 'PIN code', g.pincode, 'required inputmode="numeric" maxlength="6"')}
    ${f('lat', 'Location (paste latitude, or the Google Maps link)', g.lat ?? '', 'required')}${f('lng', 'Longitude (leave empty if you pasted a link)', g.lng ?? '')}<p class="flow-muted">${esc(COORD_HELP)}</p>
    <fieldset class="flow-f"><legend>What they repair</legend>${CATS.map(([k, t]) => `<label class="flow-check"><input type="checkbox" name="categories" value="${k}"${cats.has(k) ? ' checked' : ''}> ${t}</label>`).join(' ')}</fieldset>
    ${f('open_days', 'Working days', g.open_days || 'Mon-Sat', 'required maxlength="60"')}${f('open_time', 'Opens (HH:MM)', g.open_time || '09:00', 'required maxlength="5"')}${f('close_time', 'Closes (HH:MM)', g.close_time || '19:00', 'required maxlength="5"')}
    ${f('bays', 'Repair bays (1 to 60)', g.bays ?? 2, 'required inputmode="numeric" maxlength="2"')}${f('notes', 'Notes (no Aadhaar, PAN or bank numbers)', g.notes, 'maxlength="1000"')}`;
};
const readForm = (f) => ({ ...Object.fromEntries(['name', 'owner_name', 'mobile', 'address', 'landmark', 'pincode', 'lat', 'lng', 'open_days', 'open_time', 'close_time', 'bays', 'notes'].map((k) => [k, f.querySelector(`[name=${k}]`).value])),
  categories: [...f.querySelectorAll('[name=categories]:checked')].map((x) => x.value) });

export function createGaragesView({ rpc, dialog, toast }) {
  let root = null;
  const terms = createAgreementTerms({ rpc, dialog, toast });
  const msg = (e) => String((e && e.message) || e || 'Something went wrong. Try again.');
  async function load() {
    root.innerHTML = skeleton(3, 'Loading garages');
    try { const [rows, gone] = await Promise.all([rpc('admin_garage_list'), rpc('admin_garage_deleted_list').catch(() => [])]); root.innerHTML = listHtml(rows || [], gone || []); }
    catch (e) { root.innerHTML = errorState({ title: 'Garages could not load.', detail: msg(e) }); root.querySelector('[data-retry]')?.addEventListener('click', load); }
  }
  async function save(f, id, close) {
    const r = garageFromForm(readForm(f), id); if (r.error) throw new Error(r.error);
    const res = await rpc('admin_garage_save', { p: r.value, p_commit: true });
    if (!res || res.ok === false) throw new Error(((res && res.errors) || ['Could not save.']).join('. '));
    close(); toast(id ? 'Garage saved.' : 'Garage added. Send the onboarding link from Partner KYC.'); load();
  }
  function form(g) { dialog({ title: g && g.id ? 'Edit garage' : 'Add garage', intro: 'Enter what you know. A garage added here can be sent the onboarding link from Partner KYC.', body: formBody(g || {}), submit: 'Save', onSubmit: async (f, d) => { await save(f, g && g.id, d.close); } }); }
  async function edit(id) { try { const r = await rpc('admin_garage_get', { p_id: id }); form(r.garage); } catch (e) { toast(msg(e), true); } }
  // The printable agreement, filled from the garage record. Asks only for what is not stored: the plan to print, the Bronze rate, and who signs for the Company.
  async function agreement(id) {
    let garage, plans, tdoc, signed;
    try { const [r, p, t, sg] = await Promise.all([rpc('admin_garage_get', { p_id: id }), rpc('partner_plans_list'), rpc('agreement_terms_get'), rpc('admin_agreement_signed', { p_garage: id })]); garage = r.garage; plans = p || []; tdoc = t || {}; signed = sg || null; } catch (e) { return toast(msg(e), true); }
    if (signed) {   // already signed online: print exactly what was signed (the stored terms and numbers), never today's edits
      return dialog({ title: 'Signed agreement: ' + (garage.name || ''), intro: `Signed online by <b>${esc(signed.name)}</b> on ${esc(new Date(signed.at).toLocaleDateString('en-GB'))}. Plan ${esc(signed.tier)}, commission ${esc(signed.rate)}%, terms version ${esc(signed.terms_version)}. The signed copy prints with the wording and numbers that were shown when it was signed.`, submit: 'Open signed copy',
        onSubmit: async (f, d) => { const w = window.open('', '_blank'); if (!w) throw new Error('Allow pop-ups for this site, then try again.');
          w.document.open(); w.document.write(agreementHtml({ tier: signed.tier, garage: { ...signed.garage, gstin: signed.garage.gstin || garage.gstin }, plan: signed.plan, rate: signed.rate, terms: signed.terms, signer: { name: 'Mohammed Ruwaid', designation: 'Founder' }, now: new Date(signed.at), esign: { name: signed.name, at: signed.at } })); w.document.close(); d.close(); } });
    }
    const opts = Object.entries(TIERS).map(([k, t]) => `<option value="${k}"${k === (garage.plan || 'bronze') ? ' selected' : ''}>${t.name}</option>`).join('');
    dialog({ title: 'Agreement for ' + (garage.name || 'this garage'), intro: 'Opens a printable agreement filled with this garage’s details. The garage can also sign it online from its onboarding link, once its plan is set and, for Bronze, the rate is saved here.',
      body: `<label class="flow-f"><span>Plan</span><select name="tier">${opts}</select></label><label class="flow-f"><span>Agreed commission % (Bronze; blank uses the plan rate)</span><input name="rate" inputmode="decimal" maxlength="5" placeholder="e.g. 35" value="${esc(garage.agreed_rate ?? '')}"></label>
        <label class="flow-f"><span>Signing for the Company: name</span><input name="sname" value="Mohammed Ruwaid" maxlength="80"></label><label class="flow-f"><span>Designation</span><input name="sdes" value="Founder" maxlength="60"></label>`,
      submit: 'Open agreement',
      onSubmit: async (f, d) => {
        const tier = f.querySelector('[name=tier]').value, plan = plans.find((x) => x.plan === tier) || {};
        const rate = tier === 'bronze' ? Number(f.querySelector('[name=rate]').value || plan.commission_pct) : plan.commission_pct;
        if (!(rate > 0 && rate <= 100)) throw new Error('Enter the agreed commission, between 1 and 100.');
        if (tier === 'bronze' && rate !== Number(garage.agreed_rate)) await rpc('garage_agreed_rate_set', { p_id: id, p_rate: rate });   // saved, so the garage's own sign screen shows it
        const w = window.open('', '_blank'); if (!w) throw new Error('Allow pop-ups for this site, then try again.');
        w.document.open(); w.document.write(agreementHtml({ tier, garage, plan, rate, terms: tdoc.doc, signer: { name: f.querySelector('[name=sname]').value, designation: f.querySelector('[name=sdes]').value }, now: new Date() })); w.document.close();
        rpc('agreement_issued', { p_garage: id, p_tier: tier, p_rate: rate, p_version: tdoc.version || 0 }).catch(() => {});
        d.close();
      } });
  }
  function del(id, name) {
    dialog({ title: 'Delete ' + name + '?', intro: 'The garage disappears from every list and its app access is switched off. Its past jobs and records are kept, and you can bring it back. A garage with an open job cannot be deleted.', submit: 'Delete garage',
      onSubmit: async (f, d) => { await rpc('admin_garage_delete', { p_id: id }); d.close(); toast('Garage deleted.'); load(); } });
  }
  const jobRows = (rows) => (rows && rows.length ? `<ul class="flow-list">${rows.map((j) => `<li>${esc(j.ref || 'Booking')} · ${esc(j.date || '')} · ${esc(String(j.status || '').replace(/_/g, ' '))}${j.area ? ' · ' + esc(j.area) : ''}</li>`).join('')}</ul>` : '<p class="flow-muted">None.</p>');
  async function history(id) {
    try {
      const h = await rpc('admin_garage_history', { p_garage: id });
      const m = h.mechanic, since = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '');
      dialog({ title: 'History: ' + esc(h.garage.name), intro: m ? `Converted from mechanic <b>${esc(m.name)}</b> (with Mechanix Pro since ${esc(since(m.since))}${m.converted_at ? ', converted ' + esc(since(m.converted_at)) : ''}). Amounts stay in Mechanic ledgers.` : 'Garage jobs. This garage was not converted from a mechanic.',
        body: `<h4>Garage jobs (${(h.garage_jobs || []).length})</h4>${jobRows(h.garage_jobs)}${m ? `<h4>Earlier jobs as a mechanic (${(h.mechanic_jobs || []).length})</h4>${jobRows(h.mechanic_jobs)}` : ''}` });
    } catch (e) { toast(msg(e), true); }
  }
  function wire() {
    root.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button'); if (!t || t.disabled) return;
      if (t.hasAttribute('data-add')) return form(null);
      if (t.dataset.edit) return edit(t.dataset.edit);
      if (t.dataset.agree) return agreement(t.dataset.agree);
      if (t.dataset.hist) return history(t.dataset.hist);
      if (t.hasAttribute('data-terms')) return terms.open();
      if (t.dataset.del) return del(t.dataset.del, t.dataset.name || 'this garage');
      if (t.dataset.restore) { try { await rpc('admin_garage_restore', { p_id: t.dataset.restore }); toast('Garage is back.'); load(); } catch (e) { toast(msg(e), true); } }
    });
  }
  let wired = false;
  return { mount(el) { if (!el) return; root = el; if (!wired || !root.dataset.gv) { root.dataset.gv = '1'; wire(); wired = true; } load(); } };
}
