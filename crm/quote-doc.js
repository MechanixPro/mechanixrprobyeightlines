// The quote document, shared by Crew and the Admin: ONE file. crm/quote-doc.js is the source and admin/quote-doc.js is an identical copy (scripts/sync_shared.sh).
// A numbered quote (Q-<booking ID or lead ref>-<revision>) with itemised lines, GST worked out the way invoices do it (admin/invoice.js: whole paise, GST on the taxable value, CGST and SGST halves),
// a validity date, one line of terms and a status. The same lines become the invoice once the customer approves (lead.quote_lines, admin/invoice-auto.js), so nothing here changes how invoices are made.
// Pure functions first (no DOM, no Supabase), then createQuoteDoc for the printable page and the copy-link button.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paise = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
const rupees = (p) => p / 100;
const KIND = { parts: 'Parts', labour: 'Labour', service: 'Service', other: 'Other' };
/** Genuine Parts Promise: a part line says Genuine or Equivalent. */
export const PART_TYPE = { genuine: 'Genuine', equivalent: 'Equivalent' };
const kindLabel = (l) => KIND[l.kind] + (l.kind === 'parts' && PART_TYPE[l.part_type] ? ', ' + PART_TYPE[l.part_type] : '');
export const QUOTE_STATUS = { draft: ['Draft', ''], sent: ['Sent', 'info'], approved: ['Approved', 'good'], declined: ['Declined', 'bad'], expired: ['Expired', 'warn'], changes_requested: ['Changes requested', 'warn'], superseded: ['Replaced by a newer quote', ''] };
export const DEFAULT_TERMS = 'Valid for 3 days. Work starts only after you approve. GST is included in the total.';

/** Q-<booking ID, else the lead's unique ref>-<revision>. Odd input never throws. */
export function quoteNumber(idOrRef, version) {
  const base = String(idOrRef ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'DRAFT', v = Math.max(1, Math.round(Number(version)) || 1);
  return 'Q-' + base + '-' + v;
}
/** Lines (service, parts, labour; amounts before GST) to totals. Same rounding as invoices: GST on the taxable value in whole paise, CGST half and SGST the rest. */
export function quoteMaths(lines, { rate = 18, feeCredit = 0 } = {}) {
  const ok = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === 'object' && String(l.name ?? '').trim());
  const sub = ok.reduce((s, l) => s + Math.max(0, paise(l.amount)), 0), r = [0, 5, 12, 18].includes(Number(rate)) ? Number(rate) : 18;
  const gst = Math.round(sub * r / 100), cgst = Math.round(gst / 2), sgst = gst - cgst, total = sub + gst, credit = Math.min(total, Math.max(0, paise(feeCredit)));
  return { lines: ok.map((l) => ({ kind: KIND[l.kind] ? l.kind : 'other', name: String(l.name).trim().slice(0, 80), amount: rupees(Math.max(0, paise(l.amount))), ...(l.kind === 'parts' && PART_TYPE[l.part_type] ? { part_type: l.part_type } : {}) })), rate: r, subtotal: rupees(sub), gst: rupees(gst), cgst: rupees(cgst), sgst: rupees(sgst), total: rupees(total), feeCredit: rupees(credit), balance: rupees(total - credit) };
}
/** Status as the desk and customer read it: a sent quote past its date is Expired. `q` is a crm_quote_get row (status, expired, valid_until). */
export function quoteStatus(q, now = Date.now()) {
  const s = q && typeof q === 'object' ? String(q.status || 'draft') : 'draft', vu = q && q.valid_until ? new Date(q.valid_until).getTime() : null;
  const key = s === 'sent' && (q.expired === true || (vu != null && Number.isFinite(vu) && vu < now)) ? 'expired' : QUOTE_STATUS[s] ? s : 'draft';
  return { key, label: QUOTE_STATUS[key][0], tone: QUOTE_STATUS[key][1] };
}
/** "Valid until 10 Nov 2026" or "Expired on 10 Nov 2026"; empty when there is no date. */
export function validityLabel(q, now = Date.now()) {
  const vu = q && q.valid_until ? new Date(q.valid_until) : null; if (!vu || !Number.isFinite(vu.getTime())) return '';
  const d = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(vu);
  return (quoteStatus(q, now).key === 'expired' ? 'Expired on ' : 'Valid until ') + d;
}
/** The page the desk prints (same paper and print rules as the invoice: #inv > .inv-paper). `co` is the company block the invoice uses. */
export function quoteDocHtml(q, { co = {}, ref = '', bookingId = '', now = Date.now() } = {}) {
  const z = q && typeof q === 'object' ? q : {}, st = quoteStatus(z, now), m = quoteMaths(z.lines, { rate: z.gst_rate || 18, feeCredit: z.fee_credit });
  const num = z.quote_no || quoteNumber(bookingId || ref, z.version), addr = [...(co.addressLines || []), [co.city, co.state, co.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const date = z.sent_at ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(z.sent_at)) : 'Draft';
  const rows = m.lines.length ? m.lines.map((l) => `<tr class="inv-line"><td>${esc(l.name)} <small class="muted">${esc(kindLabel(l))}</small></td><td class="num">${inr(l.amount)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">No items yet.</td></tr>';
  return `<div class="inv-paper in qd">
    <div class="inv-head"><div><b class="inv-co">${esc(co.brand || 'Mechanix Pro')}</b>${co.legalName ? `<span class="inv-sub">${esc(co.legalName)}</span>` : ''}${addr ? `<span class="inv-addr tiny">${addr}</span>` : ''}${co.gstin ? `<span class="tiny" style="display:block">GSTIN ${esc(co.gstin)}</span>` : ''}</div>
      <div class="inv-meta"><h2>QUOTE</h2><span>${esc(num)}</span><span>${esc(date)}</span><span class="tiny"><b class="qd-status qd-${esc(st.key)}">${esc(st.label)}</b>${validityLabel(z, now) ? ' · ' + esc(validityLabel(z, now)) : ''}</span></div></div>
    <p class="inv-to"><span>For booking</span><b>${esc(bookingId || ref || 'Not confirmed yet')}</b></p>
    <table class="inv-table"><thead><tr><th>Item</th><th class="num">Amount (before GST)</th></tr></thead><tbody>${rows}</tbody></table>
    <dl class="inv-tot"><dt>Subtotal</dt><dd>${inr(m.subtotal)}</dd><dt>CGST @ ${m.rate / 2}%</dt><dd>${inr(m.cgst)}</dd><dt>SGST @ ${m.rate / 2}%</dt><dd>${inr(m.sgst)}</dd><dt class="grand">Total</dt><dd class="grand">${inr(m.total)}</dd>${m.feeCredit ? `<dt>Confirmation fee already paid</dt><dd>− ${inr(m.feeCredit)}</dd>` : ''}<dt class="grand">Balance to pay</dt><dd class="grand">${inr(m.balance)}</dd></dl>
    ${z.eta_text ? `<p class="small" style="margin-top:14px"><b>Estimated delivery:</b> ${esc(z.eta_text)}</p>` : ''}${z.status === 'changes_requested' && z.change_request ? `<p class="small"><b>Customer asked for changes:</b> ${esc(z.change_request)}</p>` : ''}
    <p class="inv-foot">${esc(z.terms || DEFAULT_TERMS)}</p></div>`;
}

/** The printable page and the copy-link button. deps: rpc, toast, loadCompany, siteUrl. Opens in the same #inv layer the invoice uses, so the invoice print rules apply. */
export function createQuoteDoc(deps = {}) {
  const site = () => String(deps.siteUrl || 'https://mechanixpro.in').replace(/\/$/, '');
  async function copyLink(leadId) {
    try {
      const tok = await deps.rpc('crm_quote_link', { p_lead: leadId });
      if (!tok || !/^[0-9a-f]{32}$/.test(tok)) { deps.toast('No customer link yet. It is made when the booking is paid.', true); return; }
      const url = site() + '/track/?t=' + tok;
      try { await navigator.clipboard.writeText(url); deps.toast('Customer link copied. It opens the quote with Approve, Decline and Ask for changes.'); } catch (e) { deps.toast('Copy failed: ' + url, true); }
    } catch (e) { deps.toast('Could not get the link: ' + String((e && e.message) || e), true); }
  }
  async function open(leadId) {
    try {
      const q = await deps.rpc('crm_quote_get', { p_lead: leadId }), co = deps.loadCompany ? await deps.loadCompany() : {};
      if (!q || !q.latest) { deps.toast('There is no quote on this booking yet.', true); return; }
      const doc = globalThis.document; doc.getElementById('inv')?.remove();
      const el = doc.createElement('div'); el.id = 'inv'; el.className = 'inv-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Quote ' + (q.latest.quote_no || ''));
      el.innerHTML = quoteDocHtml(q.latest, { co, ref: q.ref, bookingId: q.booking_id }).replace(/<\/div>$/, `<div class="inv-actions"><button class="btn btn-primary btn-sm" type="button" data-act="quotePrint">Print or save as PDF</button><button class="btn btn-ghost btn-sm" type="button" data-act="quoteCopy">Copy customer link</button><button class="btn btn-ghost btn-sm" type="button" data-act="invClose">Close</button></div></div>`);
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (!b) return; const a = b.getAttribute('data-act'); if (a === 'quotePrint') globalThis.print(); else if (a === 'quoteCopy') copyLink(leadId); else if (a === 'invClose') el.remove(); });
      doc.body.appendChild(el); el.querySelector('[data-act="quotePrint"]').focus();
    } catch (e) { deps.toast('Could not open the quote: ' + String((e && e.message) || e), true); }
  }
  return { open, copyLink };
}
