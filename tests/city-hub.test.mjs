import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const page = read('two-wheeler-service-at-home-bangalore/index.html');
const hub = page.slice(page.indexOf('id="brands"'), page.indexOf('<section><div class="wrap" style="max-width:820px"><div class="sec-head"><h2>Questions we get asked'));
const text = hub.replace(/<[^>]+>/g, ' ');

test('four city hub headings, in order, before the FAQ', () => {
  const heads = ['Brands we service in Bengaluru', 'Services we provide in Bengaluru', 'How a booking works', 'Mechanix Pro vs an unverified roadside workshop'];
  let at = page.indexOf('How it works.');
  for (const h of heads) { const i = page.indexOf(h); assert.ok(i > at, h); at = i; }
  assert.ok(at < page.indexOf('Questions we get asked'));
});
test('no forbidden claims, no external images, no logos', () => {
  for (const w of [/guaranteed/i, /100%/, /police/i, /OEM scanner/i, /5,000/, /21-point/i, /live video/i, /genuine OEM/i]) assert.ok(!w.test(hub), String(w));
  for (const m of hub.matchAll(/<img\b[^>]*>/g)) { assert.ok(/src="\/assets\/img\/hero\//.test(m[0]), m[0]); assert.ok(!/logo/i.test(m[0])); }
  assert.ok(!/<script|onclick=|style=/.test(hub));
});
test('brand chips are a list of text links to existing paths', () => {
  const chips = [...hub.matchAll(/<li><a href="(\/[^"]+)">([^<]+)<\/a><\/li>/g)];
  assert.ok(chips.length >= 12);
  for (const [, href] of chips) assert.ok(existsSync(new URL('..' + href, import.meta.url)), href);
  assert.ok(/<ul class="hub-chips">/.test(hub));
});
test('comparison table has the exact eight rows with th scope', () => {
  const rows = [...hub.matchAll(/<tr><th scope="row">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['Partners checked', 'Quote before work', 'One-time code at handover', 'Photos at pickup, ready and delivery', 'Online payment with a bill', 'Repair warranty', 'Doorstep service', 'Track your job']);
  assert.equal((hub.match(/<th scope="col">/g) || []).length, 3);
  assert.ok(text.includes('Based on how most unbranded roadside workshops work. Your experience may differ.'));
});
test('six service cards, fee text filled, brand cards only on this page', () => {
  assert.equal((hub.match(/class="hub-card"/g) || []).length, 6);
  assert.ok(hub.includes('Popular in Bengaluru'));
  assert.ok(!/\{\{/.test(hub));
  assert.ok(/₹\d+ to ₹\d+/.test(hub));
  assert.ok(!read('scooty-repair-at-home-bangalore/index.html').includes('hub-chips'));
  assert.ok(!read('index.html').includes('hub-chips'));
  assert.ok(/\.hub-table\{[^}]*overflow-x:auto/.test(read('assets/css/pages.css')));
});
