import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the Axlio page says what Axlio does, attributes it, and links out safely', () => {
  const p = read('../partners/axlio/index.html');
  assert.match(p, /run separately from Mechanix Pro/);
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
test('key pages have a link-preview card of their own, and the files exist', () => {
  for (const [page, card] of [['services', 'services'], ['roadside', 'roadside'], ['join', 'join'], ['partners/axlio', 'axlio'], ['help', 'how'], ['areas', 'areas'], ['offers/diwali-ready', 'diwali']]) {
    assert.match(read(`../${page}/index.html`), new RegExp(`og:image" content="https://mechanixpro.in/assets/img/og/${card}\\.jpg"`), page);
    assert.ok(readFileSync(new URL(`../assets/img/og/${card}.jpg`, import.meta.url)).length > 10000, card);
  }
});
test('the site pictures use the plate-covered versions only', () => {
  const home = read('../index.html');
  for (const m of home.matchAll(/assets\/img\/(stories\/[a-z-]+|hero-(?:roadside|repair|activa|rain)[a-z-]*)\.webp/g)) assert.match(m[1], /-p$/, m[0]);
});
