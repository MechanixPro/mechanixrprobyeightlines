// WhatsApp Cloud inbox: conversation row, thread view and composer, shared by the Crew Inbox and the Admin supervision page.
// Mirrored byte for byte in admin/wa-thread.js. Markup functions are pure (tests render them with fixtures); createWaThread() does the DOM and network work.
import { esc, TABS, LANGS, QUICK_REPLIES, phoneLabel, windowChip, ticks, groupThread, mediaInfo, timeLabel, waitText, templateDefaults, failText } from './wa-rules.js';

export const LOADING = '<div class="wa-state" role="status" aria-live="polite"><span class="wa-spin" aria-hidden="true"></span> Loading...</div>';
export const errorBox = (e, retry = 'retry') => `<div class="wa-state wa-err" role="alert"><p>${esc(failText(e))}</p><button class="btn sm" type="button" data-wa="${retry}">Try again</button></div>`;

export const paidChip = (paid) => (paid ? '<span class="chip good" title="Booking is paid">PAID</span>' : '');

/** One compact conversation row (list on the left in Crew, table row in Admin uses its own markup). */
export function convRowHtml(r, selected) {
  const name = r.name || phoneLabel(r.phone);
  return `<button type="button" class="wa-row${selected ? ' on' : ''}${r.unread ? ' unread' : ''}" data-phone="${esc(r.phone)}" aria-current="${selected ? 'true' : 'false'}">
    <span class="wa-main"><b class="wa-name">${esc(name)}</b>${paidChip(r.paid)}${r.booking_id ? `<span class="chip soft">${esc(r.booking_id)}</span>` : ''}<span class="wa-time">${esc(timeLabel(r.last_message_at))}</span></span>
    <span class="wa-sub"><span class="wa-prev">${esc(r.last_preview || '')}</span>${r.unread ? `<span class="badge">${Number(r.unread)}</span>` : ''}</span>
    <span class="wa-meta">${r.status === 'closed' ? '<span class="chip soft">Closed</span>' : r.assigned_name ? `<span class="chip soft">${esc(r.assigned_name)}</span>` : '<span class="chip warn">Unassigned</span>'}${r.waiting ? '<span class="chip late">Waiting on us</span>' : ''}${r.window_open ? '' : '<span class="chip soft">Template only</span>'}</span></button>`;
}

export function listHtml(rows, selected) {
  return rows.length ? rows.map((r) => convRowHtml(r, selected === r.phone)).join('') : '<div class="empty">No conversations here.</div>';
}

function mediaHtml(m, id) {
  const i = mediaInfo(m);
  if (!i) return '';
  if (i.kind === 'location') return `<div class="wa-media">Location${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}</div>`;
  return `<div class="wa-media" data-media-box="${esc(id)}"><span class="wa-ph">${esc(i.label)}</span>${i.loadable ? `<button class="btn sm" type="button" data-wa="load" data-media="${esc(i.id)}" data-kind="${esc(i.kind)}" data-mime="${esc(i.mime)}" data-name="${esc(m.filename || '')}">Load</button>` : ''}</div>`;
}

export function itemHtml(it) {
  if (it.kind === 'day') return `<div class="wa-day"><span>${esc(it.label)}</span></div>`;
  if (it.kind === 'note') return `<div class="wa-note" title="Internal note, the customer never sees this"><b>Internal note</b> · ${esc(it.by || 'Team')} · ${esc(timeLabel(it.at))}<p>${esc(it.body)}</p></div>`;
  const out = it.direction === 'out', t = ticks(it.direction, it.status);
  const who = out ? (it.sender === 'ai' ? 'AI assistant' : it.sender === 'system' ? 'System' : it.by || 'Team') : '';
  const showBody = it.body && !(it.media && mediaInfo(it.media) && /^\[(Photo|Voice note|Audio|Video|Sticker|Document[^\]]*)\]$/.test(it.body));
  return `<div class="wa-msg ${out ? 'out' : 'in'}${it.status === 'failed' ? ' failed' : ''}">${who ? `<span class="wa-who">${esc(who)}${it.channel === 'aisensy' ? ' · desk number' : ''}</span>` : ''}${mediaHtml(it.media, it.id)}${showBody ? `<span class="wa-body">${esc(it.body)}</span>` : ''}
    <span class="wa-foot">${esc(timeLabel(it.at))}${t && t.glyph ? ` <span class="tick ${t.cls}" title="${esc(t.label)}" aria-label="${esc(t.label)}">${t.glyph}</span>` : ''}</span>${it.status === 'failed' && it.status_detail ? `<span class="wa-fail">${esc(it.status_detail)}</span>` : ''}${it.status === 'unknown' ? `<span class="wa-fail">${esc(t.label)}</span>` : ''}</div>`;
}

export function composerHtml(d, tpls) {
  const c = d.conversation, chip = windowChip(c.last_inbound_at);
  if (c.opted_out) return '<div class="wa-composer"><div class="alert">This customer asked not to get messages. You cannot send anything.</div></div>';
  if (!chip.open) {
    const list = tpls?.templates || [];
    return `<div class="wa-composer closed"><div class="alert" role="status"><b>${esc(chip.text)}.</b> WhatsApp allows only an approved template now. It re-opens when the customer replies.</div>
      ${tpls ? `<div class="wa-tpl"><label>Template <select data-wa-field="tpl">${list.map((t) => `<option value="${esc(t.name)}">${esc(t.label)}</option>`).join('')}</select></label>
      <label>Language <select data-wa-field="lang">${LANGS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <div class="wa-vars" data-wa-vars>${tplVars(list[0], d)}</div><button class="btn wa" type="button" data-wa="send-template">Send template</button></div>` : LOADING}</div>`;
  }
  return `<div class="wa-composer"><div class="wa-quick" role="group" aria-label="Quick replies">${QUICK_REPLIES.map(([l, t]) => `<button type="button" class="chip soft" data-wa="quick" data-text="${esc(t)}">${esc(l)}</button>`).join('')}</div>
    <div class="wa-box"><textarea data-wa-field="text" rows="2" maxlength="4000" placeholder="Type a reply" aria-label="Reply"></textarea>
    <div class="wa-actions"><label class="btn sm ghost" title="Send a voice note, photo or document">Attach<input type="file" data-wa-field="file" accept="audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,image/jpeg,image/png,application/pdf" hidden></label><button class="btn wa" type="button" data-wa="send">Send</button></div></div>
    <details class="wa-notebox"><summary>Add an internal note</summary><textarea data-wa-field="note" rows="2" maxlength="2000" placeholder="Only your team sees this"></textarea><button class="btn sm" type="button" data-wa="note">Save note</button></details></div>`;
}
export function tplVars(t, d) {
  const defs = templateDefaults(t, { name: d?.lead?.name || d?.conversation?.name, booking_id: d?.lead?.booking_id });
  return (t?.vars || []).map((v, i) => `<label>${esc(v)} <input data-wa-field="var" data-i="${i}" value="${esc(defs[i] || '')}" maxlength="200"></label>`).join('');
}

export function threadHtml(d, tpls) {
  const c = d.conversation, l = d.lead, chip = windowChip(c.last_inbound_at), mine = c.assigned_to && c.assigned_to === c.me;
  const rows = groupThread(d.items || [], d.notes || []);
  const aiState = c.ai_auto === true ? 'on' : c.ai_auto === false ? 'off' : (c.ai_global === false ? 'off (global)' : 'on (default)');
  return `<header class="wa-head"><button type="button" class="btn sm ghost wa-back" data-wa-back aria-label="Back to conversations">Back</button><div><h2>${esc(c.name || phoneLabel(c.phone))}</h2><p class="muted small">${esc(phoneLabel(c.phone))}${l ? ` · <button type="button" class="linkish" data-wa="lead" data-lead="${esc(l.id)}">${esc(l.booking_id || l.ref || 'Open lead')}</button> ${paidChip(l.paid)}` : ''}</p></div>
    <div class="wa-tools"><span class="chip ${esc(chip.tone)}" role="status" data-wa-chip>${esc(chip.text)}</span>
    ${c.status === 'closed' ? `<button class="btn sm" type="button" data-wa="reopen">Reopen</button>` : `${mine ? '<span class="chip soft">Yours</span>' : `<button class="btn sm primary" type="button" data-wa="claim">${c.assigned_name ? 'Take over' : 'Claim'}</button>`}<button class="btn sm" type="button" data-wa="close">Close</button>`}
    <button class="btn sm ghost" type="button" data-wa="ai" title="AI auto reply for this chat">AI ${esc(aiState)}</button></div>${c.assigned_name && !mine ? `<p class="muted small">Handled by ${esc(c.assigned_name)}. The AI does not reply while a person holds this chat.</p>` : ''}${c.status === 'closed' ? `<p class="muted small">Closed${c.closed_reason ? ': ' + esc(c.closed_reason) : ''}. A new message from the customer reopens it.</p>` : ''}</header>
    <div class="wa-scroll" data-wa-scroll tabindex="0" aria-label="Messages">${rows.length ? rows.map(itemHtml).join('') : '<div class="empty">No messages yet.</div>'}</div>${composerHtml(d, tpls)}`;
}

/** The shared tabs bar (Crew list). */
export const tabsHtml = (counts, cur) => `<div class="wa-tabs tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" role="tab" data-wa-tab="${k}" aria-current="${k === cur ? 'page' : 'false'}">${esc(t)}${counts && counts[k] ? ` <span class="badge">${Number(counts[k])}</span>` : ''}</button>`).join('')}</div>`;

/**
 * The thread controller. deps: { sb, url, anonKey, toast, onChange (list refresh), openLead (optional) }.
 * open(host, phone) renders the thread into host and polls every 15 s while the tab is visible; close() stops.
 */
export function createWaThread(deps) {
  const { sb, url, anonKey, toast } = deps;
  let host = null, phone = null, data = null, tpls = null, timer = null, busy = false, token = 0;
  const call = async (name, body) => {   // raw fetch: wa-media returns bytes, wa-send returns JSON with meaningful non-2xx codes
    const { data: s } = await sb.auth.getSession();
    return fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${s?.session?.access_token ?? anonKey}` }, body: JSON.stringify(body) });
  };
  const rpc = async (n, a) => { const { data: d, error } = await sb.rpc(n, a); if (error) throw error; return d; };
  const $ = (s) => host?.querySelector(s);
  const draft = () => ({ text: $('[data-wa-field=text]')?.value ?? '', note: $('[data-wa-field=note]')?.value ?? '' });

  async function load(keepDraft) {
    const my = ++token; const keep = keepDraft ? draft() : null; const scroll = $('[data-wa-scroll]'); const atEnd = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
    try {
      const d = await rpc('crm_wa_thread', { p_phone: phone });
      if (my !== token) return; data = d;
      if (!windowChip(d.conversation.last_inbound_at).open && !tpls) loadTemplates();
      const sel = { tpl: $('[data-wa-field=tpl]')?.value, lang: $('[data-wa-field=lang]')?.value };
      render(); if (keep) { const t = $('[data-wa-field=text]'); if (t) t.value = keep.text; const n = $('[data-wa-field=note]'); if (n) { n.value = keep.note; if (keep.note) n.closest('details').open = true; } }
      if (sel.tpl && $('[data-wa-field=tpl]')) { $('[data-wa-field=tpl]').value = sel.tpl; } if (sel.lang && $('[data-wa-field=lang]')) $('[data-wa-field=lang]').value = sel.lang;
      const sc = $('[data-wa-scroll]'); if (sc && (atEnd || !keepDraft)) sc.scrollTop = sc.scrollHeight;
      if (d.conversation.status === 'open') rpc('crm_wa_mark_read', { p_phone: phone }).then(() => deps.onChange?.()).catch(() => {});
    } catch (e) { if (my === token && !data) host.innerHTML = errorBox(e); else if (my === token) toast(failText(e), true); }
  }
  async function loadTemplates() {
    try { const r = await call('wa-send', { action: 'templates' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not load templates'); tpls = j; if (data) { render(); } } catch (e) { toast(failText(e), true); }
  }
  function render() { host.innerHTML = threadHtml(data, tpls); }

  async function act(fn, ok) { if (busy) return; busy = true; try { await fn(); if (ok) toast(ok); deps.onChange?.(); await load(true); } catch (e) { toast(failText(e), true); } finally { busy = false; } }

  async function send(body) {
    if (busy) return; busy = true;
    const btn = host.querySelector('[data-wa=send],[data-wa=send-template]'); if (btn) btn.disabled = true;
    try {
      const r = await call('wa-send', { phone, ...body }); const j = await r.json().catch(() => ({}));
      if (r.status === 409) { toast(j.error || 'The 24 hour window is closed. Pick a template.', true); await load(true); return; }
      if (r.status === 202 || j.unknown) { toast(j.error || 'Not sure the message was delivered. Check before sending again.', true); await load(false); return; }
      if (!r.ok) throw new Error(j.error || 'WhatsApp did not accept the message');
      if (j.saved === false) toast('Sent, but it was not saved in the chat history. Do not send it again.', true); else toast('Sent');
      if (btn) btn.disabled = false; const t = $('[data-wa-field=text]'); if (t) t.value = ''; deps.onChange?.(); busy = false; await load(false);
    } catch (e) { toast(failText(e), true); if (btn) btn.disabled = false; } finally { busy = false; }
  }
  const b64 = (file) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = () => rej(new Error('Could not read the file')); f.readAsDataURL(file); });

  async function loadMedia(btn) {
    const box = btn.closest('[data-media-box]'); btn.disabled = true; btn.textContent = 'Loading...';
    try {
      const r = await call('wa-media', { media_id: btn.dataset.media });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Could not load the file'); }
      const blob = await r.blob(), kind = btn.dataset.kind, obj = URL.createObjectURL(blob);
      if (kind === 'image' || kind === 'sticker') box.innerHTML = `<img class="wa-img" alt="Customer photo" src="${obj}">`;
      else if (kind === 'audio') box.innerHTML = `<audio class="wa-audio" controls preload="metadata" src="${obj}"></audio>`;
      else if (kind === 'video') box.innerHTML = `<video class="wa-img" controls preload="metadata" src="${obj}"></video>`;
      else box.innerHTML = `<a class="btn sm" href="${obj}" download="${esc(btn.dataset.name || 'file')}">Download ${esc(btn.dataset.name || 'file')}</a>`;
    } catch (e) { btn.disabled = false; btn.textContent = 'Load'; toast(failText(e), true); }
  }

  function onClick(ev) {
    const el = ev.target.closest('[data-wa]'); if (!el || !host.contains(el)) return; const a = el.dataset.wa;
    if (a === 'retry') return load(false);
    if (a === 'quick') { const t = $('[data-wa-field=text]'); if (t) { t.value = (t.value ? t.value + ' ' : '') + el.dataset.text; t.focus(); } return; }
    if (a === 'load') return loadMedia(el);
    if (a === 'lead') return deps.openLead?.(el.dataset.lead);
    if (a === 'claim') return act(() => rpc('crm_wa_claim', { p_phone: phone }), 'It is yours. The AI will not reply on this chat.');
    if (a === 'close') { const why = window.prompt('Why are you closing this chat? (optional)', 'Resolved'); if (why === null) return; return act(() => rpc('crm_wa_close', { p_phone: phone, p_reason: why }), 'Closed'); }
    if (a === 'reopen') return act(() => rpc('crm_wa_reopen', { p_phone: phone }), 'Reopened');
    if (a === 'ai') { const cur = data.conversation.ai_auto; const next = cur === true ? false : cur === false ? null : true; return act(() => rpc('crm_wa_ai', { p_phone: phone, p_on: next }), next === null ? 'AI follows the global setting' : next ? 'AI auto reply is on for this chat' : 'AI auto reply is off for this chat'); }
    if (a === 'note') { const v = $('[data-wa-field=note]').value.trim(); if (!v) return toast('Write the note first', true); return act(async () => { await rpc('crm_wa_note', { p_phone: phone, p_body: v }); $('[data-wa-field=note]').value = ''; }, 'Note saved'); }
    if (a === 'send') { const v = $('[data-wa-field=text]').value.trim(); if (!v) return toast('Write a message first', true); return send({ text: v }); }
    if (a === 'send-template') {
      const name = $('[data-wa-field=tpl]').value, lang = $('[data-wa-field=lang]').value, vars = [...host.querySelectorAll('[data-wa-field=var]')].map((i) => i.value.trim());
      if (vars.some((v) => !v)) return toast('Fill every box in the template', true);
      return send({ template: { name, lang, vars } });
    }
  }
  async function onChange(ev) {
    const el = ev.target;
    if (el.matches('[data-wa-field=tpl]')) { const t = (tpls?.templates || []).find((x) => x.name === el.value); $('[data-wa-vars]').innerHTML = tplVars(t, data); }
    if (el.matches('[data-wa-field=file]') && el.files[0]) {
      const f = el.files[0]; el.value = '';
      const type = f.type.startsWith('audio/') ? 'audio' : f.type.startsWith('image/') ? 'image' : 'document';
      if (f.size > 15e6) return toast(failText('That file is too large'), true);
      try { const base64 = await b64(f); const cap = $('[data-wa-field=text]').value.trim(); return send({ media: { type, base64, mime: f.type, filename: f.name, caption: cap } }); } catch (e) { toast(failText(e), true); }
    }
  }
  const tick = () => { if (document.visibilityState === 'visible' && host && !busy && !document.activeElement?.matches?.('textarea,input,select')) load(true); const c = $('[data-wa-chip]'); if (c && data) { const w = windowChip(data.conversation.last_inbound_at); c.textContent = w.text; } };
  return {
    async open(h, p) {
      this.close(); host = h; phone = p; data = null; tpls = null; host.innerHTML = LOADING;
      host.addEventListener('click', onClick); host.addEventListener('change', onChange);
      await load(false); timer = setInterval(tick, 15000);
    },
    close() { if (timer) clearInterval(timer); timer = null; if (host) { host.removeEventListener('click', onClick); host.removeEventListener('change', onChange); } host = null; token++; },
    refresh: () => load(true),
  };
}
