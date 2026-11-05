import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
const section = (id) => { const i = body.indexOf(`id="${id}"`); return i < 0 ? '' : body.slice(i, body.indexOf('</section>', i)); };

test('the home page answers the common worries in a short FAQ, in plain true words', () => {
  const faq = section('home-faq'); assert.ok(faq, 'faq section');
  assert.ok((faq.match(/<details>/g) || []).length >= 6);
  for (const re of [/quote/i, new RegExp('₹' + Number(JSON.parse(read('src/site.json')).newCustomerFee).toLocaleString('en-IN')), /2 hours/, /30-day/, /OEM and aftermarket/, /560001/, /open 24\/7/i]) assert.match(faq, re, String(re));
  assert.doesNotMatch(faq, /guarantee|best|cheapest|rated|stars?\b/i);
});
test('the new sections add no invented proof: no ratings, reviews, years in business or member plans', () => {
  assert.doesNotMatch(section('needs') + section('home-faq'), /years of experience|since 20|membership|members?\b|testimonial/i);
});
