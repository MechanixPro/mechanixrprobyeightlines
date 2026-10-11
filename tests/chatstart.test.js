const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const C = require('../assets/js/chatstart.js');

test('the WhatsApp message carries the bike, the need and blanks for model and area', () => {
  const m = C.buildMessage({ bike: 'scooter', need: 'service' });
  assert.match(m, /^Hi Mechanix Pro, I need a service for my scooter in Bengaluru\./); assert.match(m, /Bike model: /); assert.match(m, /Area: /);
  assert.match(C.buildMessage({ bike: 'Royal Enfield', need: 'problem' }), /problem check for my Royal Enfield/);
});
test('an ad page adds its campaign name so the lead can be traced, and junk is cleaned', () => {
  assert.match(C.buildMessage({ bike: 'scooter', need: 'service', campaign: 'monsoon-check' }), /\(campaign: monsoon-check\)/);
  const m = C.buildMessage({ bike: '<b>x</b>', need: 'nonsense', campaign: 'a<script>' });
  assert.doesNotMatch(m, /<|>/); assert.match(m, /a service/);
});
test('the WhatsApp link is built from the configured number, and refuses a bad number', () => {
  assert.equal(C.waUrl('918310621498', 'Hi there'), 'https://wa.me/918310621498?text=Hi%20there');
  assert.equal(C.waUrl('83106', 'x'), null);
});
test('the chat steps are fixed and a breakdown goes to roadside help, not a quote chat', () => {
  assert.deepEqual(C.BIKES.map((b) => b.id), ['scooter', 'motorcycle', 'enfield', 'electric']);
  assert.deepEqual(C.NEEDS.map((n) => n.id), ['service', 'problem', 'sos']);
  assert.equal(C.NEEDS.find((n) => n.id === 'sos').href, '/roadside/');
});
test('the starting price line is true: it names the price from the page and says the quote comes first', () => {
  const t = C.priceLine({ service: '₹599', repair: '₹349' }, 'service');
  assert.match(t, /₹599/); assert.match(t, /GST/i); assert.match(t, /approve/i);
  assert.match(C.priceLine({ service: '₹599', repair: '₹349' }, 'problem'), /₹349/);
});
test('the home page and every ad page open with the chat starter, with plain links that work without JavaScript', () => {
  for (const f of ['index.html', 'offers/bike-service/index.html', 'offers/monsoon-check/index.html', 'offers/ev-check/index.html', 'offers/pre-trip-check/index.html']) {
    const h = read(f);
    assert.match(h, /id="chat"/, f); assert.match(h, /What do you ride\?/, f); assert.match(h, /assets\/js\/chatstart\.js/, f);
    assert.ok((h.match(/class="ride-chip"[^>]*data-wa-text="/g) || []).length >= 4, f + ' fallback links');
  }
  assert.match(read('offers/monsoon-check/index.html'), /data-campaign="monsoon-check"/);
});
test('the chat script has no inline code, uses textContent for words it builds, and respects reduced motion', () => {
  const j = read('assets/js/chatstart.js');
  assert.doesNotMatch(j, /innerHTML\s*=/); assert.match(j, /textContent/); assert.match(j, /prefers-reduced-motion/);
  assert.match(j, /track\('chat_bike'/); assert.match(j, /track\('chat_need'/); assert.match(j, /track\('whatsapp_click'/); assert.match(j, /win\.mxpTrack/);
  assert.doesNotMatch(read('index.html'), /<script>[^<]/);
});
test('chat bubbles and options are styled for thumbs: 48px options and a quiet-motion fallback', () => {
  const c = read('assets/css/style.css');
  assert.match(c, /\.bubble/); assert.match(c, /\.chat-opts/); assert.match(c, /min-height:48px/); assert.match(c, /prefers-reduced-motion/);
});
