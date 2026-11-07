// The quote document (crm/quote-doc.js, identical copy admin/quote-doc.js), the customer view and the database rules for the three answers. Old quotes and invoices must still work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quoteNumber, quoteMaths, quoteStatus, validityLabel, quoteDocHtml, createQuoteDoc, QUOTE_STATUS } from '../admin/quote-doc.js';
import { buildInvoice } from '../admin/invoice.js';
import { missingInvoiceCandidates } from '../admin/invoice-auto.js';
const read = (f) => fs.readFileSync(f, 'utf8');

test('the admin copy is identical to the Crew source', () => { assert.equal(read('admin/quote-doc.js'), read('crm/quote-doc.js')); assert.equal(read('admin/flow-core.js'), read('crm/flow-core.js')); });

test('quote numbers: booking ID, else the lead ref, plus the revision', () => {
  assert.equal(quoteNumber('MP-26-27-0099', 2), 'Q-MP-26-27-0099-2'); assert.equal(quoteNumber('L-ABC123', 1), 'Q-L-ABC123-1');
  assert.equal(quoteNumber(null, 0), 'Q-DRAFT-1'); assert.equal(quoteNumber('<b>x</b>', 'zz'), 'Q-bxb-1');
  assert.doesNotMatch(quoteNumber('<script>', 1), /[<>]/);
});

test('GST maths equals the invoice maths for the same lines (so an approved quote becomes the same invoice)', () => {
  for (const lines of [[{ kind: 'parts', name: 'Pad', amount: 500 }, { kind: 'labour', name: 'Fit', amount: 199.5 }], [{ kind: 'other', name: 'X', amount: 0.01 }], [{ kind: 'parts', name: 'A', amount: 333.33 }, { kind: 'parts', name: 'B', amount: 666.67 }, { kind: 'labour', name: 'C', amount: 1 }]]) {
    const m = quoteMaths(lines), inv = buildInvoice({ quote_lines: lines, quote_rate: 18, created_at: '2026-11-05T10:00:00Z', booking_id: 'MP-1', name: 'Test Customer' }, []);
    assert.equal(m.subtotal, inv.subtotal); assert.equal(m.cgst, inv.cgst); assert.equal(m.sgst, inv.sgst); assert.equal(m.total, inv.total);
  }
  const m = quoteMaths([{ kind: 'parts', name: 'Pad', amount: 500 }], { feeCredit: 49 }); assert.deepEqual([m.subtotal, m.gst, m.total, m.feeCredit, m.balance], [500, 90, 590, 49, 541]);
  assert.equal(quoteMaths([{ name: 'A', amount: 10 }], { feeCredit: 9999 }).balance, 0, 'credit never exceeds the total');
});
test('maths fuzz: null, negative, text and missing values never throw or give NaN', () => {
  for (const l of [null, undefined, 'x', [], [null, 1, 'a', {}], [{ name: 'A', amount: 'abc' }], [{ name: '  ', amount: 5 }], [{ name: 'A', amount: -50 }], [{ name: 'A', amount: null, kind: 'weird' }]]) {
    const m = quoteMaths(l, { rate: 'x', feeCredit: 'y' }); assert.ok([m.subtotal, m.gst, m.total, m.balance].every(Number.isFinite)); assert.equal(m.rate, 18);
  }
});

const NOW = Date.parse('2026-11-07T12:00:00Z');
test('status: sent past its date is Expired; the six statuses read as the owner named them', () => {
  assert.equal(quoteStatus({ status: 'sent', valid_until: '2026-11-06T00:00:00Z' }, NOW).label, 'Expired');
  assert.equal(quoteStatus({ status: 'sent', valid_until: '2026-11-09T00:00:00Z' }, NOW).label, 'Sent');
  assert.equal(quoteStatus({ status: 'sent', expired: true }, NOW).key, 'expired');
  assert.equal(quoteStatus({ status: 'approved', valid_until: '2020-01-01' }, NOW).label, 'Approved', 'an approved quote never turns Expired');
  assert.deepEqual(['draft', 'sent', 'approved', 'declined', 'expired', 'changes_requested'].map((k) => QUOTE_STATUS[k][0]), ['Draft', 'Sent', 'Approved', 'Declined', 'Expired', 'Changes requested']);
  assert.equal(quoteStatus(null).label, 'Draft'); assert.equal(quoteStatus({ status: 'zzz' }).key, 'draft'); assert.equal(quoteStatus({ status: 'sent', valid_until: 'junk' }, NOW).key, 'sent');
  assert.match(validityLabel({ status: 'sent', valid_until: '2026-11-10T00:00:00Z' }, NOW), /^Valid until 10 Nov 2026$/); assert.match(validityLabel({ status: 'sent', valid_until: '2026-11-01T00:00:00Z' }, NOW), /^Expired on 1 Nov 2026$/); assert.equal(validityLabel({}), '');
});

test('printable page: number, lines, CGST and SGST, validity, terms, escaped text; old quote with no number still renders', () => {
  const q = { version: 2, status: 'sent', quote_no: 'Q-MP-26-27-0099-2', valid_until: '2026-11-10T00:00:00Z', sent_at: '2026-11-07T05:00:00Z', lines: [{ kind: 'parts', name: 'Pad <img onerror=x>', amount: 500 }, { kind: 'labour', name: 'Fit', amount: 200 }], fee_credit: 49, eta_text: 'in 4 hours', terms: 'Valid for 3 days.' };
  const h = quoteDocHtml(q, { co: { brand: 'Mechanix Pro', gstin: 'GSTIN-PLACEHOLDER' }, ref: 'L-X', bookingId: 'MP-26-27-0099', now: NOW });
  assert.match(h, /QUOTE/); assert.match(h, /Q-MP-26-27-0099-2/); assert.match(h, /CGST @ 9%/); assert.match(h, /SGST @ 9%/); assert.match(h, /Valid until 10 Nov 2026/); assert.match(h, /Balance to pay/); assert.match(h, /₹/); assert.match(h, /Valid for 3 days\./);
  assert.doesNotMatch(h, /<img onerror/); assert.match(h, /Pad &lt;img/); assert.match(h, /class="inv-paper in qd"/);
  const old = quoteDocHtml({ version: 1, status: 'approved', lines: [{ kind: 'labour', name: 'Old quote line', amount: 100 }], total: 118 }, { ref: 'L-OLD', now: NOW });
  assert.match(old, /Q-L-OLD-1/); assert.match(old, /Approved/); assert.match(old, /Old quote line/); assert.match(old, /Valid for 3 days/);
  for (const bad of [null, undefined, {}, { lines: 'x' }, { lines: [null] }]) assert.doesNotThrow(() => quoteDocHtml(bad));
});

test('copy link: asks the database for the token, refuses a missing or odd token, never throws', async () => {
  const msgs = []; let tok = 'a'.repeat(32); globalThis.navigator ??= {}; let copied = null; Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied = t; } } }, configurable: true });
  const d = createQuoteDoc({ rpc: async (n) => { if (n !== 'crm_quote_link') throw new Error('unexpected'); return tok; }, toast: (m, bad) => msgs.push([m, !!bad]) });
  await d.copyLink('l1'); assert.equal(copied, 'https://mechanixpro.in/track/?t=' + 'a'.repeat(32)); assert.equal(msgs.at(-1)[1], false);
  tok = null; await d.copyLink('l1'); assert.equal(msgs.at(-1)[1], true); tok = '../etc'; await d.copyLink('l1'); assert.equal(msgs.at(-1)[1], true);
  await createQuoteDoc({ rpc: async () => { throw new Error('boom'); }, toast: (m, bad) => msgs.push([m, !!bad]) }).copyLink('l1'); assert.match(msgs.at(-1)[0], /boom/);
});

test('customer view and functions carry the three answers; Expired and Changes requested show; no work without approval is untouched', () => {
  const js = read('assets/js/track.js');
  assert.match(js, /data-q="approve"/); assert.match(js, /data-q="decline"/); assert.match(js, /data-q="changes"/); assert.match(js, /Ask for changes/); assert.match(js, /z\.expired/); assert.match(js, /valid until/); assert.match(js, /z\.quote_no/);
  assert.match(js, /Tell us what you would like changed/, 'a changes request needs a message');
  const f = read('supabase/functions/quote-decision/index.ts'); assert.match(f, /\['approve', 'decline', 'changes'\]/); assert.match(f, /rpc\('quote_decide'/); assert.match(f, /if \(!data\.already\)/);
  const tb = read('supabase/functions/track-booking/index.ts'); assert.match(tb, /changes_requested/); assert.match(tb, /valid_until/); assert.match(tb, /expired:/);
  const sql = read('supabase/migrations/20270104000000_funnel_quote.sql');
  assert.match(sql, /expired', true/); assert.match(sql, /'Tell us what you would like changed\.'/); assert.match(sql, /grant execute on function public\.quote_decide\(text, int, text, text\) to service_role/); assert.doesNotMatch(sql, /grant execute on function public\.quote_decide[^;]*authenticated/);
  assert.match(read('supabase/migrations/20261228000000_paid_confirmation.sql'), /leads_quote_gate/, 'the approval gate migration is still there');
  assert.doesNotMatch(sql, /leads_quote_gate/, 'this migration does not touch the approval gate');
});

test('regression: old quotes and invoices still render and old invoice-auto still finds completed bookings', () => {
  const inv = buildInvoice({ quote_lines: [{ name: 'Brake pad', amount: 400 }], quote_rate: 18, created_at: '2026-11-05T10:00:00Z', booking_id: 'MP-1', name: 'Test Customer', paid_amount: 49 }, []);
  assert.equal(inv.total, 472); assert.equal(inv.balance, 423);
  assert.deepEqual(missingInvoiceCandidates([{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }, { id: 'c', status: 'new' }], [{ lead_id: 'a' }]).map((x) => x.id), ['b']);
  const sendRpc = read('supabase/migrations/20270104000000_funnel_quote.sql');
  assert.match(sendRpc, /status = 'sent', sent_at = now\(\)/, 'sending still marks the draft sent and stamps the time');
});
