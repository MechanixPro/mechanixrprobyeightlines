import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');

test('the home page script sends the message a button carries instead of one fixed sentence', () => {
  assert.match(read('assets/js/app.js'), /getAttribute\('data-wa-text'\)/);
});
test('no fake urgency or invented proof was added to the home page', () => {
  const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  assert.doesNotMatch(body, /only \d+ (slots|left)|hurry|last chance|limited time|today only|most popular|rated|stars?\b/i);
});
