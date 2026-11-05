// POST /functions/v1/booking-update  { action, t, ... } — the customer adds details, photos and reports a problem, from the private tracking link (t is the 32-hex token).
//   save       { t, landmark?, access_note?, reg_no?, kms?, vehicle_note?, issue_text? }   a missing key is left alone, an empty string clears it; allowed until work starts
//   photo_url  { t, types: ['image/jpeg', ...] }                                              signed upload URLs into the private bucket 'booking-updates' (3 photos in all)
//   photo_done { t, paths: [...] }                                                            registers the uploaded photos
//   issue      { t, category, body }                                                          "Report a problem with my booking": an open issue for Crew and Admin, plus a team alert
// The token is the only key (the database looks it up in booking_secrets). Reads come with track-booking. Customer text is never written to logs; the booking history gets neutral lines.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanDetails, cleanIssue, cleanPhotoRequest, photoPathOk, MAX_PHOTOS } from '../_shared/booking-update.ts';
import { notifyTeamIssue } from '../_shared/after-payment.ts';

const ACTIONS = ['save', 'photo_url', 'photo_done', 'issue'];
const SAVE_ERR = 'Could not save. Please try again.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? ''), token = String(body?.t ?? '').toLowerCase();
  if (!ACTIONS.includes(action)) return json(req, { error: 'Unknown action' }, 400);
  if (!/^[0-9a-f]{32}$/.test(token)) return json(req, { error: 'This link is not valid.' }, 404);

  const db = adminDb();
  // Rate limit by hashed IP, like the other public functions (no raw IP stored).
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'booking_update_hit').eq('details->>ip', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 30) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('audit_log').insert({ action: 'booking_update_hit', details: { ip: ipHash, action } });

  const status = (r: any) => (r?.locked ? 409 : /not valid/.test(r?.error ?? '') ? 404 : 400);
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) { console.error('booking-update', fn, error.code); return null; } return data as any; };

  if (action === 'save') {
    const v = cleanDetails(body);
    if (!v.ok) return json(req, { error: v.error, field: v.field }, 400);
    const r = await rpc('booking_details_save', { p_token: token, p_d: v.value });
    if (!r) return json(req, { error: SAVE_ERR }, 500);
    return r.ok ? json(req, r) : json(req, r, status(r));
  }

  if (action === 'photo_url') {
    const r = await rpc('booking_photo_reserve', { p_token: token });
    if (!r) return json(req, { error: SAVE_ERR }, 500);
    if (!r.ok) return json(req, r, status(r));
    const v = cleanPhotoRequest(body, Number(r.left));
    if (!v.ok) return json(req, { error: v.error }, 400);
    const uploads: { path: string; url: string }[] = [];
    for (const ext of v.value) {
      const path = `${r.lead_id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from('booking-updates').createSignedUploadUrl(path);
      if (error || !data) { console.error('booking-update upload url'); return json(req, { error: SAVE_ERR }, 500); }
      uploads.push({ path, url: data.signedUrl });
    }
    return json(req, { ok: true, uploads, max: MAX_PHOTOS });
  }

  if (action === 'photo_done') {
    const r = await rpc('booking_photo_reserve', { p_token: token });
    if (!r) return json(req, { error: SAVE_ERR }, 500);
    if (!r.ok) return json(req, r, status(r));
    const paths = Array.isArray(body?.paths) ? [...new Set(body.paths.map((p: unknown) => String(p)))] as string[] : [];
    if (!paths.length || paths.length > MAX_PHOTOS || !paths.every((p) => photoPathOk(r.lead_id, p))) return json(req, { error: 'A photo is not valid. Choose it again.' }, 400);
    const { data: files } = await db.storage.from('booking-updates').list(String(r.lead_id), { limit: 100 });
    const there = new Set((files ?? []).map((f: { name: string }) => `${r.lead_id}/${f.name}`));
    if (!paths.every((p) => there.has(p))) return json(req, { error: 'A photo did not upload. Choose it again.' }, 400);
    let last: any = null;
    for (const p of paths) { last = await rpc('booking_photo_add', { p_token: token, p_path: p, p_bytes: null }); if (!last) return json(req, { error: SAVE_ERR }, 500); if (!last.ok) return json(req, last, status(last)); }
    return json(req, { ok: true, count: last?.count ?? null });
  }

  // issue
  const v = cleanIssue(body);
  if (!v.ok) return json(req, { error: v.error, field: v.field }, 400);
  const r = await rpc('booking_issue_report', { p_token: token, p_category: v.value.category, p_body: v.value.body });
  if (!r) return json(req, { error: SAVE_ERR }, 500);
  if (!r.ok) return json(req, r, status(r));
  if (!r.already && r.lead_id) await notifyTeamIssue(db, String(r.lead_id), Number(r.n), v.value.category);   // logged in booking_notifications as team_issue:N; never throws
  return json(req, { ok: true, id: r.id, already: !!r.already });
});
