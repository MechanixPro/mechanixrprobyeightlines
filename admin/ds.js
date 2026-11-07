// Shared UI helpers for Crew and Admin (Step 3). ONE file: crm/ds.js is the source and admin/ds.js is an identical copy (scripts/sync_shared.sh).
// Pure string builders, no imports, nothing touches the page when the file loads. The look comes from ds.css (mx-* classes).
// It also holds the ONE vocabulary: how each stored status is shown. Stored values (new, contacted, quoted, payment_sent, paid, scheduled, completed, lost, junk) never change.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** stored status -> words and colour. Scheduled shows as Booked, completed as Done. */
export const STATUS = {
  new: { label: 'New', tone: 'info' }, contacted: { label: 'Contacted', tone: 'info' }, quoted: { label: 'Quote sent', tone: 'warn' }, payment_sent: { label: 'Advance link sent', tone: 'warn' },
  paid: { label: 'Booked', tone: 'good' }, scheduled: { label: 'Booked', tone: 'good' }, completed: { label: 'Done', tone: 'good' }, lost: { label: 'Lost', tone: 'bad' }, junk: { label: 'Junk', tone: 'neutral' },
};
export const statusInfo = (v) => STATUS[v] || { label: String(v ?? '—'), tone: 'neutral' };
export const statusLabel = (v) => statusInfo(v).label;
export const statusTone = (v) => statusInfo(v).tone;

/** Tone of a message or issue status shown in the flow card and the lists. */
export const NOTICE_TONE = { sent: 'good', failed: 'bad', skipped: 'warn' };
export const ISSUE_TONE = { open: 'bad', resolved: 'good' };
const TONES = ['good', 'bad', 'warn', 'info'];

/** A small coloured label. tone: good, bad, warn, info or anything else for neutral. extra: more classes. */
export const chip = (text, tone = '', extra = '') => `<span class="mx-chip${TONES.includes(tone) ? ' mx-chip--' + tone : ''}${extra ? ' ' + esc(extra) : ''}">${esc(text)}</span>`;
export const statusChip = (v, extra = '') => { const s = statusInfo(v); return chip(s.label, s.tone, extra); };

/** Nothing here yet. action: { label, attr } makes a button; attr is a fixed attribute written in code (like data-retry), never user text, so it is not escaped. */
export const emptyState = ({ title = '', text = '', action = null } = {}) => `<div class="mx-empty" role="status">${title ? `<b>${esc(title)}</b>` : ''}${text ? `<span>${esc(text)}</span>` : ''}${action ? `<div><button class="mx-btn mx-btn--primary" type="button" ${action.attr || ''}>${esc(action.label)}</button></div>` : ''}</div>`;

/** Grey blocks while a page loads. n blocks after one short title line. */
export const skeleton = (n = 3, label = 'Loading') => `<div class="mx-skeleton-group" role="status" aria-live="polite" aria-busy="true"><span class="mx-sr">${esc(label)}</span><span class="mx-skeleton mx-skeleton--line" style="width:40%"></span>${Array.from({ length: Math.max(1, n) }, () => '<span class="mx-skeleton mx-skeleton--card"></span>').join('')}</div>`;

/** Something failed. detail is the reason in plain words. retry: { label, attr } adds a button (default Try again). Pass retry: null for no button. */
export const errorState = ({ title = 'This could not load.', detail = '', retry = { label: 'Try again', attr: 'data-retry' } } = {}) => `<div class="mx-error" role="alert"><b>${esc(title)}</b>${detail ? `<p>${esc(detail)}</p>` : ''}${retry ? `<button class="mx-btn mx-btn--primary" type="button" ${retry.attr || 'data-retry'}>${esc(retry.label || 'Try again')}</button>` : ''}</div>`;

/** Show a short message at the bottom of the page. The document is looked up when it is called, never when the file loads. */
export function showToast(message, bad = false, doc = globalThis.document, ms = 4200) {
  if (!doc) return null;
  const t = doc.createElement('div'); t.className = 'toast fade' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = message;
  doc.body.appendChild(t); setTimeout(() => t.remove(), ms); return t;
}

/** Phone card twin for wide tables (ds.css .mx-table--cards). Marks every table with 5 or more columns inside root and copies each header cell's text onto its column's cells as data-label.
 *  Pure markup attributes, no behaviour: on desktop the table looks the same; under 700px ds.css shows each row as a card. Returns how many tables it marked. */
export function labelTables(root) {
  if (!root || !root.querySelectorAll) return 0;
  let n = 0;
  for (const t of root.querySelectorAll('table:not(.inv-table):not(.gd-lines):not(.mx-table--cards)')) {
    const hr = t.querySelector('thead tr'); if (!hr) continue;
    const heads = [...hr.children]; if (heads.length < 5) continue;
    const labels = heads.map((h) => (h.textContent || '').trim());
    for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (labels[i] && td.tagName === 'TD') td.setAttribute('data-label', labels[i]); });
    t.classList.add('mx-table--cards'); n++;
  }
  return n;
}
