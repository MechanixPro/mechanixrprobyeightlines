// M1a: the mechanic offer flow. Source-pattern tests (the screens need a browser; the screenshots were checked by hand).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync('assets/js/mechanic.js', 'utf8'), h = readFileSync('supabase/functions/_shared/mechanic-handler.ts', 'utf8'), sql = readFileSync('supabase/migrations/20270120000000_mechanic_offer.sql', 'utf8'), page = readFileSync('mechanic/index.html', 'utf8');

test('the app polls offers every 15 seconds and opens an offer only for a job not yet shown on this phone', () => {
  // Why: a job assigned while the app is open must ring within about 15 s, but never ring twice on the same phone.
  assert.match(js, /win\.setInterval\(pollOffers, 15000\)/);
  assert.match(js, /api\('offers'\)/);
  assert.match(js, /!x\.accepted_at && !seen\[x\.id\]/);
  assert.match(js, /markSeen\(j\.id\)/);
});

test('the alarm uses Web Audio plus vibrate, the first tap unlocks audio, and it stops on Accept, Can\'t take it and leaving the offer', () => {
  // Why: phones block sound until a tap; a ringing alarm that cannot be stopped would be worse than none.
  assert.match(js, /pointerdown', unlockAudio/);
  assert.match(js, /AudioContext/);
  assert.match(js, /navigator\.vibrate/);
  assert.match(js, /function acceptOffer\(j, btn, msg\) \{\s*stopAlert\(\)/);
  assert.match(js, /function declineOffer\(j, btn, msg\) \{\s*stopAlert\(\)/);
  assert.match(js, /if \(S\.screen !== 'offer'\) stopAlert\(\)/);
});

test('Accept calls accept, then mints the job link with the existing job_link action and opens /job/', () => {
  // Why: the visit steps (code, photos, quote) already live on /job/; the offer must hand over to them, not rebuild them.
  assert.match(js, /api\('accept', \{ id: j\.id \}\)/);
  assert.match(js, /api\('job_link', \{ id: j\.id \}\)/);
  assert.match(js, /\\\/job\\\/\\\?t=/);
});

test('Home shows Today: N jobs and the next-job card; the splash runs once per session', () => {
  assert.match(js, /'Today: '/);
  assert.match(js, /id: 'dNextJob'/);
  assert.match(js, /mxp_mech_splash/);
});

test('accept and decline only work for this mechanic\'s own job and never unassign', () => {
  // Why: the session's mechanic id is passed to the RPC, which checks leads.mechanic_id; the app cannot name another mechanic.
  assert.match(h, /mechanic_offer_accept', \{ p_mechanic: mechId/);
  assert.match(h, /mechanic_offer_decline', \{ p_mechanic: mechId/);
  assert.match(h, /\.eq\('mechanic_id', mechId\)\.in\('status', \['paid', 'scheduled'\]\)/);
  assert.match(sql, /l\.mechanic_id is distinct from p_mechanic/g);
  assert.doesNotMatch(sql.split('mechanic_offer_decline')[2] || '', /update public\.leads/, 'decline must not touch the lead');
});

test('accept is idempotent and writes the activity; decline writes activity and audit rows', () => {
  assert.match(sql, /mechanic_accepted_at is not null then return jsonb_build_object\('ok', true, 'already', true\)/);
  assert.match(sql, /'Mechanic accepted'/);
  assert.match(sql, /'Mechanic cannot take this job'/);
  assert.match(sql, /'mechanic_declined'/);
});

test('the migration is additive: new columns, a trigger and two functions only', () => {
  // Why: it ships to production before the app; nothing may be dropped or rewritten.
  const live = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.doesNotMatch(live, /drop (table|column)|delete from|truncate|alter column/i);
  assert.match(live, /add column if not exists mechanic_accepted_at/);
  assert.match(live, /grant execute on function public\.mechanic_offer_accept/);
});

test('the page keeps the strict CSP shape: no inline script, no inline style', () => {
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(page, /\sstyle=/);
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\./);
});
