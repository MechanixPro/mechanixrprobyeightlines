// Google Maps: address search in the booking form and a Find us map. Both stay off until a key is set in config.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const L = require('../assets/js/logic.js');

const PLACE = {
  formattedAddress: 'Haralur Rd, 1st Sector, HSR Layout, Bengaluru, Karnataka 560102, India',
  location: { lat: 12.912345678, lng: 77.644567891 },
  addressComponents: [{ longText: 'HSR Layout', types: ['sublocality_level_1', 'sublocality', 'political'] }, { longText: 'Bengaluru', types: ['locality', 'political'] }, { longText: '560102', types: ['postal_code'] }],
};
test('placeToFields turns a Google place into the booking form fields', () => {
  const f = L.placeToFields(PLACE);
  assert.equal(f.pin, '560102'); assert.equal(f.lat, 12.91235); assert.equal(f.lng, 77.64457);
  assert.equal(f.address, 'Haralur Rd, 1st Sector, HSR Layout, Bengaluru, Karnataka 560102'); // no ", India"
  assert.equal(f.locality, 'HSR Layout'); assert.equal(f.inBengaluru, true);
});
test('placeToFields ignores a missing or malformed PIN and keeps the address short', () => {
  assert.equal(L.placeToFields({ ...PLACE, addressComponents: [{ longText: '5601', types: ['postal_code'] }] }).pin, '');
  assert.equal(L.placeToFields({ ...PLACE, addressComponents: [] }).pin, '');
  assert.equal(L.placeToFields({ ...PLACE, formattedAddress: 'x'.repeat(400) }).address.length, 200);
});
test('placeToFields flags a place outside Bengaluru and returns nothing for junk', () => {
  assert.equal(L.placeToFields({ ...PLACE, location: { lat: 13.08, lng: 80.27 } }).inBengaluru, false); // Chennai
  assert.equal(L.placeToFields(null), null);
  assert.equal(L.placeToFields({ formattedAddress: 'x', location: { lat: 'a', lng: 1 } }), null);
});

test('the Maps key is a public browser key (empty or an AIza key), and the booking form only shows address search when it is set', () => {
  assert.match(read('assets/js/config.js'), /googleMapsKey: '(AIza[\w-]{30,})?'/);
  const a = read('assets/js/app.js');
  assert.match(a, /C\.googleMapsKey && C\.googleAddressSearch === true/); assert.match(read('assets/js/config.js'), /googleAddressSearch: (false|true)/); assert.match(a, /data-act="gpick"/); assert.match(a, /id="f-gsearch"/);
});
test('gmaps.js loads Google only when a key is set, restricts to India and Bengaluru, and uses a session token', () => {
  const g = read('assets/js/gmaps.js');
  assert.match(g, /maps\.googleapis\.com\/maps\/api\/js/); assert.match(g, /if \(!C\.googleMapsKey\)/);
  assert.match(g, /includedRegionCodes: \['in'\]/); assert.match(g, /sessionToken/); assert.match(g, /locationRestriction/);
  assert.doesNotMatch(g, /AIza/); // no key in the code
});
test('the Contact page has a Find us section: an always-on directions link and a map that loads only with a key', () => {
  const c = read('contact/index.html');
  assert.match(c, /id="findus"/); assert.match(c, /google\.com\/maps\/search\/\?api=1&amp;query=/); assert.match(c, /data-gmap-embed/);
  assert.match(c, /assets\/js\/gmaps\.js/);
  assert.match(read('assets/js/gmaps.js'), /maps\/embed\/v1\/place/);
});
test('the security policy allows Google Maps and nothing is loaded from other new hosts', () => {
  const h = read('_headers');
  assert.match(h, /script-src[^;]*https:\/\/maps\.googleapis\.com/);
  assert.match(h, /connect-src[^;]*https:\/\/maps\.googleapis\.com/); assert.match(h, /connect-src[^;]*https:\/\/places\.googleapis\.com/);
  assert.match(h, /frame-src[^;]*https:\/\/www\.google\.com/);
});
test('the setup guide says how to restrict the key and cap spending', () => {
  const d = read('docs/GOOGLE-MAPS.md');
  assert.match(d, /HTTP referrers/i); assert.match(d, /mechanixpro\.in\/\*/); assert.match(d, /quota|budget/i); assert.match(d, /Places API \(New\)/);
});
