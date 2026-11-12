// The Rs 349 checkup and quote fee and the Rs 99 new-customer fee are retired on every public page. One confirmation fee replaces them (Rs 49 to Rs 99 by engine size),
// and its numbers come from one place: DEFAULTS in assets/js/book-pay.js (mirrored by supabase/functions/_shared/confirm-fee.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SKIP = new Set(['node_modules', '.git', 'dist-site', 'dist-admin', 'dist-crm', 'admin', 'crm', 'supabase', 'docs', 'tests', 'scripts', 'brand-src', 'src', 'assets']);
const publicFiles = () => {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (/ 2(\.|$)/.test(e.name)) continue; // stray local copies, not part of the site
      if (!rel && SKIP.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r); else if (e.name.endsWith('.html') || e.name === 'llms.txt') out.push(r);
    }
  };
  walk(ROOT, '');
  return out;
};
// Allowed exceptions: none. (An invoice example showing 349 would be listed here with its page.)
const ALLOWED = {};

test('no public page or llms.txt mentions the checkup and quote fee, the new-customer fee or the slot fee', () => {
  const files = publicFiles(); assert.ok(files.length > 200 && files.includes('llms.txt'));
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /checkup and quote fee/i, f);
    assert.doesNotMatch(t, /new customers? (pay|fee)|for new customers|slot fee/i, f);
    // Changed on purpose 2026-11-12 (owner): Rs 349 is now the doorstep VISITING CHARGE. Every 349 must sit next to the words "visiting charge"; it is never again a checkup, quote, advance or booking fee.
    for (const m of t.matchAll(/(^|[^0-9.,])349([^0-9]|$)/g)) { const near = t.slice(Math.max(0, m.index - 140), m.index + 140); assert.match(near, /visiting charge/i, f + ' shows 349 outside the visiting charge wording'); }
  }
});
test('the terms, refund policy, help, home and llms.txt carry the new rule', () => {
  for (const f of ['index.html', 'help/index.html', 'llms.txt']) assert.match(read(f), /a small confirmation fee, ₹49 to ₹99 depending on (your|the) vehicle's engine size/, f);
  assert.match(read('terms/index.html'), /A booking is confirmed when you pay the confirmation fee and we confirm your slot/);
});
test('the numbers on the pages are the booking flow tiers (one source), not a third copy', () => {
  const bp = read('assets/js/book-pay.js'), ts = read('supabase/functions/_shared/confirm-fee.ts');
  const m = bp.match(/DEFAULTS = \{ confirm_std: (\d+), confirm_mid: (\d+), confirm_big: (\d+), confirm_car: (\d+) \}/);
  const [std, mid, big, car] = m.slice(1).map(Number);
  assert.match(ts, new RegExp(`confirm_std: ${std}, confirm_mid: ${mid}, confirm_big: ${big}, confirm_car: ${car}`));
  assert.equal(Math.min(std, mid, big, car), 49); assert.equal(Math.max(std, mid, big, car), 99);
  assert.match(read('terms/index.html'), new RegExp(`₹${std} up to 149cc, ₹${mid} for 150 to 250cc, ₹${big} for 251cc and above and for cars`));
  assert.match(read('assets/js/app.js'), new RegExp(`confirmation fee, ₹${Math.min(std, mid, big, car)} to ₹${Math.max(std, mid, big, car)} depending`));
  assert.doesNotMatch(read('scripts/build_pages.py'), /confirm_std: \d+/); // the generator reads the tiers, it does not hold them
});
test('the legal wording list for the lawyer exists and lists the changed pages', () => {
  const d = read('docs/LEGAL-REVIEW-FEE-WORDING.md');
  for (const s of ['/terms/', '/refund-policy/', 'Old text', 'New text']) assert.ok(d.includes(s), s);
});
test('the home FAQ and its FAQPage JSON-LD say the same thing about cost and cancelling', () => {
  const h = read('index.html');
  const ld = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1])).find((x) => x['@type'] === 'FAQPage');
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
  for (const q of ['What does it cost?', 'Can I cancel?']) {
    const a = ld.mainEntity.find((x) => x.name === q).acceptedAnswer.text;
    assert.ok(strip(h).includes(a), q);
  }
});
