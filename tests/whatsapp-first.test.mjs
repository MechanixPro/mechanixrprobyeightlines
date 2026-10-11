import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('a WhatsApp tap can be counted as a Google Ads conversion once its label is set', () => {
  const t = read('assets/js/tags.js'), c = read('assets/js/config.js');
  assert.match(c, /googleAdsWaSendTo:\s*'/);
  assert.match(t, /whatsapp_click' && C\.googleAdsWaSendTo/);
  assert.match(t, /send_to: C\.googleAdsWaSendTo/);
});
test('the WhatsApp conversion is counted once per visit, not on every tap', () => {
  assert.match(read('assets/js/tags.js'), /waCounted/);
});
test('the ad landing pages start with the WhatsApp chat starter, before any other button', () => {
  for (const s of ['bike-service', 'monsoon-check', 'ev-check', 'pre-trip-check']) {
    const h = read(`offers/${s}/index.html`);
    const hero = h.slice(h.indexOf('<section class="hero">'), h.indexOf('</section>', h.indexOf('<section class="hero">')));
    assert.ok(hero.indexOf('id="chat"') > -1 && hero.indexOf('id="chat"') < hero.indexOf('Build your service'), s);
  }
});
test('the WhatsApp message on ad pages names the campaign so leads can be traced', () => {
  assert.match(read('offers/bike-service/index.html'), /campaign: bike-service/);
});
