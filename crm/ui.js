// Shared helpers for the desk screens. Nothing here talks to the database except rpc().
let client = null;
export const setClient = (c) => { client = c; };
export const supabase = () => client;

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const clean = (e) => String(e?.message || e || 'Something went wrong').replace(/^Error:\s*/, '');
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

export function toast(m, bad) {
  const t = document.createElement('div'); t.className = 'toast fade' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = m;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
}

/** One labelled form field. type: text, tel, number, date, datetime-local, textarea, select, checks (options = [[value, label]]). */
export function field(label, name, o = {}) {
  const id = 'f_' + name, v = o.value ?? '', req = o.required ? ' required' : '';
  const hint = o.hint ? `<span class="hint">${esc(o.hint)}</span>` : '';
  let input;
  if (o.type === 'textarea') input = `<textarea id="${id}" name="${name}" rows="${o.rows || 3}" maxlength="${o.max || 1000}" placeholder="${esc(o.placeholder || '')}"${req}>${esc(v)}</textarea>`;
  else if (o.type === 'select') input = `<select id="${id}" name="${name}"${req}>${o.blank === false ? '' : `<option value="">${esc(o.blank || 'Choose')}</option>`}${(o.options || []).map(([val, text]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  else if (o.type === 'checks') {
    const have = new Set([].concat(v || []));
    return `<fieldset class="checks"><legend class="label">${esc(label)}</legend><div class="check-grid">${(o.options || []).map(([val, text]) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(val)}"${have.has(val) ? ' checked' : ''}><span>${esc(text)}</span></label>`).join('')}</div>${hint}</fieldset>`;
  } else input = `<input id="${id}" name="${name}" type="${o.type || 'text'}" value="${esc(v)}" placeholder="${esc(o.placeholder || '')}" autocomplete="off"${o.inputmode ? ` inputmode="${o.inputmode}"` : ''}${o.min != null ? ` min="${o.min}"` : ''}${o.max != null ? ` max="${o.max}"` : ''}${o.step ? ` step="${o.step}"` : ''}${req}>`;
  return `<div class="fld${o.half ? ' half' : ''}"><label class="label" for="${id}">${esc(label)}</label>${input}${hint}</div>`;
}

/** Read every field of a form into a plain object. Checkbox groups become arrays; blank text becomes ''. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}

/** A dialog with a form. onSubmit(form, data) may throw; the message shows inside the dialog and it stays open. */
export function modal({ title, intro, body, submit = 'Save', cancel = 'Cancel', wide, onSubmit, onOpen, onClose, danger }) {
  const el = document.createElement('div'); el.className = 'modal-back';
  el.innerHTML = `<form class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate><h2>${esc(title)}</h2>${intro ? `<p class="muted small">${intro}</p>` : ''}<div class="modal-body">${body}</div><p class="err" role="alert"></p>
    <div class="row end">${cancel ? `<button class="btn ghost" type="button" data-close>${esc(cancel)}</button>` : ''}${onSubmit ? `<button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
  document.body.appendChild(el);
  const form = $('form', el), err = $('.err', el);
  const close = () => { if (el.isConnected) { el.remove(); if (onClose) onClose(); } };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const btn = $('button[type=submit]', form); if (btn) btn.disabled = true;
    try { await onSubmit(form, formData(form), close); } catch (x) { err.textContent = clean(x); if (btn) btn.disabled = false; }
  });
  const first = $('input:not([type=hidden]), select, textarea', form); if (first) first.focus();
  if (onOpen) onOpen(form, close);
  return { el, form, close };
}

export function confirmBox(message, label = 'Yes', danger = false) {
  return new Promise((res) => {
    let ok = false;
    modal({ title: 'Please confirm', body: `<p>${esc(message)}</p>`, submit: label, danger, onSubmit: async (f, d, close) => { ok = true; close(); }, onClose: () => res(ok) });
  });
}

/** Page heading with optional tools (HTML) on the right. */
export const head = (title, hint, tools = '') => `<div class="view-head"><div><h1>${esc(title)}</h1>${hint ? `<p class="muted">${hint}</p>` : ''}</div><div class="view-tools">${tools}</div></div>`;
export const chips = (items, current, attr = 'data-f') => `<div class="filters" role="group">${items.map(([v, t, n]) => `<button type="button" class="chip pick${v === current ? ' on' : ''}" ${attr}="${esc(v)}" aria-pressed="${v === current}">${esc(t)}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`;
export const empty = (t) => `<div class="empty">${t}</div>`;
export const tag = (text, tone = '') => `<span class="chip ${tone}">${esc(text)}</span>`;
export const bar = (done, target) => { const p = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0; return `<div class="bar dark" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`; };

/** Parse CSV text (quotes, commas, newlines) into objects keyed by the header row. Header names are lower-cased with spaces turned to underscores. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const keys = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function toCsv(rows, columns) {
  const q = (v) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return [columns.map(([, h]) => q(h)).join(','), ...rows.map((r) => columns.map(([k]) => q(typeof k === 'function' ? k(r) : r[k])).join(','))].join('\n');
}
export function downloadFile(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const STAGE = { new: 'New', contacted: 'Contacted', quoted: 'Quote sent', payment_sent: 'Advance link sent', paid: 'Booked', scheduled: 'Scheduled', completed: 'Won', lost: 'Lost' };
export const SLOTS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening'], ['asap', 'As soon as possible']];
export const PROBLEMS = [['puncture', 'Puncture'], ['battery', 'Dead battery'], ['wont_start', 'Will not start'], ['chain_or_brake', 'Chain or brake'], ['fuel', 'Out of fuel'], ['overheating', 'Overheating or smoke'], ['accident', 'Accident'], ['electric_fault', 'Electric bike fault'], ['other', 'Other']];
export const PIPE = [['applied', 'Applied'], ['visited', 'Visited'], ['kyc_done', 'KYC done'], ['trained', 'Trained'], ['pilot', 'Pilot'], ['live', 'Live'], ['paused', 'Paused']];
export const label = (list, v) => (list.find(([k]) => k === v) || [, v || '—'])[1];
