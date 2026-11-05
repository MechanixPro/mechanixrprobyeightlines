import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
const hero = body.slice(body.indexOf('<section class="hero">'), body.indexOf('</section>'));
const at = (id) => body.indexOf(`id="${id}"`);

test('no new wording promises more than we can keep', () => {
  assert.doesNotMatch(hero, /guarantee|best|cheapest|instant|within \d+ ?min|limited|hurry/i);
});
