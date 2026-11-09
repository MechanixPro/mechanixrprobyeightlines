// Partner KYC review screen (Admin, owner and admin only). Rules live in kyc-rules.js (shared with Crew, pure).
// Documents are never shown inline: View asks the kyc-admin function for a link that works for 60 seconds and opens it in a new tab.
import { applicantChip, sortApplicants, docChip, checklist, canApprove, missingAccepted, checkReason, docLabel, esc } from './kyc-rules.js';
import { chip, skeleton, errorState, emptyState } from './ds.js';

const TONE = { ok: 'good', bad: 'bad', warn: 'warn', muted: '' };
const KIND = { garage: 'Garage', mechanic: 'Mechanic' };
const STAGE = { applied: 'Applied', visited: 'Visited', kyc_done: 'KYC done', trained: 'Trained', live: 'Live' };
const when = (t) => { try { return t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''; } catch (e) { return ''; } };

export function listHtml(rows) {
  const list = sortApplicants(rows);
  if (!list.length) return emptyState({ title: 'No applicants right now.', text: 'Garages and mechanics who are applying will show up here.' });
  return `<ul class="kv-list">${list.map((r) => { const c = applicantChip(r); return `<li class="kv-row">
    <button type="button" class="kv-open" data-open="${esc(r.kind)}:${esc(r.id)}" aria-label="Review ${esc(r.name)}"><span class="kv-name">${esc(r.name || 'Unnamed')}</span>
      <span class="kv-sub">${esc(KIND[r.kind] || r.kind)} · ${esc(r.phone || 'No phone')} · ${esc(STAGE[r.status] || r.status)}</span>
      <span class="kv-meta">${chip(c.label, TONE[c.tone])} <span class="kv-count">${Number(r.docs) || 0} documents${r.submitted_at ? ' · sent ' + esc(when(r.submitted_at)) : ''}</span></span></button>
    <button type="button" class="btn btn-ghost kv-link" data-link="${esc(r.kind)}:${esc(r.id)}">Send onboarding link</button></li>`; }).join('')}</ul>`;
}

export function detailHtml(d, { reason = '' } = {}) {
  const c = applicantChip({ decision: d.decision, submitted: !!d.submitted_at });
  const docs = d.docs || [], rows = checklist(d.kind, docs), ok = canApprove(d.kind, docs), miss = missingAccepted(d.kind, docs);
  const approved = d.decision === 'approved', live = d.status === 'live';
  const fileRow = (f, i, n, label) => { const dc = docChip(f.status); return `<div class="kv-file"><span class="kv-fname">${esc(n > 1 ? label + ' ' + (i + 1) : label)}</span> ${chip(dc.label, TONE[dc.tone])}${f.reject_reason ? `<span class="kv-why">Reason: ${esc(f.reject_reason)}</span>` : ''}
    <span class="kv-acts"><button type="button" class="btn btn-ghost" data-view="${esc(f.id)}" title="Link works for 60 seconds">View</button><button type="button" class="btn btn-ghost" data-accept="${esc(f.id)}"${f.status === 'accepted' ? ' disabled' : ''}>Accept</button><button type="button" class="btn danger" data-reject="${esc(f.id)}" data-label="${esc(label)}"${f.status === 'rejected' ? ' disabled' : ''}>Reject</button></span></div>`; };
  const group = (g) => `<li class="kv-doc"><div class="kv-dhead"><b>${esc(g.label)}</b> ${g.required ? chip(g.accepted >= g.min ? 'Done' : `${g.accepted} of ${g.min} accepted`, g.accepted >= g.min ? 'good' : 'warn') : chip('Extra', '')}</div>
    ${g.files.length ? g.files.map((f, i) => fileRow(f, i, g.files.length, g.label)).join('') : '<p class="kv-none">Not uploaded yet.</p>'}</li>`;
  const decided = approved
    ? `<p class="kv-note">KYC approved.${d.decision_reason ? ' ' + esc(d.decision_reason) : ''}</p>${live ? chip('Live', 'good') : '<button type="button" class="btn primary kv-big" data-onboard>Onboard (go live)</button>'}`
    : `<label class="kv-f"><span>Reason (needed to reject the whole KYC)</span><textarea id="kvReason" rows="2" maxlength="300">${esc(reason)}</textarea></label>
       <div class="kv-big-row"><button type="button" class="btn primary kv-big" data-approve${ok ? '' : ' disabled'}>Approve KYC</button><button type="button" class="btn danger kv-big" data-decline>Reject KYC</button></div>
       ${ok ? '' : `<p class="kv-hint">Approve unlocks when every required document is Accepted. Still needed: ${esc(miss.map((m) => docLabel(m.type) + (m.need > 1 ? ' (' + m.need + ' more)' : '')).join(', '))}.</p>`}`;
  const del = d.decision === 'rejected' && docs.length ? '<button type="button" class="btn danger" data-delete>Delete documents</button>' : '';
  return `<div class="kv-detail"><button type="button" class="btn btn-ghost" data-back>Back to list</button>
    <h3 class="kv-title">${esc(d.name || 'Unnamed')}</h3>
    <p class="kv-sub">${esc(KIND[d.kind] || d.kind)} · ${esc(d.phone || 'No phone')} · ${esc(STAGE[d.status] || d.status)} ${chip(c.label, TONE[c.tone])}</p>
    ${d.decision === 'rejected' && d.decision_reason ? `<p class="kv-note">Rejected: ${esc(d.decision_reason)}</p>` : ''}
    <p class="kv-hint">View opens a link that works for 60 seconds. Documents are never shown on this page.</p>
    <ul class="kv-docs">${rows.map(group).join('')}</ul>${decided}${del}</div>`;
}

export function createKycView({ rpc, invoke, dialog, toast }) {
  let root = null, rows = null, cur = null;
  const msg = (e) => String((e && e.message) || e || 'Something went wrong. Try again.');
  const bad = (e) => toast(msg(e), true);

  async function showList() {
    cur = null; root.innerHTML = skeleton(3, 'Loading applicants');
    try { rows = await rpc('kyc_review_list'); root.innerHTML = listHtml(rows || []); }
    catch (e) { root.innerHTML = errorState({ title: 'Applicants could not load.', detail: msg(e) }); root.querySelector('[data-retry]')?.addEventListener('click', showList); }
  }
  async function showDetail(kind, id, keepReason) {
    const reason = keepReason ? (root.querySelector('#kvReason')?.value || '') : '';
    if (!keepReason) root.innerHTML = skeleton(4, 'Loading documents');
    try { cur = await rpc('kyc_review_detail', { p_kind: kind, p_id: id }); root.innerHTML = detailHtml(cur, { reason }); }
    catch (e) { root.innerHTML = errorState({ title: 'This applicant could not load.', detail: msg(e) }); root.querySelector('[data-retry]')?.addEventListener('click', () => showDetail(kind, id)); }
  }
  const refresh = () => showDetail(cur.kind, cur.id, true);
  const askReason = (title, intro, run) => dialog({ title, intro, body: '<label class="flow-f"><span>Reason</span><textarea name="why" rows="3" maxlength="300" required></textarea></label>', submit: 'Reject',
    onSubmit: async (f, { close, say }) => { const r = checkReason(f.querySelector('[name=why]').value); if (!r.ok) return say(r.error); await run(r.reason); close(); } });
  const confirmBox = (title, intro, submit, run) => dialog({ title, intro, submit, onSubmit: async (f, { close }) => { await run(); close(); } });

  async function sendLink(kind, id) {
    try {
      const r = await invoke('kyc-admin', { action: 'link', kind, id });
      dialog({ title: 'Onboarding link', intro: 'Shown once. Copy it or send it on WhatsApp now. It is private and works for 14 days.',
        body: `<p class="flow-box2" style="overflow-wrap:anywhere">${esc(r.url)}</p><div class="flow-row"><button class="flow-btn" type="button" data-copy>Copy link</button>${r.wa ? `<a class="flow-btn" href="${esc(r.wa)}" target="_blank" rel="noopener">Open WhatsApp</a>` : '<span class="flow-muted">No phone number on file, so WhatsApp cannot open.</span>'}</div>`,
        onOpen: (f) => f.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.url); toast('Copied.'); } catch (e) { toast('Copy failed. Select the link and copy it.', true); } }) });
    } catch (e) { bad(e); }
  }
  /* After going live the partner needs a way in: make the app access (private link and a random PIN) in the same step and offer the welcome message on WhatsApp. The link and PIN show once. */
  const makePin = () => { const a = new Uint32Array(1); for (;;) { crypto.getRandomValues(a); const p = String(1000 + (a[0] % 9000)); if (!/^(.)\1+$/.test(p) && p !== '1234' && p !== '4321') return p; } };
  async function issueAccess(who) {
    const pin = makePin();
    let r;
    try {
      r = who.kind === 'garage' ? await rpc('crm_garage_access_create', { p_garage: who.id, p_pin: pin, p_label: 'Owner' }) : await rpc('crm_mechanic_access_create', { p_mechanic: who.id, p_pin: pin });
    } catch (e) {
      if (/already has app access/i.test(msg(e))) return toast(who.name + ' already has app access. Use the ' + (who.kind === 'garage' ? 'Garage app' : 'Mechanic app') + ' tab to reset the PIN or make a new link.');
      return bad(e);
    }
    const first = String(who.name || '').split(' ')[0] || 'there', phone = String(who.phone || '').replace(/\D/g, '').slice(-10);
    const app = who.kind === 'garage' ? 'garage app' : 'mechanic app';
    const text = `Hi ${first}, you are now live on Mechanix Pro. Open your ${app}: ${r.link}\nYour PIN: ${pin}\nKeep both private. On first open you will share your location, set yourself Available and accept the terms. New jobs arrive here with a sound.`;
    dialog({ title: 'App access for ' + (who.name || 'the partner'), intro: 'Shown once. Send it now: the link and the PIN are not kept in a readable form.',
      body: `<label class="flow-label">Private link</label><p class="flow-box2" style="overflow-wrap:anywhere">${esc(r.link)}</p><label class="flow-label">PIN</label><p class="flow-code">${esc(pin)}</p><div class="flow-row"><button class="flow-btn" type="button" data-copy>Copy the message</button>${phone ? `<a class="flow-btn flow-primary" href="https://wa.me/91${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>` : ''}</div>`,
      onOpen: (f) => f.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Copy failed. Select the link and copy it.', true); } }) });
  }
  async function viewDoc(id) {
    try { const r = await invoke('kyc-admin', { action: 'view', doc: id }); const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove(); toast('Opened. The link works for 60 seconds.'); } catch (e) { bad(e); }
  }
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { bad(e); } };

  function wire() {
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('button'); if (!t || t.disabled) return;
      const [k, i] = String(t.dataset.open || t.dataset.link || '').split(':');
      if (t.dataset.open) return showDetail(k, i);
      if (t.dataset.link) return sendLink(k, i);
      if (t.hasAttribute('data-back')) return showList();
      if (t.dataset.view) return viewDoc(t.dataset.view);
      if (t.dataset.accept) return run(async () => { await rpc('kyc_doc_set_status', { p_doc: t.dataset.accept, p_status: 'accepted', p_reason: null }); await refresh(); }, 'Accepted.');
      if (t.dataset.reject) return askReason('Reject ' + t.dataset.label, 'Tell the applicant what to fix. They will see this reason.', async (why) => { await rpc('kyc_doc_set_status', { p_doc: t.dataset.reject, p_status: 'rejected', p_reason: why }); await refresh(); toast('Rejected.'); });
      if (t.hasAttribute('data-approve')) { if (!canApprove(cur.kind, cur.docs)) return; return confirmBox('Approve KYC', `Approve the documents of ${cur.name}? This does not make them live.`, 'Approve KYC', async () => { await rpc('kyc_decide', { p_kind: cur.kind, p_id: cur.id, p_decision: 'approve', p_reason: null }); await refresh(); toast('KYC approved.'); }); }
      if (t.hasAttribute('data-decline')) { const r = checkReason(root.querySelector('#kvReason')?.value); if (!r.ok) { toast(r.error, true); root.querySelector('#kvReason')?.focus(); return; } return run(async () => { await rpc('kyc_decide', { p_kind: cur.kind, p_id: cur.id, p_decision: 'reject', p_reason: r.reason }); await refresh(); }, 'KYC rejected.'); }
      if (t.hasAttribute('data-onboard')) return confirmBox('Go live', `Make ${cur.name} live? They will start getting work, and you will get their app link and PIN to send right after.`, 'Go live', async () => { const who = cur; await rpc('kyc_onboard', { p_kind: who.kind, p_id: who.id }); await refresh(); toast('Now live.'); await issueAccess(who); });
      if (t.hasAttribute('data-delete')) return confirmBox('Delete documents', `Delete every uploaded document of ${cur.name}? This cannot be undone.`, 'Delete documents', async () => { const r = await invoke('kyc-admin', { action: 'delete', kind: cur.kind, id: cur.id }); await refresh(); toast(`Deleted ${r && r.removed != null ? r.removed : ''} files.`); });
    });
  }
  let wired = false;
  return { mount(el) { if (!el) return; root = el; if (!wired || !root.dataset.kv) { root.dataset.kv = '1'; wire(); wired = true; } showList(); } };
}
