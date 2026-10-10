// "Pro", the Mechanix Pro helper character: scripted messages, safe rendering, light and accessible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const P = require('../assets/js/pro-script.js');

test('Pro greets by page: home asks about the bike and offers brand shortcuts into the booking form', () => {
  const m = P.greet('/');
  assert.match(m.text, /Which bike do you ride\?/); assert.equal(m.state, 'wave');
  assert.ok(m.chips.length >= 4); for (const c of m.chips) assert.match(c.href, /^\/book\/\?brand=/);
});
test('Pro greets the roadside page with a WhatsApp action and no promised arrival time', () => {
  const m = P.greet('/roadside/'); assert.equal(m.chips[0].wa, true); assert.doesNotMatch(m.text, /\d+ ?min/i);
});
test('Pro has a greeting for services, offers and area pages, and stays quiet on legal and admin pages', () => {
  for (const p of ['/services/', '/offers/monsoon-check/', '/bike-service-hsr-layout/', '/bike-service/honda-activa-6g/']) assert.ok(P.greet(p), p);
  for (const p of ['/terms/', '/privacy/', '/refund-policy/', '/admin/', '/track/', '/unsubscribe/', '/contact/']) assert.equal(P.greet(p), null, p);
});
test('Pro reacts to the build: the bike name, the service and price, the PIN, and the last step', () => {
  assert.match(P.react('bike', { nick: 'Raja' }).text, /Nice, Raja!/);
  assert.match(P.react('bike', { model: 'Activa 6G' }).text, /Activa 6G/);
  const s = P.react('service', { name: 'General service', price: 1299 });
  assert.match(s.text, /General service/); assert.match(s.text, /₹1,299/); assert.match(s.text, /GST included/);
  assert.match(P.react('pin', { served: true, name: 'HSR Layout' }).text, /we serve HSR Layout/i);
  assert.match(P.react('pin', { served: false }).text, /all of Bengaluru/i);
  const f = P.react('final', {}); assert.equal(f.state, 'cheer'); assert.match(f.text, /quote first/i);
  assert.equal(P.react('idle', {}).chips[0].wa, true);
});
test('Pro never makes up urgency, discounts or numbers', () => {
  const all = JSON.stringify([P.greet('/'), P.greet('/services/'), P.greet('/roadside/'), P.react('bike', { nick: 'x' }), P.react('service', { name: 'A', price: 599 }), P.react('pin', { served: true }), P.react('final', {}), P.react('idle', {})]);
  assert.doesNotMatch(all, /hurry|limited|only \d+|\d+% off|last chance|today only|free (service|visit)/i);
});
test('a nickname with markup is passed through as plain text for the page to show safely', () => {
  const m = P.react('bike', { nick: '<img src=x onerror=1>' });
  assert.ok(m.text.length < 80); // capped; the UI uses textContent, never innerHTML, for message text
});
test('pro.js shows messages with textContent, keeps a dismiss and a hide option, and respects reduced motion', () => {
  const j = read('assets/js/pro.js');
  assert.match(j, /textContent/); assert.doesNotMatch(j, /innerHTML\s*=\s*[^;]*(text|nick|detail)/);
  assert.match(j, /mxp_pro_off/); assert.match(j, /prefers-reduced-motion/); assert.match(j, /mxpTrack/);
  assert.match(j, /role.{1,10}status|aria-live/);
});
test('the character is original SVG with the real logo mark as the badge, and animation stops for reduced motion', () => {
  const j = read('assets/js/pro.js'), c = read('assets/css/style.css');
  assert.match(j, /<svg/); assert.match(j, /logo-mark\.webp/); assert.match(c, /@media\(prefers-reduced-motion:reduce\)\{[^}]*#pro/);
});
test('the booking form tells Pro what is happening, and Pro is on the right pages only', () => {
  const a = read('assets/js/app.js'); assert.match(a, /mxp:state/);
  assert.match(read('scripts/build_pages.py'), /assets\/js\/pro\.js/);
  assert.match(read('index.html'), /assets\/js\/pro\.js/); assert.match(read('book/index.html'), /assets\/js\/pro\.js/);
});
test('Pro is small: scripts together stay under 20 KB', () => {
  assert.ok(read('assets/js/pro.js').length + read('assets/js/pro-script.js').length < 20000);
});
