import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sha256Hex, techPct, companyShare, cleanReport } from '../supabase/functions/_shared/tech-job.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const T = 'a'.repeat(64);

test('sha256Hex matches the standard digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('the technician percent follows the admin rule: booking, then garage, then technician, then doorstep default', () => {
  const settings = { doorstep_pct: 30, garage_pct: 35 };
  assert.equal(techPct({ lead: { commission_pct: 25 }, mechanic: { payout_rate: 40 }, settings }), 25);
  assert.equal(techPct({ lead: { job_place: 'garage' }, mechanic: { payout_rate: 40 }, settings }), 35);
  assert.equal(techPct({ lead: {}, mechanic: { payout_rate: 40 }, settings }), 40);
  assert.equal(techPct({ lead: {}, mechanic: { payout_rate: 0 }, settings }), 30);
  assert.equal(techPct({ lead: {}, mechanic: null, settings: {} }), 30);
});
test('the company share is what is left after the technician cut, on the amount before GST when an invoice says so', () => {
  assert.deepEqual(companyShare({ collected: 1000, pct: 30, basis: 'collected' }), { mechanicCut: 300, company: 700 });
  assert.deepEqual(companyShare({ collected: 1180, pct: 30, basis: 'before_gst', invoice: { total: 1180, taxable: 1000 } }), { mechanicCut: 300, company: 880 });
  assert.deepEqual(companyShare({ collected: 1000, pct: 30, basis: 'before_gst', invoice: null }), { mechanicCut: 300, company: 700 });
  assert.deepEqual(companyShare({ collected: 0, pct: 30, basis: 'collected' }), { mechanicCut: 0, company: 0 });
});
test('a report needs a 64-hex token and an amount from 0 to 1,00,000; notes with ID numbers are dropped', () => {
  assert.equal(cleanReport({ t: T, amount: '1499.5', note: 'paid cash' }).value.amount, 1499.5);
  assert.equal(cleanReport({ t: T, amount: 0 }).ok, true);
  assert.equal(cleanReport({ t: T, amount: -1 }).ok, false);
  assert.equal(cleanReport({ t: T, amount: 100001 }).ok, false);
  assert.equal(cleanReport({ t: T, amount: 10.555 }).ok, false);
  assert.equal(cleanReport({ t: 'abc', amount: 10 }).ok, false);
  assert.equal(cleanReport({ t: T, amount: 10, note: 'Aadhaar 1234 5678 9012' }).value.note, null);
});

test('the job-link migration and the tech-job function', () => {
  const m = read('supabase/migrations/20261222000000_tech_job_links.sql'), f = read('supabase/functions/tech-job/index.ts');
  for (const s of ['token_hash text unique', "'technician'", 'function public.crm_tech_link(p_lead uuid)', 'extensions.gen_random_bytes(32)', 'expires_at = now()', "interval '7 days'", 'enable row level security']) assert.ok(m.includes(s), s);
  for (const s of ['This link is not valid.', 'This link has expired. Ask the desk for a new one.', 'This job is already reported.', "purpose: 'remittance'", "source: 'technician'", 'tech_job_hit', 'Too many tries. Wait a few minutes.', "collected_by: 'mechanic'"]) assert.ok(f.includes(s), s);
  const get = f.slice(f.indexOf("if (action === 'get')"), f.indexOf("if (action === 'report')"));
  assert.ok(get.length > 500, 'found the get branch');
  assert.doesNotMatch(get, /est_total|amount_due|price/);
});
test('the /job/ page has no inline script, is not indexed and is built', () => {
  assert.ok(existsSync(new URL('../job/index.html', import.meta.url)));
  const h = read('job/index.html');
  assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)[^>]*>/); assert.match(h, /noindex/); assert.match(h, /\/assets\/js\/job\.js/); assert.doesNotMatch(h, /tags\.js|adref\.js/);
  assert.match(read('scripts/build_site.sh'), /\bjob\b/);
});
