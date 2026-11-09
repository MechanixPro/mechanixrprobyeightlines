// Mechanix Live: photos and short clips shared by the mechanic or garage, watched on the tracking page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../assets/js/live-ui.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = code(read('supabase/migrations/20270127000000_live_updates.sql'));

test('a clip must be 15 seconds or less (one second of slack) and every file under 30 MB', () => {
  assert.equal(L.checkFile('clip', 5e6, 14).ok, true); assert.equal(L.checkFile('clip', 5e6, 16).ok, true);
  assert.equal(L.checkFile('clip', 5e6, 17).ok, false); assert.equal(L.checkFile('clip', 5e6, 0).ok, false);
  assert.equal(L.checkFile('clip', 31 * 1024 * 1024, 10).ok, false); assert.equal(L.checkFile('photo', 150e3, 0).ok, true); assert.equal(L.checkFile('photo', 0, 0).ok, false);
  assert.equal(L.mimeOf({ type: 'video/quicktime' }, 'clip'), 'video/quicktime'); assert.equal(L.mimeOf({ type: '' }, 'clip'), 'video/mp4'); assert.equal(L.mimeOf({ type: 'application/pdf' }, 'photo'), 'image/jpeg');
  assert.equal(L.MAX_CLIP_S, 15);
});
test('the database keeps the files private, caps each job at 30 updates and only accepts them while the job is on', () => {
  assert.match(sql, /values \('live-updates', 'live-updates', false, 31457280/); assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /alter table public\.live_updates enable row level security/);
  assert.match(sql, /status in \('paid', 'scheduled'\) or \(l\.status = 'completed' and l\.completed_at >= now\(\) - interval '2 days'\)/);
  assert.match(sql, />= 30 then/); assert.match(sql, /p_path not like l\.id::text \|\| '\/%'/);
  assert.match(sql, /grant execute on function public\.live_update_add\(uuid, text, text, text, uuid\), public\.live_updates_for\(uuid\) to service_role/);
});
test('the server helper accepts only photos or clips of one kind, in the job folder', async () => {
  const src = read('supabase/functions/_shared/live.ts'); assert.match(src, /Send photos or clips, not both in one go/); assert.match(src, /startsWith\(leadId \+ '\/'\)/);
  assert.match(src, /list\(leadId, \{ limit: 200 \}\)/);
  const t = read('supabase/functions/tech-job/index.ts'); assert.match(t, /LIVE_ACTIONS/); assert.match(t, /liveAdd\(db as any, lead\.id, 'mechanic'/);
  const g = read('supabase/functions/garage-app/index.ts'); assert.match(g, /'live_upload_url', 'live_add'/); assert.match(g, /liveAdd\(db as any, a\.lead_id, 'garage'/);
});
test('the customer gets signed links only through the private tracking link, and the page shows them with a Video call button', () => {
  const tb = read('supabase/functions/track-booking/index.ts'); assert.match(tb, /createSignedUrl\(r\.path, 21600\)/); assert.match(tb, /live_updates, job_on/);
  const tr = read('assets/js/track.js'); assert.match(tr, /put\('trClips'/); assert.match(tr, /'trClips'/); assert.match(tr, /Ask for a video call/); assert.match(tr, /data-wa="Video call"/);
  assert.match(read('_headers'), /media-src 'self' https:\/\/mejdxsbpyscujpvbwvmg\.supabase\.co/);
});
test('the mechanic page and the garage app open the screen', () => {
  assert.match(read('assets/js/job.js'), /live_open/); assert.match(read('assets/js/garage.js'), /MXP_LIVE\.create/);
  assert.match(read('job/index.html'), /live-ui\.js/); assert.match(read('garage/index.html'), /live-ui\.js/);
});
