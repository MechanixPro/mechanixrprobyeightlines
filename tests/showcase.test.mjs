import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the home page shows every service as a tile, with cars going to the partner page', () => {
  const home = read('../index.html');
  const b = home.match(/<div class="bento">[\s\S]*?<\/section>/)[0];
  for (const href of ['/book/', '/book/?service=repair', '/roadside/', '#addons-home', '/partners/axlio/', '/fleet/']) assert.ok(b.includes(`href="${href}"`), href);
});
test('the Axlio page says what Axlio does, attributes it, and links out safely', () => {
  const p = read('../partners/axlio/index.html');
  assert.match(p, /run separately by Bushra Automobiles/);
  assert.match(p, /Jayanagar/); assert.match(p, /30 minutes/); assert.match(p, /Periodic service/);
  for (const a of p.match(/<a [^>]*href="https:\/\/axlio\.in[^"]*"[^>]*>/g)) assert.match(a, /rel="noopener"/);
  assert.doesNotMatch(p, /Eightlines/);
});
test('the phone bar has fixed-height buttons so it never stretches', () => {
  const css = read('../assets/css/style.css');
  assert.match(css, /\.mbar \.btn\{[^}]*height:48px/);
});
test('the phone bar is toggled with its own class, not the .show class of the image showcase', () => {
  assert.match(read('../assets/js/app.js'), /mb\.classList\.toggle\('on'/);
  assert.match(read('../assets/css/style.css'), /\.mbar\.on\{transform:none\}/);
});
