import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliver, deliverAll, dueKinds, olderThan, teamPaidMessage, teamNudgeMessage, CUSTOMER_KINDS } from '../supabase/functions/_shared/notify.ts';
import { paidConfirmation, feeReceipt, quoteMail, etaChanged, DOOR_CODE_LINE } from '../supabase/functions/_shared/email-templates.ts';
import { COMPANY } from '../supabase/functions/_shared/company.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/** A store that behaves like the notification_claim function in the migration (checked against the real SQL by paid-sql.test.mjs). */
function memStore() {
  const rows = new Map(), log = [];
  return { rows, log,
    async claim(lead, kind, force = false) { const k = lead + '|' + kind, r = rows.get(k);
      if (!r) { rows.set(k, { status: 'pending', attempts: 1 }); return true; }
      if (force || (r.status === 'failed' && r.attempts < 6)) { r.status = 'pending'; r.attempts = force ? 1 : r.attempts + 1; return true; }
      return false; },
    async finish(lead, kind, status, error) { rows.get(lead + '|' + kind).status = status; log.push([kind, status, error]); } };
}
const ok = async () => ({ ok: true });

test('a message is sent once: a retry or a duplicate webhook finds it already claimed', async () => {
  const s = memStore(); let sends = 0;
  const send = async () => { sends++; return { ok: true }; };
  assert.equal(await deliver(s, 'L1', 'confirm_email', send), 'sent');
  assert.equal(await deliver(s, 'L1', 'confirm_email', send), 'duplicate');
  assert.equal(await deliver(s, 'L1', 'confirm_email', send), 'duplicate');
  assert.equal(sends, 1);
  // two webhooks at the same moment: only one wins the claim
  const s2 = memStore(); let n = 0; const slow = async () => { n++; await new Promise((r) => setTimeout(r, 5)); return { ok: true }; };
  const res = await Promise.all([deliver(s2, 'L2', 'team_paid', slow), deliver(s2, 'L2', 'team_paid', slow), deliver(s2, 'L2', 'team_paid', slow)]);
  assert.deepEqual(res.sort(), ['duplicate', 'duplicate', 'sent']); assert.equal(n, 1);
});
test('a failed message can be retried, up to 6 tries; Resend forces any message again', async () => {
  const s = memStore(); let calls = 0; const flaky = async () => (++calls < 3 ? { ok: false, error: 'timeout' } : { ok: true });
  assert.equal(await deliver(s, 'L1', 'receipt_email', flaky), 'failed');
  assert.equal(await deliver(s, 'L1', 'receipt_email', flaky), 'failed');
  assert.equal(await deliver(s, 'L1', 'receipt_email', flaky), 'sent');
  assert.equal(await deliver(s, 'L1', 'receipt_email', flaky), 'duplicate');   // sent is final
  assert.equal(await deliver(s, 'L1', 'receipt_email', ok, true), 'sent');      // Crew's Resend
  const dead = memStore(); for (let i = 0; i < 8; i++) await deliver(dead, 'L9', 'confirm_email', async () => ({ ok: false, error: 'down' }));
  assert.equal(dead.rows.get('L9|confirm_email').attempts, 6);                   // it stops trying on its own
});
test('each channel is isolated: one throwing or failing never stops the others or the booking', async () => {
  const s = memStore();
  const out = await deliverAll(s, 'L1', { confirm_email: async () => { throw new Error('Resend is down'); }, receipt_email: async () => ({ ok: false, error: 'no email address', skipped: true }), confirm_whatsapp: ok, team_paid: ok });
  assert.deepEqual(out, { confirm_email: 'failed', receipt_email: 'skipped', confirm_whatsapp: 'sent', team_paid: 'sent' });
  assert.deepEqual(s.log.find((x) => x[0] === 'confirm_email'), ['confirm_email', 'failed', 'Resend is down']);   // the history line carries the reason
  // even a broken store cannot throw out of deliver
  const broken = { claim: async () => { throw new Error('db'); }, finish: async () => {} };
  assert.equal(await deliver(broken, 'L1', 'team_paid', ok), 'failed');
  const brokenFinish = { claim: async () => true, finish: async () => { throw new Error('log failed'); } };
  assert.equal(await deliver(brokenFinish, 'L1', 'team_paid', ok), 'sent');
});
test('a skipped message (no email, WhatsApp not connected) is logged, not retried by itself, and Crew can resend it', async () => {
  const s = memStore(); assert.equal(await deliver(s, 'L1', 'confirm_whatsapp', async () => ({ ok: false, skipped: true, error: 'AiSensy is not connected' })), 'skipped');
  assert.deepEqual(dueKinds([{ kind: 'confirm_whatsapp', status: 'skipped' }], ['confirm_whatsapp']), []);
  assert.equal(await deliver(s, 'L1', 'confirm_whatsapp', ok, true), 'sent');
});
test('the sweep retries only what is missing or failed', () => {
  assert.deepEqual(dueKinds([], CUSTOMER_KINDS), CUSTOMER_KINDS);
  assert.deepEqual(dueKinds([{ kind: 'confirm_email', status: 'sent' }, { kind: 'receipt_email', status: 'failed', attempts: 2 }, { kind: 'confirm_whatsapp', status: 'failed', attempts: 6 }]), ['receipt_email']);
  assert.equal(olderThan('2026-11-05T10:00:00Z', 30, Date.parse('2026-11-05T10:29:00Z')), false);
  assert.equal(olderThan('2026-11-05T10:00:00Z', 30, Date.parse('2026-11-05T10:30:00Z')), true);
  assert.equal(olderThan(null, 30), false);
});
test('the team alert has booking ID, vehicle, area and PIN, slot and amount, and no customer phone or street address', () => {
  const m = teamPaidMessage({ bookingId: 'MP-26-27-0001', vehicle: 'car', area: 'HSR Layout', pincode: '560102', whenText: 'Thu 6 Nov, Morning', amount: 99, deskUrl: 'https://crew.example.invalid/crm/' });
  for (const t of [m.text, m.html, m.subject]) assert.doesNotMatch(t, /\b[6-9]\d{9}\b|Flat|@/);
  for (const w of ['MP-26-27-0001', 'CAR', 'HSR Layout 560102', 'Thu 6 Nov, Morning', '₹99', '#dispatch']) assert.ok(m.text.includes(w), w);
  const u = teamNudgeMessage('team_unassigned', { bookingId: 'MP-1', vehicle: 'bike', area: 'HSR', minutes: 15, deskUrl: 'https://x.invalid/' }); assert.match(u.text, /paid 15\+ minutes ago, no mechanic assigned/);
  assert.match(teamNudgeMessage('team_link_unpaid', { vehicle: 'bike', minutes: 30, deskUrl: 'https://x.invalid/' }).text, /payment link sent 30\+ minutes ago, still unpaid/);
});
test('team contacts come from settings and the team list, never from code', () => {
  const ap = read('supabase/functions/_shared/after-payment.ts');
  assert.match(ap, /getSetting<string\[\]>\(db, 'lead_alert_emails'/); assert.match(ap, /teamEmails\(db\)/);
  assert.doesNotMatch(ap, /\b[6-9]\d{9}\b/); assert.doesNotMatch(ap.replace(/booking@mechanixpro\.in|no-reply@mechanixpro\.in|hello@mechanixpro\.in/g, ''), /[\w.]+@[\w.]+\.(in|com)/);
});
const site = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 00000 00000', phoneTel: '+910000000000', whatsappUrl: 'https://wa.me/910000000000', email: 'hello@mechanixpro.in' };
test('the confirmation email carries the booking ID, vehicle, address, slot, amount, GST split, tracking link and the code, with the safety line', () => {
  const m = paidConfirmation({ ...site, name: 'Test Customer', ref: 'MP-26-27-0001', vehicle: 'bike', vehicleName: 'Bajaj Pulsar 220F', service: 'Standard service', address: 'Flat 4B, 27th Main, HSR Layout, 560102', whenText: 'Thu 6 Nov, Morning (9 AM to 12 PM)', amount: 69, gstBase: 58.47, gst: 10.53, trackUrl: 'https://mechanixpro.in/track/?t=' + 'a'.repeat(32), code: '4821' });
  for (const w of ['MP-26-27-0001', 'Bajaj Pulsar 220F', 'Flat 4B, 27th Main, HSR Layout, 560102', 'Thu 6 Nov, Morning', '₹69', '58.47', '10.53', 'your final bill', '/track/?t=' + 'a'.repeat(32), '4821']) { assert.ok(m.html.includes(w), 'html ' + w); assert.ok(m.text.includes(w), 'text ' + w); }
  assert.equal(DOOR_CODE_LINE, 'Give this code to the mechanic when they arrive. Do not share it before.'); assert.ok(m.html.includes(DOOR_CODE_LINE)); assert.ok(m.text.includes(DOOR_CODE_LINE));
  assert.match(m.subject, /Your slot is confirmed MP-26-27-0001/); assert.doesNotMatch(m.html, /\b[6-9]\d{9}\b/);
  assert.ok(!paidConfirmation({ ...site, name: 'T', vehicle: 'car', vehicleName: 'Car', service: 's', address: 'a', whenText: 'w', amount: 99, gstBase: 83.9, gst: 15.1, trackUrl: 'https://x/' }).text.includes('Your code:'));   // no code, no code line
});
test('the customer name and address are escaped in the HTML', () => {
  const m = paidConfirmation({ ...site, name: '<script>x</script>', vehicle: 'bike', vehicleName: 'B', service: 's', address: '"><img src=x>', whenText: 'w', amount: 49, gstBase: 41.53, gst: 7.47, trackUrl: 'https://x/', code: '1234' });
  assert.doesNotMatch(m.html, /<script>x|<img src=x>/);
});
test('the fee receipt shows GST separately, the receipt number from the invoice numbering, the company GSTIN and that it is adjusted', () => {
  const m = feeReceipt({ ...site, name: 'Test Customer', ref: 'MP-26-27-0001', number: 'MP-26-27-0001', dateLabel: '5 Nov 2026', amount: 49, gstBase: 41.53, gst: 7.47, vehicleName: 'Honda Activa', service: 'Basic service', company: COMPANY });
  for (const w of ['₹41.53', 'CGST @ 9%', 'SGST @ 9%', '₹49.00', 'adjusted in your final bill', COMPANY.gstin, 'MP-26-27-0001', 'receipt for an advance']) assert.ok(m.html.toLowerCase().includes(w.toLowerCase()) || m.text.toLowerCase().includes(w.toLowerCase()), w);
  const cg = 3.74, sg = 3.73; assert.ok(m.html.includes('₹' + cg) || m.html.includes('3.74')); assert.ok(m.html.includes(String(sg)));
  const ap = read('supabase/functions/_shared/after-payment.ts'); assert.match(ap, /rpc\('invoice_no_alloc'/); assert.match(ap, /feeReceipt\(/);
});
test('the quote email lists parts, labour and other with GST apart, the fee already paid, the balance and the delivery estimate', () => {
  const m = quoteMail({ ...site, name: 'Test Customer', ref: 'MP-26-27-0001', version: 2, revised: true, lines: [{ kind: 'parts', name: 'Brake pad set', amount: 400 }, { kind: 'labour', name: 'Fitting', amount: 150 }], subtotal: 550, gst: 99, total: 649, feeCredit: 69, balance: 580, etaText: 'about 3 hours after the work starts', trackUrl: 'https://mechanixpro.in/track/?t=' + 'b'.repeat(32) });
  for (const w of ['Brake pad set', 'Parts', 'Labour', 'GST @ 18%', '₹99.00', 'Confirmation fee already paid', '₹580.00', 'about 3 hours after the work starts', 'Revised quote', 'Nothing starts until you approve']) assert.ok(m.html.includes(w), w);
  assert.match(etaChanged({ ...site, name: 'T', etaText: 'Fri, 7 Nov, afternoon', trackUrl: 'https://x/' }).text, /Fri, 7 Nov, afternoon/);
});
test('WhatsApp reuses the existing templates with their existing number of variables, and never creates a new one', () => {
  const ap = read('supabase/functions/_shared/after-payment.ts'), dt = read('supabase/functions/_shared/desk-templates.ts');
  assert.match(ap, /x\.name === 'mxp_booking_confirmed'/); assert.match(ap, /x\.name === 'mxp_quote_ready_v2'/);
  assert.match(ap, /params: \[String\(c\.lead\.name\)\.split\(' '\)\[0\], idParam\(c\.lead\), c\.whenText, c\.mechanicFirst \?\? 'from our team', c\.lead\.area \|\| 'your address'\]/);   // 5 variables: name, booking, when, mechanic, area
  assert.match(dt, /mxp_booking_confirmed[\s\S]{0,400}params: 5/); assert.match(dt, /mxp_quote_ready_v2[\s\S]{0,900}params: 3/);
  assert.doesNotMatch(dt, /mxp_paid_|mxp_confirm_fee|mxp_visit_/);   // no new template for Meta to approve
  const vp = read('supabase/functions/verify-payment/index.ts'); assert.match(vp, /TPL\.paid\(\), params: \[String\(amount\), bid \?\? 'request'\]/);   // the existing paid message keeps its 2 variables
});
