import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvoice } from '../admin/invoice.js';
import { missingInvoiceCandidates, planCandidates, bannerHtml, reviewHtml, createMissing, summaryText, autoInvoice, invoiceProblem, firstName } from '../admin/invoice-auto.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toFixed(2);

const services = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];
const bike = { reg_no: 'KA01AB1234', brand: 'Honda', model: 'Activa' };
const L = (id, o = {}) => ({ id, booking_id: 'MP-26-' + id, name: 'Demo Customer', phone: '9000000001', status: 'completed', service_id: 'general', addons: [], created_at: '2026-11-01T05:00:00Z', completed_at: '2026-11-02T05:00:00Z', ...o });
const build = (l) => buildInvoice(l, services, { bike });

test('candidates: completed only, voided invoices ignored, junk and deleted ignored', () => {
  const leads = [L('a'), L('b'), L('c'), L('d', { status: 'scheduled' }), L('e', { status: 'junk' }), L('f', { deleted_at: '2026-11-03' }), L('g', { is_junk: true }), L('h', { status: 'lost' })];
  const invoices = [{ lead_id: 'b', voided_at: null }, { lead_id: 'c', voided_at: '2026-11-03' }];
  assert.deepEqual(missingInvoiceCandidates(leads, invoices).map((l) => l.id), ['a', 'c']);
  assert.deepEqual(missingInvoiceCandidates([], []), []); assert.deepEqual(missingInvoiceCandidates(null, null), []);
});
test('candidates: oldest completion first; any live revision counts', () => {
  const leads = [L('a', { completed_at: '2026-11-05' }), L('b', { completed_at: '2026-11-01' })];
  assert.deepEqual(missingInvoiceCandidates(leads, []).map((l) => l.id), ['b', 'a']);
  assert.deepEqual(missingInvoiceCandidates(leads, [{ lead_id: 'a', voided_at: '2026-11-06', revision: 1 }, { lead_id: 'a', voided_at: null, revision: 2 }]).map((l) => l.id), ['b']);
});
test('reasons: unpaid confirmation fee, no priced items, missing details, and a ready booking', () => {
  const plans = planCandidates([L('a'), L('u', { confirm_fee: 49, confirm_paid_at: null }), L('n', { service_id: null }), L('p', { confirm_fee: 49, confirm_paid_at: '2026-11-01' })], build);
  const by = Object.fromEntries(plans.map((p) => [p.id, p]));
  assert.equal(by.a.reason, ''); assert.match(by.u.reason, /confirmation fee is unpaid/); assert.match(by.n.reason, /No priced items/); assert.equal(by.p.reason, '');
  const noPhone = planCandidates([L('x', { phone: '123' })], build)[0]; assert.match(noPhone.reason, /Missing mobile number/);
  const noVeh = planCandidates([L('y')], (l) => buildInvoice(l, services, { bike: {} }))[0]; assert.match(noVeh.reason, /vehicle number/);
  assert.match(planCandidates([L('z')], () => { throw new Error('boom'); })[0].reason, /boom/);
  assert.equal(invoiceProblem(L('a'), build(L('a'))), '');
});
test('totals use the invoice maths and round to the paisa', () => {
  const odd = [{ id: 'odd', kind: 'service', name: 'Odd', price: 333.33 }];
  const l = L('t', { service_id: 'odd', created_at: '2026-11-01T05:00:00Z' });
  const plan = planCandidates([l], (x) => buildInvoice(x, odd, { bike }))[0];
  assert.equal(plan.total, buildInvoice(l, odd, { bike }).total); assert.equal(plan.total, 393.33); // 333.33 + 18% (60) = 393.33
  assert.equal(planCandidates([L('a')], build)[0].total, 1532.82); // 1299 + 233.82
});
test('first name only, and the dialog markup escapes everything', () => {
  assert.equal(firstName('Asha Rao'), 'Asha'); assert.equal(firstName(''), 'Customer'); assert.equal(firstName('<b>x</b> y'), 'bx/b');
  const plans = planCandidates([L('a', { name: 'Demo <img> Person' }), L('u', { confirm_fee: 49, confirm_paid_at: null })], build);
  const html = reviewHtml(plans, { esc, inr });
  assert.match(html, /Create missing invoices/); assert.match(html, /data-act="invMissingGo"/); assert.match(html, /Create 1 invoice\b/);
  assert.match(html, /1 ready, 1 cannot be created yet/); assert.doesNotMatch(html, /<img>/); assert.doesNotMatch(html, /Person/);
  assert.match(html, /KA01AB1234 · Honda Activa/); assert.match(html, /₹1532\.82/); assert.match(html, /confirmation fee is unpaid/);
  assert.match(html, /Nothing is printed or emailed/); assert.match(html, /id="imiss-progress"/);
  assert.match(reviewHtml(planCandidates([L('u', { confirm_fee: 49, confirm_paid_at: null })], build), { esc, inr }), /invMissingGo"\s+disabled|invMissingGo" disabled/);
});
test('banner shows the count, singular and plural, and nothing at zero', () => {
  assert.equal(bannerHtml(0), '');
  assert.match(bannerHtml(5), /5 completed bookings have no invoice\./); assert.match(bannerHtml(1), /1 completed booking has no invoice\./);
  assert.match(bannerHtml(5), /data-act="invMissingOpen"[^>]*>Create missing invoices/);
});
const mkStore = () => {
  const live = new Set(), saves = [];
  return { live, saves, hasLive: (id) => live.has(id), save: async (l) => { saves.push(l.id); live.add(l.id); return { row: { number: l.booking_id }, reason: '' }; } };
};
test('bulk create is sequential, reports progress, and is idempotent when run twice', async () => {
  const st = mkStore(), seen = [];
  const plans = planCandidates([L('a'), L('b'), L('u', { confirm_fee: 49, confirm_paid_at: null })], build);
  const r1 = await createMissing(plans, { ...st, progress: (t) => seen.push(t) });
  assert.deepEqual(r1.created.map((c) => c.id), ['a', 'b']); assert.equal(r1.skipped.length, 1); assert.equal(r1.failed.length, 0);
  assert.deepEqual(seen, ['Creating 1 of 3…', 'Creating 2 of 3…', 'Creating 3 of 3…']);
  const r2 = await createMissing(plans, st);
  assert.equal(r2.created.length, 0); assert.equal(st.saves.length, 2);
  assert.ok(r2.skipped.some((s) => s.reason === 'Already has an invoice'));
  assert.match(summaryText(r1), /^2 created, 1 skipped\.$/);
});
test('a failing save is reported with the server message and does not stop the others', async () => {
  let n = 0;
  const deps = { hasLive: () => false, save: async (l) => { n++; if (l.id === 'a') return { row: null, reason: 'new row violates row-level security policy' }; if (l.id === 'b') throw new Error('network down'); return { row: { number: 'N' }, reason: '' }; } };
  const r = await createMissing(planCandidates([L('a'), L('b'), L('c')], build), deps);
  assert.equal(n, 3); assert.equal(r.created.length, 1); assert.equal(r.failed.length, 2);
  const t = summaryText(r); assert.match(t, /1 created, 2 failed\./); assert.match(t, /That did not work: .*row-level security.*network down/);
});
test('autoInvoice saves through the same path exactly once and says so', async () => {
  const st = mkStore(), toasts = [];
  const r = await autoInvoice(L('a', { booking_id: 'MP-26-0001' }), { ...st, toast: (m) => toasts.push(m) });
  assert.equal(r.status, 'created'); assert.deepEqual(st.saves, ['a']); assert.deepEqual(toasts, ['Invoice MP-26-0001 saved']);
  const again = await autoInvoice(L('a'), { ...st, toast: (m) => toasts.push(m) });
  assert.equal(again.status, 'exists'); assert.equal(st.saves.length, 1); assert.equal(toasts.length, 1);
});
test('autoInvoice failure shows the warning and never throws, so completion is not blocked', async () => {
  const toasts = [];
  const r = await autoInvoice(L('a'), { hasLive: () => false, save: async () => ({ row: null, reason: 'No priced items: add the items on the invoice first' }), toast: (m) => toasts.push(m) });
  assert.equal(r.status, 'failed');
  assert.equal(toasts[0], 'Booking completed, but the invoice could not be created: No priced items: add the items on the invoice first. Use Create missing invoices.');
  const t2 = [];
  const r2 = await autoInvoice(L('a'), { hasLive: () => false, save: async () => { throw new Error('offline'); }, toast: (m) => t2.push(m) });
  assert.equal(r2.status, 'failed'); assert.match(t2[0], /offline\. Use Create missing invoices\./);
  assert.equal((await autoInvoice(null, { hasLive: () => false, save: async () => ({}), toast() {} })).status, 'skipped');
});
test('admin.js wires the banner, the dialog, the save path and the completion hooks; Crew stays hands-off', () => {
  const a = read('admin/admin.js'), c = read('crm/crm.js');
  assert.match(a, /bannerHtml\(missingList\(\)\.length\)/);
  assert.match(a, /async invMissingOpen\(/); assert.match(a, /async invMissingGo\(/); assert.match(a, /invMissingClose\(\)/);
  assert.match(a, /saveInvoiceCopyEx\(l, 'rebuilt', \{ quiet: true \}\)/);
  assert.match(a, /async function saveInvoiceCopy\(lead, via\) \{ return \(await saveInvoiceCopyEx\(lead, via\)\)\.row; \}/);
  // every Admin path that writes status completed calls the hook after a successful save
  assert.equal((a.match(/autoInvoiceFor\(l\.id\)/g) || []).length, 3);
  assert.match(a, /if \(n\.to === 'completed'\) \{ await autoInvoiceFor/); assert.match(a, /upd\.status === 'completed'\) await autoInvoiceFor/);
  assert.match(a, /Crew cannot write invoices/);
  assert.doesNotMatch(c, /autoInvoice|saveInvoiceCopy|invoice_no_for/); assert.match(c, /Crew cannot write invoices/);
  // an unreadable invoice table must not list every booking as missing
  assert.match(a, /\(S\.failed \|\| \[\]\)\.includes\('invoices'\) \? \[\]/);
});
