const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = {}; require('../assets/js/config.js');
const L = require('../assets/js/logic.js');
const C = global.window.MXP;

test('the call number is a valid Indian mobile number', () => assert.equal(L.callLink(C.callNumber), 'tel:+918310621498'));
test('the displayed phone number matches the call number', () => assert.equal(C.phoneDisplay.replace(/\D/g, '').slice(-10), C.callNumber.slice(-10)));
test('no placeholder phone number is left in the structured data', () => {
  for (const f of ['src/home.jsonld', 'scripts/build_pages.py']) assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8'), /XXXXXXXXXX/, f);
});

test('the WhatsApp number is 91 plus a valid 10-digit mobile number', () => assert.match(C.whatsapp, /^91[6-9]\d{9}$/));
test('WhatsApp links built from the config open a chat with that number', () => {
  const href = 'https://wa.me/' + C.whatsapp + '?text=' + encodeURIComponent('Hi');
  assert.equal(href, 'https://wa.me/918310621498?text=Hi');
});
