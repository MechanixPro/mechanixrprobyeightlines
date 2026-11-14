// POST /functions/v1/garage-app  { action, ... } — the partner garage app at /garage/. Public (deploy with --no-verify-jwt): the garage's private link token + PIN is the only key.
//   login            { token, pin }                          -> { session, expires_at, garage }   (5 wrong PINs lock 15 minutes; per-IP and per-link rate limits)
//   me               { session }                             -> { garage }
//   jobs             { session }                             -> { jobs: [...] }                   (never a phone, address or email)
//   job              { session, id }                         -> { job }                           (the customer's phone and, since 2026-11-09, the job address + pin ONLY for this garage's OPEN assignment, never email; each view is logged without the number)
//   progress         { session, id, event, photos?, note? }  event: received | work_started | ready (work_started waits for the customer's approval of the latest quote)
//   photo_upload_url { session, id, types: [...] }           -> signed upload URLs into the private bucket 'garage-updates'
//   estimate_save / estimate_submit { session, id, lines, notes?, hours? | day? }
//   statement        { session }                             -> completed jobs, amounts entered by Admin, settled or pending
//   dashboard        { session }                             -> greeting, today's jobs, Open/Closed, month figures, unsettled amounts Admin entered ("We owe you"), whether the shop location is saved
//   location_set     { session, lat, lng, acc? }             -> saves the shop location the phone reported (asked politely, never required)
//   open_set         { session, open }                       -> the Open / Closed switch (Open needs a selfie recorded in the last 24 hours)
//   selfie_upload_url { session, content_type, size }        -> one signed upload URL into the private bucket 'selfies'
//   selfie_record    { session, path }                       -> records the uploaded selfie
//   terms_accept     { session, tour? }                      -> records the terms version (and that the tour was seen)
//   team_contact     { session }                             -> the team's WhatsApp and call numbers when set as secrets (else the page uses its public config)
// Every response is built in _shared/garage.ts from a whitelist. Customer address and email are never selected from the database at all.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { notifyTeamGarage } from '../_shared/after-payment.ts';
import { createCollectLink, collectReady } from '../_shared/gateway.ts';
import { collectAction, cashAllowed, isArrived, dueFor } from '../_shared/collect-payment.ts';
import { buildInvoice } from '../_shared/invoice.ts';
import { selfieFresh, checkSelfie, selfiePath, selfiePathOk, TERMS_VERSION, SELFIE_NEEDED } from '../_shared/partner-avail.ts';
import { isCode, handoverHash, sameHash, afterWrongTry, doorState, MAX_ATTEMPTS, DOOR_KIND } from '../_shared/handover.ts';
import { cleanResults } from '../_shared/pro-check.ts';
import { liveUploadUrls, liveAdd } from '../_shared/live.ts';
import { signSession, verifySession, garageJobListItem, garageJobDetail, garageStatement, garageDashboard, cleanCancelReason, cleanLocation, cleanUpload, cleanEstimate, photoPath, photoPathOk, LINK_RE, PIN_RE, UUID_RE, EVENTS, LOGIN_MESSAGE, isOpen, type RawJob } from '../_shared/garage.ts';

const ACTIONS = ['qr_scan', 'points', 'code_issue', 'login', 'me', 'jobs', 'job', 'progress', 'photo_upload_url', 'estimate_save', 'estimate_submit', 'statement', 'team_contact', 'dashboard', 'location_set', 'open_set', 'selfie_upload_url', 'selfie_record', 'terms_accept', 'verify_code', 'payment_request', 'payment_cash', 'inspect_first_set', 'check_get', 'check_save', 'leads', 'claim', 'live_upload_url', 'live_add', 'decline', 'cancel_request', 'change_request', 'receiving_save', 'announcements', 'announcement_read', 'profile', 'performance', 'requests'];
// A suspended garage can sign in and look at old jobs, payments and reports, but every change is refused (client BRD).
const WRITE_ACTIONS = ['code_issue', 'progress', 'photo_upload_url', 'estimate_save', 'estimate_submit', 'location_set', 'open_set', 'verify_code', 'payment_request', 'payment_cash', 'inspect_first_set', 'check_save', 'claim', 'live_upload_url', 'live_add', 'decline', 'cancel_request', 'change_request', 'receiving_save', 'selfie_upload_url', 'selfie_record', 'qr_scan'];
const BAD = 'Could not save. Please try again.', SESSION_OVER = 'Your session has ended. Enter your PIN again.';
// Jobs accepted before the receiving checklist existed are not sent back to it.
const RECEIVING_FROM = Date.parse('2026-11-10T00:00:00+05:30');
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? '');
  if (!ACTIONS.includes(action)) return json(req, { error: 'Unknown action' }, 400);
  const db = adminDb();
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) { console.error('garage-app', fn, error.code); return null; } return data as any; };
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const secret = env('GARAGE_SESSION_SECRET');
  if (!secret) { console.error('garage-app: GARAGE_SESSION_SECRET is not set'); return json(req, { error: 'The garage app is not switched on yet.' }, 503); }

  /* ---------- login ---------- */
  if (action === 'login') {
    const token = String(b?.token ?? '').toLowerCase(), pin = String(b?.pin ?? '');
    const tok16 = LINK_RE.test(token) ? (await sha256Hex(token)).slice(0, 16) : 'bad';
    const since = ago(10);
    const [{ count: perIp }, { count: perLink }] = await Promise.all([
      db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_login_try').eq('details->>ip', ipHash).gte('created_at', since),
      db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_login_try').eq('details->>tok', tok16).gte('created_at', since),
    ]);
    if ((perIp ?? 0) >= 20 || (perLink ?? 0) >= 15) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);
    await db.from('audit_log').insert({ action: 'garage_login_try', details: { ip: ipHash, tok: tok16 } });
    if (!LINK_RE.test(token)) return json(req, { error: LOGIN_MESSAGE.link, code: 'link' }, 404);
    if (!PIN_RE.test(pin)) return json(req, { error: 'Enter your 4 to 6 digit PIN.', code: 'pin' }, 400);
    const r = await rpc('garage_login', { p_token: token, p_pin: pin });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: LOGIN_MESSAGE[r.error] ?? LOGIN_MESSAGE.link, code: r.error, left: r.left ?? null }, r.error === 'locked' ? 423 : r.error === 'pin' ? 401 : r.error === 'off' ? 403 : 404);
    const s = await signSession(secret, { access: r.access_id, garage: r.garage_id, version: r.session_version });
    return json(req, { ok: true, session: s.token, expires_at: s.expires_at, garage: { name: r.garage_name, label: r.label } });
  }

  /* ---------- every other action needs a live session ---------- */
  const claims = await verifySession(secret, b?.session);
  if (!claims) return json(req, { error: SESSION_OVER, code: 'session' }, 401);
  const who = await rpc('garage_session_check', { p_access: claims.a, p_ver: claims.v });
  if (!who) return json(req, { error: BAD }, 500);
  if (!who.ok || who.garage_id !== claims.g) return json(req, { error: SESSION_OVER, code: 'session' }, 401);
  const garageId: string = who.garage_id, accessId: string = who.access_id, garageName: string = who.garage_name;
  const jobId = String(b?.id ?? '');
  if (who.suspended && WRITE_ACTIONS.includes(action)) return json(req, { error: 'Your account is suspended. You can view past jobs and payments but not make changes. Contact Mechanix Pro.', code: 'suspended' }, 403);

  const selfieAt = async (): Promise<string | null> => (await rpc('partner_selfie_latest', { p_kind: 'garage', p_id: garageId })) ?? null;
  if (action === 'me') {
    const terms = (await rpc('partner_terms_status', { p_kind: 'garage', p_id: garageId, p_version: TERMS_VERSION })) ?? { accepted: false, tour_done: false };
    return json(req, { ok: true, suspended: !!who.suspended, garage: { name: garageName, label: who.label }, terms: { version: TERMS_VERSION, accepted: !!terms.accepted, tour_done: !!terms.tour_done }, selfie_at: await selfieAt() });
  }
  if (action === 'terms_accept') {
    const r = await rpc('partner_terms_accept', { p_kind: 'garage', p_id: garageId, p_version: TERMS_VERSION, p_tour: b?.tour === true });
    if (!r) return json(req, { error: BAD }, 500);
    return json(req, { ok: true, terms: { version: TERMS_VERSION, accepted: true, tour_done: !!r.tour_done } });
  }
  if (action === 'selfie_upload_url') {
    const c = checkSelfie(b?.content_type, b?.size);
    if (!c.ok) return json(req, { error: c.error }, 400);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_selfie_try').eq('details->>access', accessId).gte('created_at', ago(60));
    if ((count ?? 0) >= 10) return json(req, { error: 'Too many tries. Wait a while.' }, 429);
    await db.from('audit_log').insert({ action: 'garage_selfie_try', details: { access: accessId } });
    const path = selfiePath('garage', garageId, crypto.randomUUID(), c.ext);
    const { data, error } = await db.storage.from('selfies').createSignedUploadUrl(path);
    if (error || !data) { console.error('garage-app selfie url'); return json(req, { error: BAD }, 500); }
    return json(req, { ok: true, path, url: data.signedUrl });
  }
  if (action === 'selfie_record') {
    if (!selfiePathOk(b?.path, 'garage', garageId)) return json(req, { error: 'That photo is not valid.' }, 400);
    const at = await rpc('partner_selfie_record', { p_kind: 'garage', p_id: garageId, p_path: b.path });
    if (!at) return json(req, { error: BAD }, 500);
    return json(req, { ok: true, selfie_at: at });
  }

  if (action === 'team_contact') {
    const wa = env('GARAGE_TEAM_WHATSAPP').replace(/\D/g, ''), tel = env('GARAGE_TEAM_PHONE').replace(/\D/g, '');
    return json(req, { ok: true, whatsapp: /^\d{12}$/.test(wa) ? wa : null, call: /^\d{12}$/.test(tel) ? tel : null });
  }

  /* Spare-part QR points: one scan per code, 20 a day. The database decides; the messages here are plain words. */
  if (action === 'qr_scan') {
    const code = String(b?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (code.length !== 10) return json(req, { ok: false, error: 'That code does not look right. It has 10 letters and numbers.' }, 400);
    const r = await rpc('garage_qr_scan', { p_garage: garageId, p_code: code });
    if (!r) return json(req, { error: BAD }, 500);
    const msg: Record<string, string> = { unknown: 'This code is not valid.', used: 'This code was already used.', limit: 'You have reached today’s limit of scans. Try again tomorrow.' };
    if (!r.ok) return json(req, { ok: false, error: msg[String(r.error)] ?? 'Could not add points.' }, 409);
    return json(req, { ok: true, points: Number(r.points), part: typeof r.part === 'string' ? r.part.slice(0, 80) : null, balance: Number(r.balance) });
  }
  if (action === 'points') {
    const r = await rpc('garage_points_balance', { p_garage: garageId });
    return json(req, { ok: true, balance: Number(r?.balance ?? 0), scans: Number(r?.scans ?? 0) });
  }

  if (action === 'location_set') {
    const v = cleanLocation(b);
    if (!v.ok) return json(req, { error: 'That location does not look right.' }, 400);
    const r = await rpc('garage_location_set', { p_access: accessId, p_lat: v.lat, p_lng: v.lng, p_acc: v.acc });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, { ok: true, at: r.at });
  }
  if (action === 'open_set') {
    if (typeof b?.open !== 'boolean') return json(req, { error: 'Choose Open or Closed.' }, 400);
    if (b.open === true && !selfieFresh(await selfieAt())) return json(req, { error: SELFIE_NEEDED, code: 'selfie' }, 409);
    const r = await rpc('garage_open_set', { p_access: accessId, p_open: b.open });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, { ok: true, open: r.open });
  }

  /* ---------- reading jobs: only this garage's own assignments ---------- */
  const mine = (id?: string, withCancelled = false) => { let q = db.from('garage_assignments').select('id,lead_id,status,eta,notes,assigned_at,received_at,started_at,ready_at,returned_at,offer_expires_at').eq('garage_id', garageId); if (!withCancelled) q = q.neq('status', 'cancelled'); if (id) q = q.eq('id', id); return q; };
  // Lead columns: never address, email or phone here (the address of an open job is fetched separately in 'job'). The phone is fetched separately, only after the contact view is allowed.
  const LEAD_COLS = 'id,name,booking_id,vehicle,service_id,bike_id,status,delivery_stage,ready_at,delivered_at,closed_at';
  async function context(rows: any[]) {
    const leadIds = [...new Set(rows.map((r) => r.lead_id))];
    const [leads, quotes] = await Promise.all([db.from('leads').select(LEAD_COLS).in('id', leadIds), db.from('job_quotes').select('lead_id,status,version,decided_at,decided_method,decided_via').in('lead_id', leadIds).in('status', ['sent', 'approved', 'declined', 'changes_requested']).order('version', { ascending: false })]);
    const L = new Map((leads.data ?? []).map((l: any) => [l.id, l])), Q = new Map<string, any>();
    for (const q of quotes.data ?? []) if (!Q.has(q.lead_id)) Q.set(q.lead_id, q);
    const sIds = [...new Set([...L.values()].map((l: any) => l.service_id).filter(Boolean))], bIds = [...new Set([...L.values()].map((l: any) => l.bike_id).filter(Boolean))];
    const [sv, bk] = await Promise.all([sIds.length ? db.from('services').select('id,name').in('id', sIds) : Promise.resolve({ data: [] }), bIds.length ? db.from('bikes').select('id,brand,model,reg_no').in('id', bIds) : Promise.resolve({ data: [] })]);
    const S = new Map((sv.data ?? []).map((x: any) => [x.id, x.name])), K = new Map((bk.data ?? []).map((x: any) => [x.id, x]));
    return { L, Q, S, K };
  }
  const rawOf = (a: any, c: Awaited<ReturnType<typeof context>>): RawJob => { const l: any = c.L.get(a.lead_id) ?? {}; return { assignment: a, lead: l, service: c.S.get(l.service_id) ?? null, vehicle: c.K.get(l.bike_id) ?? null, quote: c.Q.get(a.lead_id) ?? null, approval: c.Q.get(a.lead_id) ?? null }; };
  const sign = async (bucket: string, paths: string[]) => { const out: string[] = []; for (const p of paths.slice(0, 12)) { const { data } = await db.storage.from(bucket).createSignedUrl(p, 600); if (data?.signedUrl) out.push(data.signedUrl); } return out; };

  if (action === 'leads') {
    // Live leads: open paid bookings near this garage. The database function never returns a name, phone, email or street address.
    const { data, error } = await db.rpc('garage_live_leads', { p_garage: garageId });
    if (error) { console.error('garage-app leads', error.code); return json(req, { error: 'Could not load live leads. Please try again.' }, 500); }
    return json(req, { ok: true, available: !!data?.available, full: !!data?.full, leads: Array.isArray(data?.leads) ? data.leads : [] });
  }
  if (action === 'claim') {
    // First garage to claim wins; the database re-checks everything inside one transaction.
    const lead = String(b?.lead ?? '');
    if (!UUID_RE.test(lead)) return json(req, { error: 'Choose a job.' }, 400);
    const { data, error } = await db.rpc('garage_claim_lead', { p_garage: garageId, p_lead: lead });
    if (error) { console.error('garage-app claim', error.code); return json(req, { error: 'Could not claim. Please try again.' }, 500); }
    if (!data?.ok) {
      const msg: Record<string, string> = { taken: 'Someone else got this one.', full: 'You have as many open jobs as you can take. Finish one first.', unavailable: 'Switch Available on to claim jobs.' };
      return json(req, { ok: false, error: msg[String(data?.error)] ?? 'Could not claim this job.', code: String(data?.error ?? '') }, 409);
    }
    return json(req, { ok: true, id: data.assignment_id });
  }
  if (action === 'dashboard') {
    const [{ data: rows, error }, { data: g }] = await Promise.all([mine().order('assigned_at', { ascending: false }).limit(500), db.from('garages').select('name,city,is_open,shop_loc_at,plan').eq('id', garageId).maybeSingle()]);
    if (error) { console.error('garage-app dashboard', error.code); return json(req, { error: 'Could not load your dashboard. Please try again.' }, 500); }
    const done = (rows ?? []).filter((r: any) => ['ready', 'returned'].includes(r.status)), ids = done.map((r: any) => r.id);
    const [c, st] = await Promise.all([context(done), ids.length ? db.from('garage_settlements').select('assignment_id,amount,settled,settled_at,note').in('assignment_id', ids.slice(0, 200)) : Promise.resolve({ data: [] })]);
    const S = new Map((st.data ?? []).map((s: any) => [s.assignment_id, s]));
    const all = (rows ?? []).map((a: any) => ({ assignment: a, lead: ((c.L.get(a.lead_id) as any) ?? {}), vehicle: ((c.K.get(((c.L.get(a.lead_id) as any) ?? {}).bike_id) as any) ?? null), settlement: (S.get(a.id) as any) ?? null }));
    return json(req, { ok: true, dashboard: garageDashboard({ today: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), garage: { name: g?.name ?? garageName, city: g?.city, is_open: g?.is_open, shop_loc_at: g?.shop_loc_at, plan: g?.plan }, rows: all }) });
  }

  if (action === 'jobs') {
    const { data: rows, error } = await mine().order('assigned_at', { ascending: false }).limit(200);
    if (error) { console.error('garage-app jobs', error.code); return json(req, { error: 'Could not load your jobs. Please try again.' }, 500); }
    // A job the company has paid is no longer shown to the garage (the company keeps the record).
    const doneIds = (rows ?? []).filter((r: any) => ['ready', 'returned'].includes(r.status)).map((r: any) => r.id);
    const { data: paidRows } = doneIds.length ? await db.from('garage_settlements').select('assignment_id').eq('settled', true).in('assignment_id', doneIds) : { data: [] };
    const paidSet = new Set((paidRows ?? []).map((p: any) => p.assignment_id)), shown = (rows ?? []).filter((r: any) => !paidSet.has(r.id));
    // Jobs cancelled because the customer cancelled the booking stay visible for 7 days, marked Cancelled (customer_cancelled: true).
    const { data: cx } = await db.from('garage_assignments').select('id,lead_id,status,eta,notes,assigned_at,received_at,started_at,ready_at,returned_at,offer_expires_at').eq('garage_id', garageId).eq('status', 'cancelled').gte('updated_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('assigned_at', { ascending: false }).limit(20);
    const all = [...shown, ...(cx ?? [])];
    const c = await context(all);
    const cancelledOk = new Set((cx ?? []).filter((r: any) => (c.L.get(r.lead_id) as any)?.status === 'cancelled').map((r: any) => r.id));
    return json(req, { ok: true, garage: { name: garageName }, jobs: all.filter((r: any) => r.status !== 'cancelled' || cancelledOk.has(r.id)).map((a: any) => garageJobListItem(rawOf(a, c))) });
  }

  if (action === 'statement') {
    const { data: rows } = await mine().in('status', ['ready', 'returned']).order('assigned_at', { ascending: false }).limit(200);
    const ids = (rows ?? []).map((r: any) => r.id);
    const [c, st] = await Promise.all([context(rows ?? []), ids.length ? db.from('garage_settlements').select('assignment_id,amount,settled,settled_at,note').in('assignment_id', ids) : Promise.resolve({ data: [] })]);
    const S = new Map((st.data ?? []).map((s: any) => [s.assignment_id, s]));
    // What the customer has paid on each job (collected in the app, online, or recorded by the desk), shown next to the job. Not the garage payout.
    const lids = [...new Set((rows ?? []).map((r: any) => r.lead_id))];
    const { data: pl } = lids.length ? await db.from('leads').select('id,paid_amount,final_paid_amount,final_paid_method').in('id', lids) : { data: [] };
    const PAID = new Map((pl ?? []).map((x: any) => [x.id, x]));
    // Paid jobs are not listed to the garage: only what is still to be paid, plus one running total. The company keeps every record.
    const mapped = (rows ?? []).map((a: any) => { const r = rawOf(a, c); return { assignment: a, lead: { ...r.lead, ...(PAID.get(a.lead_id) ?? {}) }, vehicle: r.vehicle, settlement: S.get(a.id) ?? null }; });
    const paid = mapped.filter((m: any) => m.settlement && m.settlement.settled), open = mapped.filter((m: any) => !(m.settlement && m.settlement.settled));
    const out: any = garageStatement(open);
    out.settled = Math.round(paid.reduce((t: number, m: any) => t + Number(m.settlement.amount || 0), 0) * 100) / 100; out.settled_jobs = paid.length;
    return json(req, { ok: true, statement: out });
  }

  /* ---------- BRD additions: decline, cancel request, change requests, announcements, profile, performance ---------- */
  if (action === 'announcements') {
    const data = await rpc('garage_announcements_list', { p_garage: garageId });
    const list = Array.isArray(data) ? data : [];
    return json(req, { ok: true, announcements: list, unread: list.filter((x: any) => !x.read).length });
  }
  if (action === 'announcement_read') {
    if (!UUID_RE.test(String(b?.announcement ?? ''))) return json(req, { error: 'Choose an announcement.' }, 400);
    await rpc('garage_announcement_read', { p_garage: garageId, p_id: String(b.announcement) });
    return json(req, { ok: true });
  }
  if (action === 'profile') {
    const [p, r] = await Promise.all([rpc('garage_profile', { p_garage: garageId }), rpc('garage_requests_mine', { p_garage: garageId })]);
    return json(req, { ok: true, profile: p ?? null, requests: Array.isArray(r) ? r : [] });
  }
  if (action === 'performance') {
    const p = await rpc('garage_performance', { p_garage: garageId });
    if (!p) return json(req, { error: 'Could not load your performance. Please try again.' }, 500);
    return json(req, { ok: true, performance: p });
  }
  if (action === 'requests') {
    const r = await rpc('garage_requests_mine', { p_garage: garageId });
    return json(req, { ok: true, requests: Array.isArray(r) ? r : [] });
  }
  if (action === 'change_request') {
    const kind = String(b?.kind ?? '');
    if (!['bank', 'hours'].includes(kind)) return json(req, { error: 'Choose bank details or working hours.' }, 400);
    const d = b?.details && typeof b.details === 'object' ? b.details : {};
    const r = await rpc('garage_change_request', { p_access: accessId, p_kind: kind, p_details: { open_days: String(d.open_days ?? '').slice(0, 40), open_time: String(d.open_time ?? '').slice(0, 5), close_time: String(d.close_time ?? '').slice(0, 5) }, p_reason: String(b?.reason ?? '').slice(0, 200) });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, { ok: true });
  }

  // Everything below is about one job.
  if (!UUID_RE.test(jobId)) return json(req, { error: 'This job is not available.' }, 404);

  if (action === 'job') {
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_detail').eq('details->>access', accessId).gte('created_at', ago(10));
    if ((count ?? 0) >= 60) return json(req, { error: 'Too many opens. Wait a few minutes.' }, 429);
    await db.from('audit_log').insert({ action: 'garage_detail', details: { access: accessId } });
    const { data: a } = await mine(jobId, true).maybeSingle();   // a job cancelled because the customer cancelled the booking is still opened (it shows as cancelled); other cancelled jobs are not
    if (!a) return json(req, { error: 'This job is not available.' }, 404);
    const c = await context([a]), raw = rawOf(a, c);
    if (a.status === 'cancelled' && (raw.lead as any)?.status !== 'cancelled') return json(req, { error: 'This job is not available.' }, 404);
    const [bd, ho, pr, es] = await Promise.all([
      db.from('booking_details').select('issue_text').eq('lead_id', a.lead_id).maybeSingle(),
      db.from('handovers').select('note,photo_paths').eq('lead_id', a.lead_id).eq('kind', 'pickup').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('garage_progress').select('event,at,note,photos').eq('assignment_id', a.id).order('at'),
      db.from('garage_estimates').select('id,status,lines,notes,hours,return_day,review_note,submitted_at').eq('assignment_id', a.id).order('created_at', { ascending: false }).limit(10),
    ]);
    raw.issue = (bd.data as any)?.issue_text ?? null;
    raw.pickup = { note: (ho.data as any)?.note ?? null, photos: await sign('handover', ((ho.data as any)?.photo_paths ?? []) as string[]) };
    raw.progress = await Promise.all((pr.data ?? []).map(async (p: any) => ({ event: p.event, at: p.at, note: p.note, photos: await sign('garage-updates', p.photos ?? []) })));
    raw.estimates = es.data ?? [];
    // The customer's one-time code: only its state is sent (never the code or the hash). Needed when the booking was paid-confirmed or a code was made.
    const { data: dr } = await db.from('handovers').select('kind,verified_at,locked_at,code_expires_at,attempts').eq('lead_id', a.lead_id).eq('kind', DOOR_KIND).order('created_at', { ascending: false });
    const { data: cf } = await db.from('leads').select('id,confirm_fee,confirm_paid_at,paid_amount,inspect_first,final_paid_at,final_paid_method,final_paid_amount').eq('id', a.lead_id).maybeSingle();
    const dd = cf ? await dueFor(db, cf, async () => 0) : null, deskPaid = !!dd && dd.bill >= 1 && dd.due < 1;   // the desk recorded the payment in Admin
    const code = doorState(dr ?? []), codeNeeded = code !== 'none' || (cf as any)?.confirm_fee != null;
    // The number: only for an open assignment, and only after the view is logged (the database also refuses a closed lead, a switched-off access and more than 40 views in 10 minutes).
    let contact = false, limited = false;
    if (isOpen(a.status) && !who.suspended) {   // a suspended garage sees past work only: no customer address or phone, even on a job it still holds
      contact = (await rpc('garage_contact_view', { p_access: accessId, p_assignment: a.id })) === true;
      limited = !contact;
      // 2026-11-09 owner decision: the address of THIS garage's own open job (the assignment was matched on garage_id above). Read in this one place; never in lists.
      const { data: pl } = await db.from('leads').select('address,area,pincode,lat,lng').eq('id', a.lead_id).maybeSingle();
      raw.place = (pl as any) ?? null;
      if (contact) { const { data: ph } = await db.from('leads').select('phone').eq('id', a.lead_id).maybeSingle(); (raw.lead as any).phone = (ph as any)?.phone ?? null; }
    }
    const receiving = (await rpc('garage_receiving_get', { p_assignment: a.id })) ?? { done: false };
    return json(req, { ok: true, job: { ...garageJobDetail(raw, contact), contact_limited: limited, code, code_needed: codeNeeded, receiving: { done: !!receiving.done || (!!a.received_at && Date.parse(a.received_at) < RECEIVING_FROM), odometer_km: receiving.odometer_km ?? null, damage: receiving.damage ? String(receiving.damage).slice(0, 300) : null },
      pay: { inspect_first: (cf as any)?.inspect_first === true, paid: !!(cf as any)?.final_paid_at || deskPaid, method: (cf as any)?.final_paid_method ?? (deskPaid ? 'desk' : null), amount: (cf as any)?.final_paid_amount ?? (deskPaid ? Number((cf as any)?.paid_amount) || null : null), arrived: isArrived(null, a.status), cash_available: cashAllowed({ arrived: isArrived(null, a.status), inspectFirst: (cf as any)?.inspect_first === true }) } } });
  }

  if (action === 'photo_upload_url') {
    const v = cleanUpload(b);
    if (!v.ok) return json(req, { error: v.error }, 400);
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !isOpen(a.status)) return json(req, { error: 'This job is not available.' }, 404);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_upload').eq('details->>access', accessId).gte('created_at', ago(10));
    if ((count ?? 0) >= 60) return json(req, { error: 'Too many photos. Wait a few minutes.' }, 429);
    await db.from('audit_log').insert({ action: 'garage_upload', details: { access: accessId, n: v.value.length } });
    const uploads: { path: string; url: string }[] = [];
    for (const ext of v.value) {
      const path = photoPath(garageId, a.id, crypto.randomUUID(), ext);
      const { data, error } = await db.storage.from('garage-updates').createSignedUploadUrl(path);
      if (error || !data) { console.error('garage-app upload url'); return json(req, { error: BAD }, 500); }
      uploads.push({ path, url: data.signedUrl });
    }
    return json(req, { ok: true, uploads });
  }

  if (action === 'live_upload_url' || action === 'live_add') {
    // Mechanix Live for a job assigned to THIS garage: photos and short clips the customer watches on the tracking page.
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !['received', 'in_work', 'ready'].includes(a.status)) return json(req, { error: a ? 'Accept the job first.' : 'This job is not available.' }, a ? 409 : 404);
    const r = action === 'live_upload_url' ? await liveUploadUrls(db as any, a.lead_id, b) : await liveAdd(db as any, a.lead_id, 'garage', garageId, b);
    return json(req, r.body, r.status);
  }

  if (action === 'check_get' || action === 'check_save') {
    // Pro Check 20 for a job assigned to THIS garage (mine() filters the assignment by the garage in the session).
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !['received', 'in_work'].includes(a.status)) return json(req, { error: a ? 'Accept the job first.' : 'This job is not available.' }, a ? 409 : 404);
    const rec = (await rpc('garage_receiving_get', { p_assignment: a.id })) ?? { done: false };
    if (!rec.done && !(a.received_at && Date.parse(a.received_at) < RECEIVING_FROM)) return json(req, { error: 'Fill in the receiving checklist first.', blocked: 'receiving' }, 409);
    const { data: lead } = await db.from('leads').select('id,vehicle').eq('id', a.lead_id).maybeSingle();
    if (!lead) return json(req, { error: 'This job is not available.' }, 404);
    if (lead.vehicle === 'car') return json(req, { error: 'Pro Check 20 is for bikes.' }, 400);
    if (action === 'check_get') {
      const { data } = await db.rpc('job_check_get', { p_lead: a.lead_id });
      return json(req, { ok: true, results: data?.results ?? {}, complete: !!data?.complete });
    }
    const c = cleanResults(b?.results);
    if (!c.ok) return json(req, { error: c.error }, 400);
    const { data, error } = await db.rpc('job_check_save', { p_lead: a.lead_id, p_kind: 'garage', p_by: garageId, p_results: c.value });
    if (error) { console.error('garage-app check_save', error.code); return json(req, { error: 'Could not save the check. Try again.' }, 500); }
    return json(req, { ok: true, complete: !!data?.complete });
  }

  if (action === 'code_issue') {
    // "Vehicle picked up": the customer's one-time code is made when none exists yet. It is shown only on the customer's tracking page, never sent to the garage.
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !['received', 'in_work'].includes(a.status)) return json(req, { error: a ? 'Accept the job first.' : 'This job is not available.' }, a ? 409 : 404);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'garage_code_try').eq('details->>access', accessId).gte('created_at', ago(60));
    if ((count ?? 0) >= 10) return json(req, { error: 'Too many tries. Wait a while.' }, 429);
    await db.from('audit_log').insert({ action: 'garage_code_try', details: { access: accessId } });
    const r = await rpc('garage_code_issue', { p_access: accessId, p_assignment: a.id });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 409);
    return json(req, { ok: true, already: !!r.already });
  }

  if (action === 'verify_code') {
    // Same check as the mechanic's visit_start (tech-job): salted hash, the try is counted before the compare, 5 wrong tries lock it, 24-hour expiry. A wrong code never shows the right one.
    if (!isCode(b?.code)) return json(req, { error: 'Enter the 4-digit code.' }, 400);
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !['received', 'in_work'].includes(a.status)) return json(req, { error: a ? 'Accept the job first.' : 'This job is not available.' }, a ? 409 : 404);
    const { data: lead } = await db.from('leads').select('id,ref').eq('id', a.lead_id).maybeSingle();
    if (!lead) return json(req, { error: 'This job is not available.' }, 404);
    const { data: rows } = await db.from('handovers').select('id,kind,code_hash,code_expires_at,attempts,locked_at,verified_at,created_at').eq('lead_id', a.lead_id).eq('kind', DOOR_KIND).order('created_at', { ascending: false });
    const door = doorState(rows ?? []);
    if (door === 'verified') return json(req, { ok: true, already: true });
    if (door === 'none') return json(req, { error: 'The customer has no code yet. Ask the team to send one.' }, 409);
    if (door === 'locked') return json(req, { error: 'Too many wrong codes. The team will send a new code.', locked: true }, 423);
    if (door === 'expired') return json(req, { error: 'The code has expired. Ask the team for a new one.' }, 410);
    const row = (rows ?? [])[0] as any;
    const { data: tried } = await db.from('handovers').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts).is('verified_at', null).is('locked_at', null).select('id').maybeSingle();
    if (!tried) return json(req, { error: 'Please try again.' }, 409);
    if (!sameHash(await handoverHash(row.id, String(b.code)), row.code_hash)) {
      const w = afterWrongTry(row.attempts);
      if (w.locked) {
        await db.from('handovers').update({ locked_at: new Date().toISOString() }).eq('id', row.id);
        await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `The door code was entered wrong ${MAX_ATTEMPTS} times by garage ${garageName} and is locked. Send a new code.` }).then(() => {}, () => {});
        await db.from('audit_log').insert({ action: 'handover_locked', details: { lead: (lead as any).ref, kind: DOOR_KIND, garage: garageId } });
        return json(req, { error: 'Too many wrong codes. The team will send a new code.', locked: true }, 423);
      }
      return json(req, { error: `That code is not right. ${w.left} ${w.left === 1 ? 'try' : 'tries'} left.`, left: w.left }, 400);
    }
    const now = new Date().toISOString();
    const { data: done, error } = await db.from('handovers').update({ verified_at: now }).eq('id', row.id).is('verified_at', null).select('id').maybeSingle();
    if (error || !done) { console.error('garage-app verify_code', error?.code); return json(req, { error: error ? BAD : 'Please try again.' }, error ? 500 : 409); }
    await db.from('booking_secrets').update({ door_code: null }).eq('lead_id', lead.id);   // the code is spent: it is no longer shown anywhere
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `Customer code confirmed by garage ${garageName}.` }).then(() => {}, () => {});
    await db.from('audit_log').insert({ action: 'door_code_verified', details: { lead: (lead as any).ref, garage: garageId, access: accessId, via: 'garage' } });
    return json(req, { ok: true });
  }

  // Collect payment: online first; cash/UPI only after arrival for a customer who inspects first. The rules live in _shared/collect-payment.ts and run here, not in the screen.
  if (['payment_request', 'payment_cash', 'inspect_first_set'].includes(action)) {
    const { data: a } = await mine(jobId).maybeSingle();
    if (!a || !['received', 'in_work', 'ready', 'returned'].includes(a.status)) return json(req, { error: 'Payment opens once the vehicle is with you.' }, 409);
    const { data: lead } = await db.from('leads').select('id,ref,booking_id,name,bike_id,service_id,addons,coupon_discount,extra_discount,extra_discount_note,paid_amount,confirm_fee,confirm_paid_at,inspect_first,final_link_id,final_link_url,final_link_amount,final_paid_at,final_paid_method,final_paid_amount,deleted_at').eq('id', a.lead_id).maybeSingle();
    if (!lead || lead.deleted_at) return json(req, { error: 'This job is not available.' }, 404);
    const { data: m } = await db.from('mechanics').select('id').eq('garage_id', garageId).limit(1).maybeSingle();
    const build = async () => {
      const [{ data: services }, { data: bike }] = await Promise.all([db.from('services').select('id,kind,name,price'), lead.bike_id ? db.from('bikes').select('big_bike,engine_class').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null })]);
      return buildInvoice({ ...lead, big_bike: (bike as any)?.big_bike ?? false, engine_class: (bike as any)?.engine_class ?? null }, (services ?? []) as any).total;
    };
    const r = await collectAction(db, { createLink: createCollectLink, paymentsReady: collectReady }, action, lead, { kind: 'garage', name: garageName, mechanicId: (m as any)?.id ?? null }, isArrived(null, a.status), b, build);
    return json(req, r.body, r.status);
  }

  if (action === 'decline' || action === 'cancel_request') {
    const reason = String(b?.reason ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (action === 'cancel_request') { const cr = cleanCancelReason(reason); if (!cr.ok) return json(req, { error: cr.error }, 400); }
    const r = await rpc(action === 'decline' ? 'garage_decline' : 'garage_cancel_request', { p_access: accessId, p_assignment: jobId, p_reason: reason });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, action === 'decline' ? { ok: true, declined_this_week: r.declined_this_week, free_used: !!r.free_used } : { ok: true });
  }
  if (action === 'receiving_save') {
    const odo = Math.round(Number(b?.odometer_km)), photos = Array.isArray(b?.photos) ? b.photos.map((p: unknown) => String(p)) : [];
    if (!Number.isFinite(odo) || odo < 0 || odo > 999999) return json(req, { error: 'Enter the odometer reading in kilometres.' }, 400);
    if (!photos.every((p: string) => photoPathOk(p, garageId, jobId))) return json(req, { error: 'A photo is not valid. Take it again.' }, 400);
    const checks = b?.checks && typeof b.checks === 'object' ? b.checks : {};
    const r = await rpc('garage_receiving_save', { p_access: accessId, p_assignment: jobId, p_odometer: odo, p_checks: checks, p_damage: b?.damage ? String(b.damage).slice(0, 300) : null, p_photos: photos });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, { ok: true });
  }

  if (action === 'progress') {
    const event = String(b?.event ?? '');
    if (!EVENTS.includes(event)) return json(req, { error: 'Choose a valid update.' }, 400);
    const photos = Array.isArray(b?.photos) ? b.photos.map((p: unknown) => String(p)) : [];
    if (!photos.every((p: string) => photoPathOk(p, garageId, jobId))) return json(req, { error: 'A photo is not valid. Take it again.' }, 400);
    const r = await rpc('garage_progress_set', { p_access: accessId, p_assignment: jobId, p_event: event, p_photos: photos, p_note: b?.note ? String(b.note).slice(0, 300) : null });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error, blocked: r.blocked ?? null }, r.blocked ? 409 : 400);
    if (event === 'ready' && !r.already) await notifyTeamGarage(db, r.lead_id, 'ready', 1, garageName);
    return json(req, { ok: true, status: r.status, already: !!r.already });
  }

  if (action === 'estimate_save' || action === 'estimate_submit') {
    const v = cleanEstimate(b);
    if (!v.ok) return json(req, { error: v.error }, 400);
    const submit = action === 'estimate_submit';
    const r = await rpc('garage_estimate_save', { p_access: accessId, p_assignment: jobId, p_lines: v.value.lines, p_notes: v.value.notes, p_hours: v.value.hours, p_day: v.value.day, p_submit: submit });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    if (submit) await notifyTeamGarage(db, r.lead_id, 'estimate', Number(r.n), garageName, Number(r.total));
    return json(req, { ok: true, submitted: submit, subtotal: r.subtotal, gst: r.gst, total: r.total });
  }
  return json(req, { error: 'Unknown action' }, 400);
});
