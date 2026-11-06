// SEO batch 1: stale wording, FAQ parity, llms.txt, structured data, technical quick wins. Run on the generated pages (npm run pages first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, publicFiles, htmlFiles, jsonld, flat, strip } from './helpers/pages.mjs';

test('1. no public page or llms.txt carries the retired "pay after" wording (text, meta, og, alt, JSON-LD)', () => {
  const files = publicFiles(); assert.ok(files.length > 200 && files.includes('llms.txt'));
  const bad = /pay after you say yes|pay only after|nothing is charged until|checkup and quote fee/i;
  for (const f of files) assert.doesNotMatch(read(f), bad, f);
  assert.doesNotMatch(read('src/landing.json'), bad);
  assert.doesNotMatch(read('scripts/make_presence.py'), bad);
});
test('1. the og:image:alt describes the confirmation-fee flow on every page', () => {
  for (const f of htmlFiles()) {
    const m = read(f).match(/<meta property="og:image:alt" content="([^"]*)"/);
    if (m) assert.equal(m[1], 'Mechanix Pro: doorstep bike service in Bengaluru. Small confirmation fee, itemised quote before work. Open 24/7.', f);
  }
  assert.match(read('rate-card/index.html'), /Confirm with a small fee adjusted in your bill; approve the quote before work/);
  assert.match(read('two-wheeler-service-at-home-bangalore/index.html'), /Quote first, work only after your OK/);
});
