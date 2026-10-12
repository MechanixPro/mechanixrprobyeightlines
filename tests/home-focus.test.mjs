import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
const hero = body.slice(body.indexOf('<section class="hero">'), body.indexOf('</section>'));
const at = (id) => body.indexOf(`id="${id}"`);

test('the hero leads with the chat: it comes before every other button', () => {
  assert.ok(hero.indexOf('id="chat"') > -1);
  for (const other of ['btn-wa', 'Build your service', 'data-call']) assert.ok(hero.indexOf('id="chat"') < hero.indexOf(other), other);
});
test('the hero lead is short: two sentences a visitor can read in seconds', () => {
  const lead = hero.match(/<p class="lead">([^<]+)<\/p>/)[1];
  assert.ok(lead.length <= 130, 'lead is ' + lead.length + ' characters');
  assert.match(lead, /quote/i); assert.match(lead, /Bengaluru/);
});
test('the owner-confirmed proof sits in the hero, right next to the first action', () => {
  assert.match(hero, /10,000\+ services done/); assert.match(hero, /1,300\+ gated communities trust us/);
});
test('the hero keeps one main path: the chat, with a smaller WhatsApp, call and build link under it', () => {
  assert.equal((hero.match(/class="btn btn-primary/g) || []).length, 1); // only the roadside Get help button
  assert.match(hero, /btn btn-wa btn-sm/);
});
test('the page order follows how people decide: what do I need, what does it cost, how does it work, can I trust it, my questions, then the model links', () => {
  const order = ['needs', 'prices', 'brief', 'trust', 'home-faq', 'bikes'].map(at);
  assert.ok(order.every((n) => n > -1), 'all sections exist');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test('no new wording promises more than we can keep', () => {
  assert.doesNotMatch(hero, /guarantee|best|cheapest|instant|within \d+ ?min|limited|hurry/i);
});
