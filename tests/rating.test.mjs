import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingToken, ratingTokenOk, ratingUrl, cleanRating } from '../supabase/functions/_shared/rating.ts';

test('a rating link is valid only for its own booking and secret', async () => {
  const k = await ratingToken('s3cret', 'MP-ABC123');
  assert.match(k, /^[a-f0-9]{24}$/);
  assert.equal(await ratingTokenOk('s3cret', 'MP-ABC123', k), true);
  assert.equal(await ratingTokenOk('s3cret', 'MP-ABC124', k), false);
  assert.equal(await ratingTokenOk('other', 'MP-ABC123', k), false);
  assert.equal(await ratingTokenOk('', 'MP-ABC123', k), false);
  assert.equal(await ratingTokenOk('s3cret', 'MP-ABC123', 'nope'), false);
});
test('the link points at the rate page with the reference and signature', () => {
  assert.equal(ratingUrl('https://mechanixpro.in/', 'MP-ABC123', 'a'.repeat(24)), 'https://mechanixpro.in/rate/?r=MP-ABC123&k=' + 'a'.repeat(24));
});
test('a rating needs a real reference and a whole number from 1 to 5', () => {
  assert.equal(cleanRating({ ref: 'bad', rating: 5 }).ok, false);
  assert.equal(cleanRating({ ref: 'MP-ABC123', rating: 6 }).ok, false);
  assert.equal(cleanRating({ ref: 'MP-ABC123', rating: 4.5 }).ok, false);
  const r = cleanRating({ ref: 'mp-abc123', k: 'x', rating: '4', comment: '  great <b>work</b>  ' });
  assert.equal(r.ok, true); assert.equal(r.value.ref, 'MP-ABC123'); assert.equal(r.value.rating, 4); assert.equal(r.value.comment, 'great b work /b'); assert.doesNotMatch(r.value.comment, /[<>]/);
});
