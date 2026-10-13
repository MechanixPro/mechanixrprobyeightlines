import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRate, jobSplit, cleanCommission, payoutShareText, statementShareText } from '../admin/commission.js';

const settings = { doorstep_pct: 30, garage_pct: 25 };

test('doorstep jobs use the mechanic rate, falling back to the 30% default', () => {
  assert.deepEqual(effectiveRate({ lead: {}, mechanic: { payout_rate: 40 }, settings }), { place: 'doorstep', pct: 40, source: 'mechanic' });
  assert.deepEqual(effectiveRate({ lead: {}, mechanic: { payout_rate: 0 }, settings }), { place: 'doorstep', pct: 30, source: 'default' });
  assert.deepEqual(effectiveRate({ lead: {}, mechanic: null, settings: {} }), { place: 'doorstep', pct: 30, source: 'default' });
});
test('garage jobs use the garage default unless the job sets its own percentage', () => {
  assert.deepEqual(effectiveRate({ lead: { job_place: 'garage' }, mechanic: { payout_rate: 40 }, settings }), { place: 'garage', pct: 25, source: 'garage default' });
  assert.deepEqual(effectiveRate({ lead: { job_place: 'garage' }, mechanic: null, settings: {} }), { place: 'garage', pct: 30, source: 'garage default' });
});
test('a percentage set on the job wins over everything, including 0', () => {
  assert.deepEqual(effectiveRate({ lead: { commission_pct: 50 }, mechanic: { payout_rate: 40 }, settings }), { place: 'doorstep', pct: 50, source: 'job' });
  assert.equal(effectiveRate({ lead: { commission_pct: 0 }, mechanic: { payout_rate: 40 }, settings }).pct, 0);
  assert.equal(effectiveRate({ lead: { commission_pct: 140 }, mechanic: { payout_rate: 40 }, settings }).pct, 100);
});

test('job split works on the service amount before GST and applies the manual adjustment', () => {
  const a = jobSplit({ service: 1000, gst: 180, pct: 30, adjust: 0 });
  assert.deepEqual([a.byPct, a.earnings, a.company, a.gst], [300, 300, 700, 180]);
  const b = jobSplit({ service: 1000, gst: 0, pct: 30, adjust: 50 });
  assert.deepEqual([b.earnings, b.company], [350, 650]);
  const c = jobSplit({ service: 1000, gst: 0, pct: 30, adjust: -100 });
  assert.deepEqual([c.earnings, c.company], [200, 800]);
  const d = jobSplit({ service: 500, gst: 0, pct: 30, adjust: -900 });
  assert.deepEqual([d.earnings, d.company], [0, 500]);
  const e = jobSplit({ service: 500, gst: 0, pct: 30, adjust: 900 });
  assert.deepEqual([e.earnings, e.company], [500, 0]);
});

test('commission edits: percentage is optional, an adjustment needs a reason', () => {
  assert.deepEqual(cleanCommission({ place: 'garage', pct: '', adjust: '', reason: '' }), { ok: true, value: { job_place: 'garage', commission_pct: null, commission_adjust: 0, commission_note: null } });
  assert.deepEqual(cleanCommission({ place: 'doorstep', pct: '35', adjust: '-120.5', reason: 'Parts returned' }).value, { job_place: 'doorstep', commission_pct: 35, commission_adjust: -120.5, commission_note: 'Parts returned' });
  assert.equal(cleanCommission({ place: 'doorstep', pct: '', adjust: '100', reason: '' }).ok, false);
  assert.equal(cleanCommission({ place: 'doorstep', pct: '101', adjust: '', reason: '' }).ok, false);
  assert.equal(cleanCommission({ place: 'doorstep', pct: 'abc', adjust: '', reason: '' }).ok, false);
  assert.equal(cleanCommission({ place: 'doorstep', pct: '', adjust: '999999', reason: 'x' }).ok, false);
  assert.equal(cleanCommission({ place: 'moon', pct: '', adjust: '', reason: '' }).value.job_place, 'doorstep');
});

const job = { ref: 'MP-ABC123', date: '12 Oct 2026', place: 'doorstep', service: 1000, gst: 180, total: 1180, pct: 30, adjust: 50, adjustNote: 'Extra trip', earnings: 350, company: 650, collected: 1180, byChannel: { company_manual: 0, company_portal: 1180, mechanic: 0 }, paidOut: 0, inHand: 0, remitDue: 0, payoutDue: 350 };
test('payout message for the mechanic is plain, complete and has no customer contact details', () => {
  const t = payoutShareText({ mechanicName: 'Ravi', job });
  assert.match(t, /Hi Ravi/); assert.match(t, /MP-ABC123/); assert.match(t, /Doorstep/);
  assert.match(t, /₹1,000/); assert.match(t, /30%/); assert.match(t, /\+₹50/); assert.match(t, /Extra trip/);
  assert.match(t, /₹350/); assert.match(t, /Mechanix Pro will pay you/i);
  assert.doesNotMatch(t, /\d{10}/);
});
test('payout message says what the mechanic must hand over when he collected the money', () => {
  const t = payoutShareText({ mechanicName: 'Ravi', job: { ...job, adjust: 0, adjustNote: '', earnings: 300, company: 700, byChannel: { company_manual: 0, company_portal: 0, mechanic: 1180 }, inHand: 300, remitDue: 880, payoutDue: 0 } });
  assert.match(t, /collected by you/i); assert.match(t, /Please send Mechanix Pro ₹880/); assert.doesNotMatch(t, /will pay you/i);
});
test('statement message lists each job and the net', () => {
  const t = statementShareText({ mechanicName: 'Ravi', rows: [{ ref: 'MP-1', date: '11 Oct', place: 'doorstep', earnings: 300 }, { ref: 'MP-2', date: '12 Oct', place: 'garage', earnings: 250 }], totals: { earnings: 550, remitDue: 100, payoutDue: 450, net: 350, netLabel: 'Mechanix Pro owes mechanic' } });
  assert.match(t, /MP-1/); assert.match(t, /In garage/); assert.match(t, /₹550/); assert.match(t, /₹350/);
});
