import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');

test('the home hero asks "What do you ride?" and each answer opens WhatsApp with a ready message', () => {
  const hero = home.slice(home.indexOf('<section class="hero">'), home.indexOf('</section>'));
  assert.match(hero, /What do you ride\?/);
  const chips = [...hero.matchAll(/class="ride-chip"[^>]*data-wa-text="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(chips.length >= 4);
  for (const c of chips) { assert.match(c, /^Hi Mechanix Pro/); assert.match(c, /Bike model/i); assert.match(c, /Area/i); }
});
test('the hero says plainly that nothing is charged until the quote is approved and when replies come', () => {
  const hero = home.slice(home.indexOf('<section class="hero">'), home.indexOf('</section>'));
  assert.match(hero, /Nothing is charged until you approve/i); assert.match(hero, /8 AM to 9 PM/);
});
test('every price card has an Ask on WhatsApp link that names that service', () => {
  const cards = home.slice(home.indexOf('class="price-cards"'), home.indexOf('</ul>', home.indexOf('class="price-cards"')));
  const links = [...cards.matchAll(/data-wa-text="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.length, 4);
  for (const [i, name] of ['Basic', 'General', 'Full', 'problem check'].entries()) assert.match(links[i], new RegExp(name, 'i'));
});
test('the final call to action puts WhatsApp first', () => {
  const end = home.slice(home.lastIndexOf('<div class="final">'));
  assert.ok(end.indexOf('btn-wa') > -1 && end.indexOf('btn-wa') < end.indexOf('Build your service'));
});
test('the home page script sends the message a button carries instead of one fixed sentence', () => {
  assert.match(read('assets/js/app.js'), /getAttribute\('data-wa-text'\)/);
});
test('no fake urgency or invented proof was added to the home page', () => {
  const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  assert.doesNotMatch(body, /only \d+ (slots|left)|hurry|last chance|limited time|today only|most popular|rated|stars?\b/i);
});
