// The partner-garage desk, shared by Crew and the Admin: onboard a garage onto the garage app, show its private link and PIN once, reset, renew or revoke access,
// send a booking to a garage, review garage estimates, and (Admin only) enter what we owe each garage. ONE file: crm/garage-desk.js is the source and
// admin/garage-desk.js is an identical copy (scripts/sync_shared.sh). It holds no business rules of its own: every action calls the crm_garage_* database
// functions (supabase/migrations/20270101000000_garage_app.sql), which check flow_can('manage_garages') and refuse everyone else.
// Never shown here: a customer's address or email, or any phone number. A booking is named by its booking id, first name and area only.
import { chip, emptyState, errorState, skeleton } from './ds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const cleanErr = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^Error:\s*/, '');

/* ---------- pure rules (no DOM, no Supabase) ---------- */
export const OPEN = ['sent', 'received', 'in_work', 'ready'];   // a job the garage still holds
export const ASSIGN = { sent: ['Sent', 'info'], received: ['Received', 'info'], in_work: ['In work', 'warn'], ready: ['Ready', 'good'], returned: ['Returned', 'good'], cancelled: ['Moved or removed', ''] };
export const EST_FILTERS = [['submitted', 'To review'], ['converted', 'Approved'], ['rejected', 'Rejected']];
export const KIND_LABEL = { parts: 'Parts', labour: 'Labour', other: 'Other' };

/** The status of the garage itself (its onboarding stage), in the words the desk uses. */
export function garageStatus(s) {
  if (['pilot', 'live'].includes(s)) return { label: 'Active', tone: 'good' };
  if (s === 'paused') return { label: 'Paused', tone: 'warn' };
  if (['applied', 'visited', 'kyc_done', 'trained'].includes(s)) return { label: 'Applied', tone: 'info' };
  return { label: String(s || 'Unknown'), tone: '' };
}
/** Access of one garage: none, on, locked (too many wrong PINs, clears itself) or revoked. rows are crm_garage_access_list rows of that garage. */
export function accessState(rows, now = Date.now()) {
  const list = [...(rows || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const a = list.find((x) => !x.revoked_at) || list[0];
  const last = list.map((x) => x.last_login_at).filter(Boolean).sort().pop() || null;
  if (!a) return { key: 'none', label: 'No access yet', tone: '', access: null, last };
  if (!a.active) return { key: 'off', label: 'Revoked', tone: 'bad', access: a, last };
  if (a.locked_until && new Date(a.locked_until).getTime() > now) return { key: 'locked', label: 'Locked until ' + when(a.locked_until), tone: 'warn', access: a, last };
  return { key: 'on', label: 'Access on', tone: 'good', access: a, last };
}
/** Shop location and Open/Closed from the garage's access rows (crm_garage_access_list). Old rows without the new fields give no chip and no link. */
export function shopInfo(rows) {
  const list = [...(rows || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), a = list.find((x) => x.is_open != null || x.map_url) || list[0] || null;
  if (!a) return { open: null, openAt: null, map: null, locAt: null };
  const map = typeof a.map_url === 'string' && /^https:\/\/www\.google\.com\/maps\?q=-?[0-9.]+,-?[0-9.]+$/.test(a.map_url) ? a.map_url : null;
  return { open: a.is_open == null ? null : !!a.is_open, openAt: a.is_open_at || null, map, locAt: a.shop_loc_at || null };
}
export const openJobs = (assignments, garageId) => (assignments || []).filter((a) => a.garage_id === garageId && OPEN.includes(a.status)).length;
/** The same PIN rules as the database (4 to 6 digits, not all the same digit). Returns an error sentence, or null when fine. */
export function pinError(pin) {
  const p = String(pin ?? '');
  if (!/^[0-9]{4,6}$/.test(p)) return 'The PIN must be 4 to 6 digits.';
  if (/^(\d)\1+$/.test(p)) return 'Choose a PIN that is not all the same digit.';
  return null;
}
/** A random 6-digit PIN. rand(n) returns a whole number from 0 to n-1; the default is the browser's secure random, looked up when called. */
export function makePin(rand) {
  const r = rand || ((n) => { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; });
  for (;;) { let p = ''; for (let i = 0; i < 6; i++) p += String(r(10)); if (!pinError(p)) return p; }
}
export const reasonError = (r) => (String(r ?? '').trim().length < 3 ? 'Write a short reason (at least 3 letters).' : null);
export function estimateTotals(e) {
  const sub = (e.lines || []).reduce((n, l) => n + (Number(l.amount) || 0), 0);
  return { subtotal: e.subtotal != null ? Number(e.subtotal) : sub, gst: e.gst != null ? Number(e.gst) : Math.round(sub * 18) / 100 };
}
export const settleError = (v) => { const n = Number(v); return String(v ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || n > 1000000 ? 'Enter an amount from 0 to 10,00,000.' : null; };

/** deps: { rpc(name, args), toast(msg, bad), can(action), dialog(opts), canSettle(), openLead?(id), reload?(), copy?(text), random?(n), now?() } */
export function createGarageDesk(deps) {
  const { rpc, toast } = deps;
  const visible = () => !!deps.can('manage_garages');
  const mayEnter = () => visible() && !!(deps.canSettle && deps.canSettle());
  const now = () => (deps.now ? deps.now() : Date.now());
  const copy = deps.copy || (async (text) => { try { await globalThis.navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Copy failed. Select the text and copy it.', true); } });
  const S = { tab: 'garages', q: '', est: 'submitted', data: null, failed: [], root: null };
  const after = async (card) => { const here = S.root && S.root.isConnected !== false; if (here) await mount(S.root); if ((card || !here) && deps.reload) await deps.reload(); };   // redraw the screen; reload the booking card when the change came from it
  const need = () => { if (!visible()) throw new Error('You do not have permission to manage garages.'); };

  /* ----- dialogs ----- */
  /** Ask "are you sure" with a required reason. The garage-app functions take no reason argument, so it is for the person's own care and is not stored. */
  function confirmReason({ title, intro, submit, run }) {
    return deps.dialog({ title, intro: `${intro} <br><small>Write why. The server does not keep the reason yet, so note it somewhere you can find it.</small>`,
      body: '<label class="flow-label" for="gd-why">Reason (required)</label><input id="gd-why" name="reason" maxlength="120" autocomplete="off">', submit,
      onSubmit: async (f, d) => { const bad = reasonError(f.reason.value); if (bad) throw new Error(bad); await run(f.reason.value.trim(), d); } });
  }
  /** The link and PIN, once. Nothing here is saved: the values live only in this dialog's closure, never in a toast, a list or the page. */
  function secretDialog({ title, garage, link, pin }) {
    const secrets = { link, pin };
    const body = `<p class="flow-warn" role="alert"><b>Shown once.</b> This ${link && pin ? 'link and PIN are' : link ? 'link is' : 'PIN is'} not stored anywhere readable. Copy ${link && pin ? 'them' : 'it'} now and send ${link && pin ? 'them to the garage in two separate messages' : 'it to the garage'}. If you lose ${link && pin ? 'them' : 'it'}, make ${link && pin ? 'a new link and reset the PIN' : link ? 'a new link' : 'a new PIN'}.</p>
      ${link ? `<label class="flow-label">Private link for ${esc(garage)}</label><p class="flow-box2" data-secret="link">${esc(link)}</p><div class="flow-row"><button class="flow-btn flow-primary" type="button" data-copy="link">Copy link</button></div>` : ''}
      ${pin ? `<label class="flow-label">PIN</label><p class="flow-code" data-secret="pin">${esc(pin)}</p><div class="flow-row"><button class="flow-btn flow-primary" type="button" data-copy="pin">Copy PIN</button></div>` : ''}`;
    return deps.dialog({ title, intro: esc(garage), body, onOpen: (f) => { f.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(secrets[b.dataset.copy]))); } });
  }

  /* ----- access actions ----- */
  const actions = {
    onboard(g) {
      need(); const pin0 = makePin(deps.random);
      return deps.dialog({ title: 'Create garage app access', intro: `${esc(g.name)}${g.code ? ' · ' + esc(g.code) : ''}. You will see the private link and the PIN once, right after this.`,
        body: `<label class="flow-label" for="gd-label">Who is this for</label><input id="gd-label" name="label" maxlength="40" value="Owner" autocomplete="off">
          <label class="flow-label" for="gd-pin">PIN (4 to 6 digits)</label><input id="gd-pin" name="pin" inputmode="numeric" maxlength="6" value="${esc(pin0)}" autocomplete="off"><p class="flow-muted">A random PIN is filled in. Change it if the garage asked for one.</p>`,
        submit: 'Create access', onSubmit: async (f, d) => {
          const pin = f.pin.value.trim(), bad = pinError(pin); if (bad) throw new Error(bad);
          const r = await rpc('crm_garage_access_create', { p_garage: g.id, p_pin: pin, p_label: f.label.value.trim() || 'Owner' });
          d.close(); toast('Access created.'); secretDialog({ title: 'Private link and PIN', garage: r.garage || g.name, link: r.link, pin }); await after();
        } });
    },
    pinReset(a, name) {
      need(); const pin0 = makePin(deps.random);
      return deps.dialog({ title: 'Reset the PIN', intro: `${esc(name)}. The garage is signed out at once and needs the new PIN. The link stays the same.`,
        body: `<label class="flow-label" for="gd-pin">New PIN (4 to 6 digits)</label><input id="gd-pin" name="pin" inputmode="numeric" maxlength="6" value="${esc(pin0)}" autocomplete="off">
          <label class="flow-label" for="gd-why">Reason (required)</label><input id="gd-why" name="reason" maxlength="120" autocomplete="off"><p class="flow-muted">The server does not keep the reason yet, so note it somewhere you can find it.</p>`,
        submit: 'Reset PIN', onSubmit: async (f, d) => {
          const pin = f.pin.value.trim(), bad = pinError(pin) || reasonError(f.reason.value); if (bad) throw new Error(bad);
          await rpc('crm_garage_pin_reset', { p_access: a.id, p_pin: pin });
          d.close(); toast('PIN reset.'); secretDialog({ title: 'New PIN', garage: name, pin }); await after();
        } });
    },
    newLink(a, name) {
      need();
      return confirmReason({ title: 'Make a new private link', intro: `${esc(name)}. The old link stops working at once and the garage is signed out. The PIN stays the same.`, submit: 'Make new link',
        run: async (reason, d) => { const r = await rpc('crm_garage_link_new', { p_access: a.id }); d.close(); toast('New link made.'); secretDialog({ title: 'New private link', garage: name, link: r.link }); await after(); } });
    },
    revoke(a, name) {
      need();
      return confirmReason({ title: 'Revoke access', intro: `${esc(name)} is signed out at once and cannot open the app until you switch it on again.`, submit: 'Revoke access',
        run: async (reason, d) => { await rpc('crm_garage_revoke', { p_access: a.id }); d.close(); toast('Access revoked.'); await after(); } });
    },
    enable(a, name) {
      need();
      return deps.dialog({ title: 'Switch access on again', intro: `${esc(name)} can open the app again with the same link and PIN.`, submit: 'Switch on',
        onSubmit: async (f, d) => { await rpc('crm_garage_enable', { p_access: a.id }); d.close(); toast('Access switched on.'); await after(); } });
    },

    /* ----- jobs ----- */
    /** Send a booking to a garage. Give { lead } from a booking, or { garageId } from the Garages screen (then pick the booking from the paid bookings). */
    async assign({ lead, garageId, moveFrom, screen, reassign: re } = {}) {
      need();
      const [garages, bookings] = await Promise.all([rpc('crm_garage_picker'), lead ? Promise.resolve(null) : rpc('crm_dispatch_list', { p_days: 7 })]);
      const list = (garages || []).filter((g) => g.status !== 'paused' && g.id !== moveFrom);
      const access = (S.data && S.data.access) || [];
      const opt = (g) => `<option value="${esc(g.id)}"${g.id === garageId ? ' selected' : ''}>${esc(g.name)}${g.code ? ' · ' + esc(g.code) : ''}${access.length && !access.some((x) => x.garage_id === g.id && x.active) ? ' (no app access)' : ''}${g.available === false ? ' (Not available)' : ''}</option>`;
      const pick = lead ? '' : `<label class="flow-label" for="gd-lead">Booking</label><select id="gd-lead" name="lead"><option value="">Choose</option>${(bookings || []).map((b) => `<option value="${esc(b.id)}">${esc(b.booking_id || 'Booking')} · ${esc(b.first_name || '')} · ${esc(b.area || 'No area')}${b.bike ? ' · ' + esc(b.bike) : ''}</option>`).join('')}</select>`;
      const OTHER = '__other__', reassign = !!(moveFrom || re);
      return deps.dialog({ title: reassign ? 'Reassign this booking' : 'Assign a garage or partner', intro: lead ? esc([lead.booking_id, lead.area].filter(Boolean).join(' · ') || 'This booking') : 'Pick the booking and the garage. The garage sees the vehicle, the work and the first name only.',
        body: `${pick}<label class="flow-label" for="gd-garage">Garage or partner</label><select id="gd-garage" name="garage"><option value="">Choose</option>${list.map(opt).join('')}<option value="${OTHER}">Other / outside partner</option></select>
          <div data-gd-outside hidden><label class="flow-label" for="gd-out">Outside partner (name and area)</label><input id="gd-out" name="outside" maxlength="80" autocomplete="off"></div>
          <label class="flow-label" for="gd-note">What was found and what is needed (optional)</label><input id="gd-note" name="note" maxlength="500" autocomplete="off">
          <label class="flow-label" for="gd-eta">Return expected (optional)</label><input id="gd-eta" name="eta" type="datetime-local">`,
        submit: reassign ? 'Reassign' : 'Assign',
        onOpen: (f) => { f.garage.addEventListener('change', () => { f.querySelector('[data-gd-outside]').hidden = f.garage.value !== OTHER; }); },
        onSubmit: async (f, d) => {
          const leadId = lead ? lead.id : f.lead.value; if (!leadId) throw new Error('Choose a booking.');
          const other = f.garage.value === OTHER; if (!f.garage.value) throw new Error('Choose a garage or Other / outside partner.');
          const outside = other ? f.outside.value.trim() : null; if (other && outside.length < 2) throw new Error('Write the name of the outside partner.');
          let eta = null; if (f.eta.value) { const t = new Date(f.eta.value); if (Number.isNaN(t.getTime())) throw new Error('Enter a valid return time.'); eta = t.toISOString(); }
          // Exactly one of garage or outside goes to the database; the database also checks the confirmation fee is paid and says so in plain words.
          const r = await rpc('crm_assign_booking', { p_lead: leadId, p_garage: other ? null : f.garage.value, p_outside: outside, p_note: f.note.value.trim() || null, p_eta: eta });
          d.close(); toast(other ? 'Assigned to ' + outside + '.' : r && r.updated ? 'Job updated for ' + r.garage + '.' : 'Sent to ' + ((r && r.garage) || 'the garage') + '.'); await after(!!lead && !screen);
        } });
    },
    review(e, approve) {
      need();
      if (approve) return deps.dialog({ title: 'Approve this estimate', intro: `${esc(e.garage)} · ${esc(e.booking_id || 'Booking')}. This makes the quote and <b>sends it to the customer now</b> (WhatsApp and email) for their approval.`,
        body: '<label class="flow-label" for="gd-rn">Note for the record (optional)</label><input id="gd-rn" name="note" maxlength="300" autocomplete="off">', submit: 'Approve and send to customer',
        onSubmit: async (f, d) => {
          const r = await rpc('crm_garage_estimate_review', { p_id: e.id, p_approve: true, p_note: f.note.value.trim() || null }); d.close();
          const v = r && r.quote && r.quote.version ? ' v' + r.quote.version : '';
          // Approving used to stop at a draft, so the customer never got the estimate. Send it straight away; if the send fails the draft stays and we say so.
          if (deps.sendQuote && e.lead_id) { try { await deps.sendQuote(e.lead_id); toast('Quote' + v + ' sent to the customer for approval.'); } catch (x) { toast('Draft quote' + v + ' made but NOT sent: ' + String((x && x.message) || x).slice(0, 120) + '. Open the booking and press Send.', true); } }
          else toast('Draft quote' + v + ' made. Open the booking to check and send it.');
          await after();
        } });
      return deps.dialog({ title: 'Reject this estimate', intro: `${esc(e.garage)} · ${esc(e.booking_id || 'Booking')}. The garage sees your reason.`,
        body: '<label class="flow-label" for="gd-rn">Reason (required)</label><input id="gd-rn" name="note" maxlength="300" autocomplete="off">', submit: 'Reject estimate',
        onSubmit: async (f, d) => { const bad = reasonError(f.note.value); if (bad) throw new Error(bad); await rpc('crm_garage_estimate_review', { p_id: e.id, p_approve: false, p_note: f.note.value.trim() }); d.close(); toast('Estimate rejected.'); await after(); } });
    },
    requestDecide(type, id, approve) {
      need();
      return deps.dialog({ title: approve ? 'Approve this request' : 'Decline this request', intro: approve ? (type === 'cancel' ? 'The job goes back to Dispatch.' : type === 'hours' ? 'The garage\'s working hours are updated.' : 'Only approve after you have checked the bank documents on WhatsApp.') : 'The garage sees your reason.',
        body: `<label class="flow-label" for="gd-rq">${approve ? 'Note (optional)' : 'Reason (required)'}</label><input id="gd-rq" name="note" maxlength="200" autocomplete="off">`, submit: approve ? 'Approve' : 'Decline',
        onSubmit: async (f, d) => { if (!approve) { const bad = reasonError(f.note.value); if (bad) throw new Error(bad); } await rpc('crm_garage_request_decide', { p_type: type, p_id: id, p_decision: approve ? 'approved' : 'declined', p_note: f.note.value.trim() || null }); d.close(); toast('Saved.'); await after(approve && type === 'cancel'); } });
    },
    announce() {
      need();
      return deps.dialog({ title: 'New announcement', intro: 'Every partner garage sees this in the app. No ID, bank or card numbers.',
        body: `<label class="flow-label" for="gd-at">Title</label><input id="gd-at" name="title" maxlength="80" autocomplete="off"><label class="flow-label" for="gd-ab">Message</label><textarea id="gd-ab" name="body" rows="4" maxlength="600"></textarea>
          <label class="flow-label" for="gd-ak">Kind</label><select id="gd-ak" name="kind"><option value="info">Update</option><option value="policy">Policy</option><option value="alert">Service alert</option></select>
          <label class="flow-label" for="gd-ad">Show for (days)</label><input id="gd-ad" name="days" inputmode="numeric" value="30" maxlength="3" autocomplete="off">`, submit: 'Publish',
        onSubmit: async (f, d) => { await rpc('crm_announcement_save', { p_title: f.title.value.trim(), p_body: f.body.value.trim(), p_kind: f.kind.value, p_days: Number(f.days.value) || 30 }); d.close(); toast('Published.'); await after(); } });
    },
    settle(a) {
      need(); if (!mayEnter()) throw new Error('Only the owner can enter settlement amounts.');
      const s = a.settlement || {};
      return deps.dialog({ title: 'What we owe the garage', intro: `${esc(a.garage)} · ${esc(a.booking_id || 'Booking')}. Enter the amount yourself. Nothing is worked out for you.`,
        body: `<label class="flow-label" for="gd-amt">Amount (₹)</label><input id="gd-amt" name="amount" inputmode="decimal" value="${esc(s.amount ?? '')}" autocomplete="off">
          <label class="flow-check"><input type="checkbox" name="settled"${s.settled ? ' checked' : ''}> Already paid to the garage</label>
          <label class="flow-label" for="gd-sn">Note (optional)</label><input id="gd-sn" name="note" maxlength="200" value="${esc(s.note || '')}" autocomplete="off">`,
        submit: 'Save amount', onSubmit: async (f, d) => {
          const bad = settleError(f.amount.value); if (bad) throw new Error(bad);
          await rpc('crm_garage_settlement_set', { p_assignment: a.id, p_amount: Number(f.amount.value), p_settled: !!f.settled.checked, p_note: f.note.value.trim() || null });
          d.close(); toast('Amount saved.'); await after();
        } });
    },
  };

  /* ----- what a booking's card shows ----- */
  const forLead = (leadId) => rpc('crm_garage_assignments_list', { p_status: null, p_lead: leadId });
  function leadHtml(rows) {
    if (!rows) return '';   // the card already says it could not load this part
    const cur = rows.find((a) => OPEN.includes(a.status)), past = rows.filter((a) => a !== cur);
    let h = '<h4>Partner garage</h4>';
    if (cur) {
      const [t, tone] = ASSIGN[cur.status] || [cur.status, ''];
      h += `<p><b>${esc(cur.garage)}</b> ${chip(t, tone)}${cur.eta ? `<br><span class="flow-muted">Return expected ${esc(when(cur.eta))}</span>` : ''}</p>`;
      if (['sent', 'received'].includes(cur.status)) h += `<div class="flow-row"><button class="flow-btn" type="button" data-flow="garageAssign" data-move="${esc(cur.garage_id)}">Move to another garage</button></div>`;
      else h += '<p class="flow-muted">The garage has started, so the job cannot be moved from here.</p>';
    } else h += `<p class="flow-muted">Not with a partner garage.</p><div class="flow-row"><button class="flow-btn" type="button" data-flow="garageAssign">Send to a partner garage</button></div>`;
    if (past.length) h += `<ul class="flow-list">${past.map((a) => `<li>${esc(a.garage)} · ${esc((ASSIGN[a.status] || [a.status])[0])} <small class="flow-muted">${esc(when(a.assigned_at))}</small></li>`).join('')}</ul>`;
    return h;
  }

  /* ----- the Garages screen ----- */
  async function load() {
    const failed = [], safe = (name, p) => p.then((x) => x, (e) => { failed.push({ name, why: cleanErr(e) }); return null; });
    const [garages, access, assignments, estimates] = await Promise.all([safe('garages', rpc('crm_garage_picker')), safe('app access', rpc('crm_garage_access_list', { p_garage: null })),
      safe('jobs sent to garages', rpc('crm_garage_assignments_list', { p_status: null, p_lead: null })), safe('estimates', rpc('crm_garage_estimates_inbox', { p_status: S.est || null }))]);
    // Client BRD: requests from garages (cancel, bank details, working hours) and announcements. A part that fails shows in the list of what could not load.
    const [requests, announcements] = await Promise.all([safe('requests', rpc('crm_garage_requests_list')), safe('announcements', rpc('crm_announcement_list'))]);
    return { garages: garages || [], access: access || [], assignments: assignments || [], estimates: estimates || [], requests: requests || [], announcements: announcements || [], failed };
  }
  const cards = (d) => {
    const q = S.q.trim().toLowerCase();
    const rows = d.garages.filter((g) => !q || String(g.name).toLowerCase().includes(q) || String(g.code || '').toLowerCase().includes(q));
    if (!rows.length) return emptyState({ title: d.garages.length ? 'No garage matches' : 'No garages yet', text: d.garages.length ? 'Try another name or code.' : 'Add the garage on the Garages page first, then create its app access here.' });
    return `<ul class="flow-dispatch">${rows.map((g) => {
      const st = garageStatus(g.status), mine = d.access.filter((x) => x.garage_id === g.id), ac = accessState(mine, now()), n = openJobs(d.assignments, g.id), a = ac.access, shop = shopInfo(mine);
      const btn = (act, label, cls = '') => `<button class="flow-btn ${cls}" type="button" data-gd="${act}" data-id="${esc(g.id)}">${label}</button>`;
      const row = ac.key === 'none' ? [btn('onboard', 'Create access', 'flow-primary')] : ac.key === 'off' ? [btn('enable', 'Switch access on', 'flow-primary')] : [btn('assignTo', 'Send a booking'), btn('pinReset', 'Reset PIN'), btn('newLink', 'New link'), btn('revoke', 'Revoke', 'flow-ghost')];
      return `<li class="flow-d" data-id="${esc(g.id)}"><div><b>${esc(g.name)}</b> <span class="flow-muted">${esc(g.code || '')}${g.pincode ? ' · ' + esc(g.pincode) : ''}</span></div>
        <div>${chip(st.label, st.tone)} ${chip(ac.label, ac.tone)} ${n ? chip(`${n} open ${n === 1 ? 'job' : 'jobs'}`, 'info') : chip('No open jobs')} ${shop.open === null ? '' : chip(shop.open ? 'Open' : 'Closed', shop.open ? 'good' : '')}</div>
        ${shop.open !== null && shop.openAt ? `<div class="flow-muted">${shop.open ? 'Open' : 'Closed'} since ${esc(when(shop.openAt))}</div>` : ''}${shop.map ? `<div><a href="${esc(shop.map)}" target="_blank" rel="noopener">Shop location</a>${shop.locAt ? ` <span class="flow-muted">(${esc(when(shop.locAt))})</span>` : ''}</div>` : a ? '<div class="flow-muted">Shop location not shared yet.</div>' : ''}
        <div class="flow-muted">${ac.last ? 'Last opened the app ' + esc(when(ac.last)) : a ? 'Has not opened the app yet' : ''}${a && a.label ? ' · ' + esc(a.label) : ''}</div><div class="flow-row">${row.join('')}</div></li>`;
    }).join('')}</ul>`;
  };
  const jobsHtml = (d) => {
    if (!d.assignments.length) return emptyState({ title: 'No jobs sent to garages yet', text: 'Send a booking from its card or from a garage here.' });
    return `<ul class="flow-dispatch">${d.assignments.map((a) => {
      const [t, tone] = ASSIGN[a.status] || [a.status, ''], last = (a.progress || []).slice(-1)[0], s = a.settlement, done = ['ready', 'returned'].includes(a.status);
      const money = s ? `${esc(inr(s.amount))} · ${s.settled ? 'paid' : 'not paid yet'}${s.note ? ' · ' + esc(s.note) : ''}` : 'Not entered';
      return `<li class="flow-d" data-id="${esc(a.id)}"><div><b>${esc(a.booking_id || 'Booking')}</b> · ${esc(a.garage)} ${chip(t, tone)}</div>
        <div class="flow-muted">Sent ${esc(when(a.assigned_at))}${a.eta ? ' · return expected ' + esc(when(a.eta)) : ''}${last ? ' · last update: ' + esc(String(last.event).replace('_', ' ')) + ' ' + esc(when(last.at)) : ''}</div>${a.notes ? `<div>${esc(a.notes)}</div>` : ''}
        ${done ? `<div>We owe: <b>${money}</b></div>` : ''}
        <div class="flow-row">${['sent', 'received'].includes(a.status) ? `<button class="flow-btn" type="button" data-gd="move" data-id="${esc(a.id)}">Move to another garage</button>` : ''}${deps.openLead ? `<button class="flow-btn flow-ghost" type="button" data-gd="openLead" data-id="${esc(a.lead_id)}">Open booking</button>` : ''}${done && mayEnter() ? `<button class="flow-btn" type="button" data-gd="settle" data-id="${esc(a.id)}">${s ? 'Change amount' : 'Enter amount'}</button>` : ''}</div></li>`;
    }).join('')}</ul>`;
  };
  const estimatesHtml = (d) => {
    const filt = `<div class="flow-seg" role="group" aria-label="Estimate filter">${EST_FILTERS.map(([k, t]) => `<button class="flow-btn flow-sm" type="button" data-gd="est" data-id="${k}" aria-pressed="${S.est === k}">${t}</button>`).join('')}</div>`;
    if (!d.estimates.length) return filt + emptyState({ title: 'No estimates here', text: 'When a garage sends an estimate it appears here for you to approve or reject.' });
    return filt + `<ul class="flow-dispatch">${d.estimates.map((e) => {
      const t = estimateTotals(e), tone = e.status === 'submitted' ? 'warn' : e.status === 'converted' ? 'good' : 'bad', lab = e.status === 'converted' ? 'Approved' : e.status === 'rejected' ? 'Rejected' : 'To review';
      return `<li class="flow-d ${e.status === 'submitted' ? 'flow-d-open' : ''}" data-id="${esc(e.id)}"><div><b>${esc(e.booking_id || 'Booking')}</b> · ${esc(e.garage)} ${chip(lab, tone)}</div>
        <table class="gd-lines"><tbody>${(e.lines || []).map((l) => `<tr><td>${esc(KIND_LABEL[l.kind] || l.kind)}</td><td>${esc(l.name)}</td><td class="gd-n">${esc(inr(l.amount))}</td></tr>`).join('')}</tbody></table>
        <div>Before GST ${esc(inr(t.subtotal))} · GST 18% ${esc(inr(t.gst))} · <b>Total ${esc(inr(t.subtotal + t.gst))}</b></div>
        <div class="flow-muted">${e.hours ? 'About ' + esc(e.hours) + ' hours' : e.return_day ? 'Return on ' + esc(e.return_day) : 'No time given'} · sent ${esc(when(e.submitted_at))}</div>${e.notes ? `<div>${esc(e.notes)}</div>` : ''}${e.review_note ? `<div class="flow-muted">Review note: ${esc(e.review_note)}</div>` : ''}
        ${e.status === 'submitted' ? `<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-gd="approve" data-id="${esc(e.id)}">Approve</button><button class="flow-btn flow-ghost" type="button" data-gd="reject" data-id="${esc(e.id)}">Reject</button>${deps.editEstimate ? `<button class="flow-btn" type="button" data-gd="editEst" data-id="${esc(e.id)}">Edit estimate</button>` : ''}</div>` : ''}
        ${e.status === 'converted' && deps.openLead ? `<div class="flow-row"><button class="flow-btn flow-ghost" type="button" data-gd="openLead" data-id="${esc(e.lead_id)}">Open booking</button></div>` : ''}</li>`;
    }).join('')}</ul>`;
  };
  /* ----- requests from garages: cancel a job, change bank details, change working hours ----- */
  const REQ = { cancel: 'Cancel a job', bank: 'Bank detail change', hours: 'Working hours change' };
  const requestsHtml = (d) => {
    const rows = d.requests || [];
    if (!rows.length) return emptyState({ title: 'No requests from garages', text: 'When a garage asks to cancel a job, or to change its bank details or working hours, it appears here for you to approve or decline.' });
    return `<ul class="flow-dispatch">${rows.map((r) => {
      const tone = r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'bad', det = r.type === 'hours' && r.details ? `${esc(r.details.open_days)} · ${esc(r.details.open_time)} to ${esc(r.details.close_time)}` : '';
      return `<li class="flow-d ${r.status === 'pending' ? 'flow-d-open' : ''}" data-id="${esc(r.id)}"><div><b>${esc(r.garage)}</b> · ${esc(REQ[r.type] || r.type)}${r.ref ? ' · ' + esc(r.ref) : ''} ${chip(r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Declined', tone)}</div>
        ${det ? `<div>${det}</div>` : ''}<div class="flow-muted">“${esc(r.reason)}” · ${esc(when(r.created_at))}</div>
        ${r.type === 'bank' && r.status === 'pending' ? '<div class="flow-muted">Take the bank documents on WhatsApp, check them, then approve. No account number is stored here.</div>' : ''}
        ${r.status === 'pending' ? `<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-gd="reqApprove" data-id="${esc(r.id)}" data-type="${esc(r.type)}">Approve</button><button class="flow-btn flow-ghost" type="button" data-gd="reqDecline" data-id="${esc(r.id)}" data-type="${esc(r.type)}">Decline</button></div>` : ''}</li>`;
    }).join('')}</ul>`;
  };
  /* ----- announcements to every partner garage ----- */
  const ANN = { info: 'Update', policy: 'Policy', alert: 'Service alert' };
  const announcementsHtml = (d) => {
    const rows = d.announcements || [];
    const add = '<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-gd="annNew">New announcement</button></div>';
    if (!rows.length) return add + emptyState({ title: 'No announcements yet', text: 'Write one and every partner garage sees it in the app.' });
    return add + `<ul class="flow-dispatch">${rows.map((a) => `<li class="flow-d" data-id="${esc(a.id)}"><div><b>${esc(a.title)}</b> ${chip(ANN[a.kind] || 'Update', a.kind === 'alert' ? 'warn' : '')} ${chip(a.active ? 'Showing' : 'Archived', a.active ? 'good' : '')}</div>
      <div>${esc(a.body)}</div><div class="flow-muted">${esc(when(a.created_at))} · read by ${esc(a.read)} ${Number(a.read) === 1 ? 'garage' : 'garages'}</div>${a.active ? `<div class="flow-row"><button class="flow-btn flow-ghost" type="button" data-gd="annArchive" data-id="${esc(a.id)}">Archive</button></div>` : ''}</li>`).join('')}</ul>`;
  };
  function paint() {
    const d = S.data, root = S.root; if (!d || !root) return;
    const toReview = S.est === 'submitted' ? d.estimates.length : null;
    const waiting = (d.requests || []).filter((r) => r.status === 'pending').length;
    const tabs = [['garages', 'Garages'], ['estimates', 'Estimates' + (toReview ? ` (${toReview})` : '')], ['requests', 'Requests' + (waiting ? ` (${waiting})` : '')], ['announcements', 'Announcements'], ['jobs', 'Jobs sent']];
    const fail = d.failed.length ? errorState({ title: 'Could not load: ' + d.failed.map((f) => f.name).join(', '), detail: d.failed[0].why + '. What you see may be incomplete.', retry: { label: 'Retry', attr: 'data-gd="retry"' } }) : '';
    root.innerHTML = `<section class="gd" aria-label="Garage app"><h2>Garage app</h2><p class="flow-muted">Give partner garages their private link and PIN, send them bookings, and review their estimates.${mayEnter() ? '' : ' Settlement amounts are entered by the owner.'}</p>${fail}
      <div class="flow-seg" role="group" aria-label="Garage app sections">${tabs.map(([k, t]) => `<button class="flow-btn flow-sm" type="button" data-gd="tab" data-id="${k}" aria-pressed="${S.tab === k}">${esc(t)}</button>`).join('')}</div>
      ${S.tab === 'garages' ? `<input class="gd-q" data-gd-q type="search" placeholder="Search garage name or code" aria-label="Search garages" value="${esc(S.q)}"><div data-gd-list>${cards(d)}</div>` : S.tab === 'estimates' ? estimatesHtml(d) : S.tab === 'requests' ? requestsHtml(d) : S.tab === 'announcements' ? announcementsHtml(d) : jobsHtml(d)}</section>`;
  }
  const bound = new WeakSet();
  function bind(root) {
    if (bound.has(root)) return; bound.add(root);
    root.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('[data-gd-q]')) { S.q = e.target.value; const l = root.querySelector('[data-gd-list]'); if (l && S.data) l.innerHTML = cards(S.data); } });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gd]'); if (!b || b.dataset.busy) return; b.dataset.busy = '1';
      const id = b.dataset.id, d = S.data || {}, g = (d.garages || []).find((x) => x.id === id), ac = g ? accessState((d.access || []).filter((x) => x.garage_id === id), now()).access : null, name = g ? g.name : '';
      try {
        switch (b.dataset.gd) {
          case 'tab': S.tab = id; paint(); break;
          case 'retry': await mount(root); break;
          case 'est': S.est = id; await mount(root); break;
          case 'onboard': await actions.onboard(g); break;
          case 'pinReset': await actions.pinReset(ac, name); break;
          case 'newLink': await actions.newLink(ac, name); break;
          case 'revoke': await actions.revoke(ac, name); break;
          case 'enable': await actions.enable(ac, name); break;
          case 'assignTo': await actions.assign({ garageId: id }); break;
          case 'move': { const a = (d.assignments || []).find((x) => x.id === id); await actions.assign({ lead: { id: a.lead_id, booking_id: a.booking_id }, moveFrom: a.garage_id, screen: true }); break; }
          case 'approve': case 'reject': await actions.review((d.estimates || []).find((x) => x.id === id), b.dataset.gd === 'approve'); break;
          case 'editEst': { const e = (d.estimates || []).find((x) => x.id === id); if (e && deps.editEstimate) await deps.editEstimate(e); await after(); break; }
          case 'reqApprove': case 'reqDecline': await actions.requestDecide(b.dataset.type, id, b.dataset.gd === 'reqApprove'); break;
          case 'annNew': await actions.announce(); break;
          case 'annArchive': await rpc('crm_announcement_archive', { p_id: id }); toast('Archived.'); await mount(root); break;
          case 'settle': await actions.settle((d.assignments || []).find((x) => x.id === id)); break;
          case 'openLead': if (deps.openLead) deps.openLead(id); break;
          default: break;
        }
      } catch (x) { console.error('garage desk', b.dataset.gd, x); toast('That did not work: ' + cleanErr(x), true); } finally { delete b.dataset.busy; }
    });
  }
  /** Draw the screen into root. A person without the permission gets no data calls, only a plain message. */
  async function mount(root) {
    S.root = root; bind(root);
    if (!visible()) { root.innerHTML = errorState({ title: 'You do not have access to the garage app screen.', detail: 'Ask the owner to turn on Manage garages for you.', retry: null }); return; }
    root.innerHTML = skeleton();
    S.data = await load(); paint();
  }
  return { visible, mount, load, paint, forLead, leadHtml, assignDialog: actions.assign, actions, secretDialog, state: S };
}
