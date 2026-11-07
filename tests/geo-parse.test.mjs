import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng } from '../crm/geo-parse.js';

test('plain numbers in two boxes', () => {
  assert.deepEqual(parseLatLng('12.939596', '77.722511'), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng(' 12.94 ', ' 77.72 '), { lat: 12.94, lng: 77.72 });
});
test('a "lat, lng" pair in either box (what Google Maps copies)', () => {
  assert.deepEqual(parseLatLng('12.939596, 77.722511', ''), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng('', '12.939596, 77.722511'), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng('12.939596,77.722511', '77.722511'), { lat: 12.939596, lng: 77.722511 });
});
test('degrees, minutes, seconds as shown on a Google Maps place', () => {
  const r = parseLatLng('12°56\'22.6"N 77°43\'21.0"E', '12.939596, 77.722511');
  assert.ok(Math.abs(r.lat - 12.939611) < 0.0001 && Math.abs(r.lng - 77.7225) < 0.0001, JSON.stringify(r));
  const q = parseLatLng('12°56\'22.6"N 77°43\'21.0"E', '');
  assert.ok(Math.abs(q.lat - 12.939611) < 0.0001 && Math.abs(q.lng - 77.7225) < 0.0001);
  const typo = parseLatLng('12°56′22.6″N 77°43′21.0″E', '');   // curly marks
  assert.ok(typo && Math.abs(typo.lat - 12.9396) < 0.001);
  const south = parseLatLng('12°56\'22.6"S 77°43\'21.0"W', '');
  assert.ok(south.lat < 0 && south.lng < 0);
});
test('a Google Maps link', () => {
  assert.deepEqual(parseLatLng('https://www.google.com/maps/place/X/@12.939596,77.722511,17z/data=!3m1', ''), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng('https://www.google.com/maps?q=12.939596,77.722511', ''), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng('https://maps.google.com/maps/dir//data=!3d12.939596!4d77.722511', ''), { lat: 12.939596, lng: 77.722511 });
});
test('hemisphere letters in decimals, either order', () => {
  assert.deepEqual(parseLatLng('12.939596 N, 77.722511 E', ''), { lat: 12.939596, lng: 77.722511 });
  assert.deepEqual(parseLatLng('77.722511 E, 12.939596 N', ''), { lat: 12.939596, lng: 77.722511 });
});
test('junk and empty give null, never a crash', () => {
  for (const [a, b] of [['', ''], [null, undefined], ['abc', 'def'], ['999', '999'], ['12.9', ''], ['1 2 3', '']]) assert.equal(parseLatLng(a, b), null, `${a}|${b}`);
});
