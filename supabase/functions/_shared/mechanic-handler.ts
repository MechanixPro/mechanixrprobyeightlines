// The mechanic-app request handler with its dependencies passed in (the database client, Razorpay, secrets), so Node can run every action against a fake database. index.ts wires the real ones.
// Actions (all POST { action, ... }, public: the mechanic's private link + PIN is the only key):
//   login        { token, pin }            -> { session, expires_at, mechanic }     5 wrong PINs lock 15 minutes; per-IP and per-link limits
//   me           { session }               -> { mechanic }
//   dashboard    { session, date? }        -> greeting, availability, bookings count for the date, month stats, cash due
//   jobs         { session, date? }        -> this mechanic's jobs for a day (whitelisted; phone only on open jobs; never address or email)
//   dues         { session }               -> total due and the unsettled jobs (Total collected, Your payout, Due to platform)
//   job_link     { session, id }           -> { url }  a fresh /job/?t=... link for one of this mechanic's open jobs
//   status_set   { session, status, lat?, lng?, acc? }   Available / Busy (Available may carry the last known location)
//   pay_link     { session, id } | { session, all: true }  Razorpay link for the amount the SERVER computed from the ledger
//   team_contact { session }
import { signMechanicSession, verifyMechanicSession, mechanicJobItem, duesView, payAmount, istToday, dateOk, monthRange, isOpenLead, LINK_RE, PIN_RE, UUID_RE, LOGIN_MESSAGE } from './mechanic.ts';
import { mechanicDues, unsettledRows } from './mech-dues.ts';
import { selfieFresh, checkSelfie, selfiePath, selfiePathOk, TERMS_VERSION, SELFIE_NEEDED } from './partner-avail.ts';
import { techPct } from './tech-job.ts';

export const ACTIONS = ['login', 'me', 'dashboard', 'jobs', 'dues', 'job_link', 'status_set', 'selfie_upload_url', 'selfie_record', 'terms_accept', 'pay_link', 'team_contact'];
const BAD = 'Could not save. Please try again.', SESSION_OVER = 'Your session has ended. Enter your PIN again.';

export type Deps = {
  db: any; env: (k: string, fallback?: string) => string; sha256Hex: (s: string) => Promise<string>;
  json: (req: Request, body: unknown, status?: number) => Response; cors: (req: Request) => Record<string, string>;
  createPaymentLink: (o: { amount: number; ref: string; leadId: string; name: string; phone: string; description: string; notes?: Record<string, string> }) => Promise<{ url: string }>;
  buildInvoice: (lead: any, services: any[]) => any; getSetting: (db: any, key: string, fallback: any) => Promise<any>; now?: () => number;
};

const chunks = <T>(a: T[], n = 80): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const dayStartIso = (d: string) => `${d}T00:00:00+05:30`;
const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

export async function handleMechanic(req: Request, d: Deps): Promise<Response> {
  const { db, json } = d, now = d.now ?? Date.now;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: d.cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && d.cors(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? '');
  if (!ACTIONS.includes(action)) return json(req, { error: 'Unknown action' }, 400);
  const ago = (min: number) => new Date(now() - min * 60_000).toISOString();
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) { console.error('mechanic-app', fn, error.code); return null; } return data as any; };
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  const ipHash = await d.sha256Hex((ip || 'unknown') + d.env('IP_SALT', 'mxp'));
  const secret = d.env('GARAGE_SESSION_SECRET');
  if (!secret) { console.error('mechanic-app: GARAGE_SESSION_SECRET is not set'); return json(req, { error: 'The mechanic app is not switched on yet.' }, 503); }

  /* ---------- login ---------- */
  if (action === 'login') {
    const token = String(b?.token ?? '').toLowerCase(), pin = String(b?.pin ?? '');
    const tok16 = LINK_RE.test(token) ? (await d.sha256Hex(token)).slice(0, 16) : 'bad', since = ago(10);
    const [{ count: perIp }, { count: perLink }] = await Promise.all([
      db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'mechanic_login_try').eq('details->>ip', ipHash).gte('created_at', since),
      db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'mechanic_login_try').eq('details->>tok', tok16).gte('created_at', since),
    ]);
    if ((perIp ?? 0) >= 20 || (perLink ?? 0) >= 15) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);
    await db.from('audit_log').insert({ action: 'mechanic_login_try', details: { ip: ipHash, tok: tok16 } });
    if (!LINK_RE.test(token)) return json(req, { error: LOGIN_MESSAGE.link, code: 'link' }, 404);
    if (!PIN_RE.test(pin)) return json(req, { error: 'Enter your 4 to 6 digit PIN.', code: 'pin' }, 400);
    const r = await rpc('mechanic_login', { p_token: token, p_pin: pin });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: LOGIN_MESSAGE[r.error] ?? LOGIN_MESSAGE.link, code: r.error, left: r.left ?? null }, r.error === 'locked' ? 423 : r.error === 'pin' ? 401 : r.error === 'off' ? 403 : 404);
    const s = await signMechanicSession(secret, { access: r.access_id, mechanic: r.mechanic_id, version: r.session_version }, now());
    return json(req, { ok: true, session: s.token, expires_at: s.expires_at, mechanic: { name: r.mechanic_name, area: r.area ?? null } });
  }

  /* ---------- every other action needs a live session ---------- */
  const claims = await verifyMechanicSession(secret, b?.session, now());
  if (!claims) return json(req, { error: SESSION_OVER, code: 'session' }, 401);
  const who = await rpc('mechanic_session_check', { p_access: claims.a, p_ver: claims.v });
  if (!who) return json(req, { error: BAD }, 500);
  if (!who.ok || who.mechanic_id !== claims.m) return json(req, { error: SESSION_OVER, code: 'session' }, 401);
  const mechId: string = who.mechanic_id;
  const me = { name: String(who.mechanic_name ?? ''), area: who.area ?? null, availability: who.availability === 'busy' ? 'busy' : 'available' };

  const selfieAt = async (): Promise<string | null> => (await rpc('partner_selfie_latest', { p_kind: 'mechanic', p_id: mechId })) ?? null;
  if (action === 'me') {
    const terms = (await rpc('partner_terms_status', { p_kind: 'mechanic', p_id: mechId, p_version: TERMS_VERSION })) ?? { accepted: false, tour_done: false };
    return json(req, { ok: true, mechanic: me, terms: { version: TERMS_VERSION, accepted: !!terms.accepted, tour_done: !!terms.tour_done }, selfie_at: await selfieAt() });
  }
  if (action === 'terms_accept') {
    const r = await rpc('partner_terms_accept', { p_kind: 'mechanic', p_id: mechId, p_version: TERMS_VERSION, p_tour: b?.tour === true });
    if (!r) return json(req, { error: BAD }, 500);
    return json(req, { ok: true, terms: { version: TERMS_VERSION, accepted: true, tour_done: !!r.tour_done } });
  }
  if (action === 'selfie_upload_url') {
    const c = checkSelfie(b?.content_type, b?.size);
    if (!c.ok) return json(req, { error: c.error }, 400);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'mechanic_selfie_try').eq('details->>access', who.access_id).gte('created_at', ago(60));
    if ((count ?? 0) >= 10) return json(req, { error: 'Too many tries. Wait a while.' }, 429);
    await db.from('audit_log').insert({ action: 'mechanic_selfie_try', details: { access: who.access_id } });
    const path = selfiePath('mechanic', mechId, crypto.randomUUID(), c.ext);
    const { data, error } = await db.storage.from('selfies').createSignedUploadUrl(path);
    if (error || !data) { console.error('mechanic-app selfie url'); return json(req, { error: BAD }, 500); }
    return json(req, { ok: true, path, url: data.signedUrl });
  }
  if (action === 'selfie_record') {
    if (!selfiePathOk(b?.path, 'mechanic', mechId)) return json(req, { error: 'That photo is not valid.' }, 400);
    const at = await rpc('partner_selfie_record', { p_kind: 'mechanic', p_id: mechId, p_path: b.path });
    if (!at) return json(req, { error: BAD }, 500);
    return json(req, { ok: true, selfie_at: at });
  }
  if (action === 'team_contact') {
    const wa = d.env('GARAGE_TEAM_WHATSAPP').replace(/\D/g, ''), tel = d.env('GARAGE_TEAM_PHONE').replace(/\D/g, '');
    return json(req, { ok: true, whatsapp: /^\d{12}$/.test(wa) ? wa : null, call: /^\d{12}$/.test(tel) ? tel : null });
  }

  /* ---------- the ledger view: the same figures as Admin > Mechanic ledgers ---------- */
  async function account() {
    const [{ data: mech }, { data: leadRows }, { data: services }, settings] = await Promise.all([
      db.from('mechanics').select('id,name,payout_rate').eq('id', mechId).maybeSingle(),
      db.from('leads').select('*').eq('mechanic_id', mechId).is('deleted_at', null).order('created_at', { ascending: false }).limit(400),
      db.from('services').select('id,kind,name,price'),
      Promise.all([d.getSetting(db, 'doorstep_pct', 30), d.getSetting(db, 'garage_pct', 30)]),
    ]);
    const leads: any[] = leadRows ?? [], ids = leads.map((l) => l.id);
    const [invs, ents, bikes, mine] = await Promise.all([
      Promise.all(chunks(ids).map((c) => db.from('invoices').select('lead_id,ref,issued_at,total,taxable,revision').in('lead_id', c).is('voided_at', null).order('revision', { ascending: false }))),
      Promise.all(chunks(ids).map((c) => db.from('ledger_entries').select('id,lead_id,mechanic_id,entry_type,amount,collected_by,reverses_id').in('lead_id', c))),
      Promise.all(chunks([...new Set(leads.map((l) => l.bike_id).filter(Boolean))]).map((c) => db.from('bikes').select('id,big_bike,engine_class').in('id', c))),
      db.from('ledger_entries').select('id,lead_id,mechanic_id,entry_type,amount,collected_by,reverses_id').eq('mechanic_id', mechId),
    ]);
    const inv = new Map<string, any>(); for (const r of invs.flatMap((x: any) => x.data ?? [])) if (!inv.has(r.lead_id)) inv.set(r.lead_id, r);
    const byLead = new Map<string, any[]>(); for (const e of ents.flatMap((x: any) => x.data ?? [])) (byLead.get(e.lead_id) ?? byLead.set(e.lead_id, []).get(e.lead_id)!).push(e);
    const bk = new Map<string, any>(bikes.flatMap((x: any) => x.data ?? []).map((x: any) => [x.id, x]));
    const m = { ...(mech ?? { id: mechId }), id: mechId };
    const jobs: { invoice: any; entries: any[] }[] = [];
    for (const l of leads) {
      const entries = byLead.get(l.id) ?? [], row = inv.get(l.id);
      if (!(l.status === 'completed' || Number(l.paid_amount) > 0 || entries.length || row)) continue;
      let base: { total: number; taxable: number; ref?: string; issued_at?: string } | null = row ? { total: Number(row.total), taxable: Number(row.taxable), ref: row.ref, issued_at: row.issued_at } : null;
      if (!base) { try { const bi = d.buildInvoice({ ...l, big_bike: bk.get(l.bike_id)?.big_bike ?? false, engine_class: bk.get(l.bike_id)?.engine_class ?? null }, (services ?? []) as any); if (bi && bi.lines?.length && bi.total > 0) base = { total: bi.total, taxable: bi.taxable }; } catch { base = null; } }
      if (!base) continue;
      const pct = techPct({ lead: l, mechanic: m, settings: { doorstep_pct: settings[0], garage_pct: settings[1] } });
      jobs.push({ entries, invoice: { lead_id: l.id, ref: base.ref ?? l.ref, issued_at: base.issued_at ?? l.completed_at ?? l.paid_at ?? l.created_at, total: base.total, taxable: base.taxable, mechanic_id: mechId, mechanic_rate: pct, commission_adjust: Number(l.commission_adjust) || 0 } });
    }
    const dues = mechanicDues({ mechanic: m, jobs, entries: mine.data ?? [] });
    const svcName = new Map<string, string>((services ?? []).map((s: any) => [s.id, s.name]));
    const names = new Map<string, { booking_id?: string | null; service?: string | null }>(leads.map((l) => [l.id, { booking_id: l.booking_id, service: svcName.get(l.service_id) ?? null }]));
    return { dues, rows: unsettledRows(dues), names, leads, totals: new Map<string, number>(dues.jobAccounts.map((a: any) => [a.lead_id, a.total])) };
  }

  /* ---------- the day's jobs ---------- */
  const DAY_COLS = 'id,booking_id,name,phone,area,preferred_date,preferred_slot,status,visit_stage,vehicle,service_id,bike_id';
  async function dayJobs(date: string) {
    const { data, error } = await db.from('leads').select(DAY_COLS).eq('mechanic_id', mechId).eq('preferred_date', date).is('deleted_at', null).not('status', 'in', '(lost,junk)').order('preferred_date').limit(100);
    if (error) return null;
    const rows: any[] = data ?? [], ids = rows.map((r) => r.id);
    const sIds = [...new Set(rows.map((r) => r.service_id).filter(Boolean))], bIds = [...new Set(rows.map((r) => r.bike_id).filter(Boolean))];
    const [sv, bk, rep] = await Promise.all([
      sIds.length ? db.from('services').select('id,name').in('id', sIds) : Promise.resolve({ data: [] }),
      bIds.length ? db.from('bikes').select('id,brand,model,reg_no').in('id', bIds) : Promise.resolve({ data: [] }),
      ids.length ? db.from('tech_job_links').select('lead_id').in('lead_id', ids).not('reported_at', 'is', null) : Promise.resolve({ data: [] }),
    ]);
    const S = new Map<string, string>((sv.data ?? []).map((x: any) => [x.id, x.name])), K = new Map<string, any>((bk.data ?? []).map((x: any) => [x.id, x])), R = new Set<string>((rep.data ?? []).map((x: any) => x.lead_id));
    const rank: Record<string, number> = { asap: 0, morning: 1, afternoon: 2, evening: 3 };
    rows.sort((a, b) => (rank[a.preferred_slot] ?? 4) - (rank[b.preferred_slot] ?? 4));
    return rows.map((l) => mechanicJobItem({ lead: l, service: S.get(l.service_id) ?? null, bike: K.get(l.bike_id) ?? null, reported: R.has(l.id) }));
  }
  const pickDate = (v: unknown) => (dateOk(v) ? v : istToday(now()));

  if (action === 'jobs') {
    const date = pickDate(b?.date), jobs = await dayJobs(date);
    if (!jobs) return json(req, { error: 'Could not load your bookings. Please try again.' }, 500);
    return json(req, { ok: true, date, jobs });
  }

  if (action === 'dues') {
    let a: any; try { a = await account(); } catch (e) { console.error('mechanic-app dues', (e as Error).message); return json(req, { error: 'Could not load your dues. Please try again.' }, 500); }
    return json(req, { ok: true, dues: duesView(a.dues, a.rows, a.names) });
  }

  if (action === 'dashboard') {
    const date = pickDate(b?.date), today = istToday(now()), mr = monthRange(today);
    let a: any, jobs: any, mon: any; try {
      [a, jobs, mon] = await Promise.all([account(), dayJobs(date), db.from('leads').select('id,status,preferred_date,completed_at').eq('mechanic_id', mechId).is('deleted_at', null).gte('preferred_date', mr.from).lte('preferred_date', mr.to).limit(500)]);
    } catch (e) { console.error('mechanic-app dashboard', (e as Error).message); return json(req, { error: 'Could not load your dashboard. Please try again.' }, 500); }
    if (!jobs) return json(req, { error: 'Could not load your bookings. Please try again.' }, 500);
    // Completions are counted by the day the job was completed; bookings by the day they were for. Cancelled and junk leads are not counted.
    const { data: doneRows } = await db.from('leads').select('id,status,completed_at').eq('mechanic_id', mechId).eq('status', 'completed').gte('completed_at', dayStartIso(mr.from)).lt('completed_at', dayStartIso(nextDay(mr.to)));
    const bookings = (mon.data ?? []).filter((r: any) => !['lost', 'junk'].includes(r.status)).length, done: any[] = doneRows ?? [];
    const sumT = done.reduce((t, r) => t + (Number(a.totals.get(r.id)) || 0), 0);
    const view = duesView(a.dues, a.rows, a.names);
    return json(req, { ok: true, mechanic: me, date, today, bookings_count: jobs.length, open_count: jobs.filter((j: any) => j.open).length,
      month: { bookings, completions: done.length, avg_ticket: done.length ? Math.round((sumT / done.length) * 100) / 100 : 0 }, cash: { total_due: view.total_due, company_owes: view.company_owes, unsettled_count: view.unsettled.length } });
  }

  if (action === 'status_set') {
    const status = String(b?.status ?? ''); if (!['available', 'busy'].includes(status)) return json(req, { error: 'Choose Available or Busy.' }, 400);
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const lat = num(b?.lat), lng = num(b?.lng), acc = num(b?.acc);
    if (status === 'available' && !selfieFresh(await selfieAt(), now())) return json(req, { error: SELFIE_NEEDED, code: 'selfie' }, 409);
    const r = await rpc('mechanic_status_set', { p_access: who.access_id, p_status: status, p_lat: lat, p_lng: lng, p_acc: acc === null ? null : Math.round(acc) });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error }, 400);
    return json(req, { ok: true, availability: r.availability, located: !!r.located });
  }

  if (action === 'job_link') {
    const id = String(b?.id ?? ''); if (!UUID_RE.test(id)) return json(req, { error: 'This job is not available.' }, 404);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'mechanic_job_open').eq('details->>access', who.access_id).gte('created_at', ago(10));
    if ((count ?? 0) >= 30) return json(req, { error: 'Too many opens. Wait a few minutes.' }, 429);
    await db.from('audit_log').insert({ action: 'mechanic_job_open', details: { access: who.access_id } });
    const r = await rpc('mechanic_open_job', { p_mechanic: mechId, p_lead: id });
    if (!r) return json(req, { error: BAD }, 500);
    if (!r.ok) return json(req, { error: r.error === 'reported' ? 'This job is already reported. Use the link the desk sent you to see its steps.' : 'This job is not available.', code: r.error === 'reported' ? 'reported' : 'gone' }, r.error === 'reported' ? 409 : 404);
    return json(req, { ok: true, url: '/job/?t=' + r.token });
  }

  if (action === 'pay_link') {
    const all = b?.all === true, id = String(b?.id ?? '');
    if (!all && !UUID_RE.test(id)) return json(req, { error: 'This job is not available.' }, 404);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'mechanic_pay_link').eq('details->>mechanic', mechId).gte('created_at', ago(60));
    if ((count ?? 0) >= 10) return json(req, { error: 'Too many payment links. Wait a while, or use the one you already have.' }, 429);
    let a: any; try { a = await account(); } catch (e) { console.error('mechanic-app pay', (e as Error).message); return json(req, { error: BAD }, 500); }
    const target = all ? a.rows[0] : a.rows.find((r: any) => r.lead_id === id);
    if (!target) return json(req, { error: 'Nothing is due here.' }, 404);
    // The amount is the server's own figure from the ledger. Pay all names the oldest unsettled job, and the ledger settles the rest oldest first (the webhook records the remittance exactly as for a desk link).
    const amt = payAmount(all ? a.dues.remitRemaining : target.due_to_platform);
    if (!amt.ok) return json(req, { error: amt.error }, 400);
    const lead = a.leads.find((l: any) => l.id === target.lead_id);
    const { data: mech } = await db.from('mechanics').select('id,name,phone').eq('id', mechId).maybeSingle();
    if (!lead || !mech) return json(req, { error: 'Nothing is due here.' }, 404);
    try {
      const link = await d.createPaymentLink({ amount: amt.amount, ref: lead.ref, leadId: lead.id, name: mech.name, phone: String(mech.phone ?? '').replace(/\D/g, '').slice(-10), description: all ? 'Company share for all unsettled jobs' : `Company share for ${lead.booking_id ? 'booking ' + lead.booking_id : 'a job'}`, notes: { purpose: 'remittance', mechanic_id: mechId } });
      await db.from('audit_log').insert({ action: 'mechanic_pay_link', details: { mechanic: mechId, lead: lead.ref, amount: amt.amount, all } });
      return json(req, { ok: true, url: link.url, amount: amt.amount, all });
    } catch (e) { console.error('mechanic-app pay link', (e as Error).message); return json(req, { error: 'The payment link could not be made. Try again, or ask the desk.' }, 502); }
  }
  return json(req, { error: 'Unknown action' }, 400);
}
