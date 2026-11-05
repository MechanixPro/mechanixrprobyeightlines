// POST /functions/v1/tech-job  { action: 'get' | 'report', t, amount?, note? }
// Public, for the /job/ page the desk sends a technician. The token (t) is the only key: only its SHA-256 hash is stored, it is for one booking, expires and takes one report.
// get: the job (no prices). report: the amount the technician collected; records it in the ledger, works out the company's share and makes its Razorpay link.
// Pickup jobs also take handover_state (which steps are open: no prices, no customer details), handover_upload_url (signed upload URLs for the photos) and handover_verify (photos + the code the customer gave).
import { adminDb, env, json, corsHeaders, sha256Hex as ipHashOf, getSetting } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';
import { sha256Hex, techPct, companyShare, cleanReport } from '../_shared/tech-job.ts';
import { formatWhen } from '../_shared/when.ts';
import { buildInvoice } from '../_shared/invoice.ts';
import { isKind, isCode, isPickupJob, handoverHash, sameHash, stepState, afterWrongTry, cleanPhotos, cleanUploadRequest, HANDOVER_KINDS, MAX_ATTEMPTS, DOOR_KIND, photoPolicy, allowedStages, doorState, canChooseOutcome } from '../_shared/handover.ts';

const NOT_VALID = 'This link is not valid.', EXPIRED = 'This link has expired. Ask the desk for a new one.', DONE = 'This job is already reported.';
const HANDOVER_ACTIONS = ['handover_state', 'handover_upload_url', 'handover_verify'];
// The visit: on the way, arrived, the customer's door code, then repair at the door or pick-up, ready, delivered. No prices here.
const VISIT_ACTIONS = ['visit_state', 'visit_status', 'visit_start', 'visit_outcome', 'visit_ready', 'visit_deliver'];
const hidesIds = (t: string) => !(/[A-Z]{5}[0-9]{4}[A-Z]/i.test(t) || /[0-9]{12,}/.test(t.replace(/[ -]/g, '')));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const db = adminDb();
  // cf-connecting-ip is set by the edge; the first x-forwarded-for entry is the client's own claim, so use the last one the proxy appended.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  const ipHash = await ipHashOf((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'tech_job_hit').eq('details->>ip', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);

  const body = await req.json().catch(() => ({}));
  const action = body?.action === 'report' ? 'report' : HANDOVER_ACTIONS.includes(body?.action) || VISIT_ACTIONS.includes(body?.action) ? String(body.action) : 'get';
  const t = String(body?.t ?? '');
  if (!/^[0-9a-f]{64}$/.test(t)) { await db.from('audit_log').insert({ action: 'tech_job_hit', details: { ip: ipHash, action } }); return json(req, { error: NOT_VALID }, 404); }
  const tokHash = await sha256Hex(t), tok16 = tokHash.slice(0, 16);
  const { count: perTok } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'tech_job_hit').eq('details->>tok', tok16).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((perTok ?? 0) >= 30) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);
  await db.from('audit_log').insert({ action: 'tech_job_hit', details: { ip: ipHash, tok: tok16, action } });

  const { data: link } = await db.from('tech_job_links').select('*').eq('token_hash', tokHash).maybeSingle();
  if (!link) return json(req, { error: NOT_VALID }, 404);
  const { data: lead } = await db.from('leads').select('*').eq('id', link.lead_id).maybeSingle();
  if (!lead || lead.deleted_at || lead.status === 'lost' || lead.mechanic_id !== link.mechanic_id) return json(req, { error: EXPIRED }, 410);
  // The handover steps work on the same link, and the return step comes after the job is reported, so they look at the link's own life (7 days, or 30 after the report) instead of the report.
  if (HANDOVER_ACTIONS.includes(action) || VISIT_ACTIONS.includes(action)) {
    if (Date.parse(link.reported_at ?? link.expires_at) + (link.reported_at ? 30 * 864e5 : 0) <= Date.now()) return json(req, { error: EXPIRED }, 410);
    return VISIT_ACTIONS.includes(action) ? await visit(req, db, link, lead, action, body) : await handover(req, db, link, lead, action, body);
  }
  // Once reported, the link shows only the payment (for 30 more days), never the customer's details.
  if (link.reported_at) {
    if (Date.parse(link.reported_at) + 30 * 864e5 <= Date.now()) return json(req, { error: EXPIRED }, 410);
    const done = { booking_id: lead.booking_id ?? null, reported: true, company_share: Number(link.company_share ?? 0), pay_url: link.pay_link_url ?? null };
    return action === 'report' ? json(req, { error: DONE, ...done }, 409) : json(req, done);
  }
  if (Date.parse(link.expires_at) <= Date.now()) return json(req, { error: EXPIRED }, 410);

  if (action === 'get') {
    const [svc, bike] = await Promise.all([
      lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.bike_id ? db.from('bikes').select('brand,model,reg_no').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!link.opened_at) await db.from('tech_job_links').update({ opened_at: new Date().toISOString() }).eq('id', link.id);
    const b = bike.data as { brand?: string; model?: string; reg_no?: string } | null;
    return json(req, {
      booking_id: lead.booking_id ?? null, first_name: String(lead.name ?? '').split(' ')[0], phone: lead.phone, area: lead.area ?? null, address: lead.address ?? null,
      bike: b ? [b.reg_no ? String(b.reg_no).toUpperCase() : '', [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || null : null,
      service: (svc.data as { name?: string } | null)?.name ?? null,
      when: lead.preferred_date ? formatWhen(String(lead.preferred_date), String(lead.preferred_slot ?? ''), lead.preferred_time ?? null) : null,
      notes: lead.notes && hidesIds(String(lead.notes)) ? String(lead.notes).slice(0, 300) : null,
      reported: false,
    });
  }

  if (action === 'report') {
    // One report per booking, even if the desk made a new link after an earlier report.
    const { data: earlier } = await db.from('tech_job_links').select('company_share,pay_link_url').eq('lead_id', lead.id).not('reported_at', 'is', null).limit(1).maybeSingle();
    if (earlier) return json(req, { error: DONE, reported: true, company_share: Number(earlier.company_share ?? 0), pay_url: earlier.pay_link_url ?? null }, 409);
    const v = cleanReport(body);
    if (!v.ok) return json(req, { error: v.error }, 400);
    const { amount, note } = v.value;

    const [{ data: mech }, { data: inv }, { data: services }, { data: bike }, settings] = await Promise.all([
      db.from('mechanics').select('id,name,phone,payout_rate').eq('id', link.mechanic_id).maybeSingle(),
      db.from('invoices').select('total,taxable,mechanic_id,mechanic_rate').eq('lead_id', lead.id).is('voided_at', null).order('revision', { ascending: false }).limit(1).maybeSingle(),
      db.from('services').select('id,kind,name,price'),
      lead.bike_id ? db.from('bikes').select('big_bike,engine_class').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
      Promise.all([getSetting(db, 'doorstep_pct', 30), getSetting(db, 'garage_pct', 30)]),
    ]);
    // The same split the admin ledger uses: the saved invoice if there is one (with its own technician rate), else the booking's bill, built like the invoice.
    let bill: { total: number; taxable: number } | null = inv ? { total: Number(inv.total), taxable: Number(inv.taxable) } : null;
    if (!bill) { try { const b = buildInvoice({ ...lead, big_bike: (bike as any)?.big_bike ?? false, engine_class: (bike as any)?.engine_class ?? null }, (services ?? []) as any); if (b.total > 0) bill = { total: b.total, taxable: b.taxable }; } catch (e) { bill = null; } }
    // With no bill at all, the amount collected is treated as including 18% GST, the invoice default.
    if (!bill && amount > 0) bill = { total: amount, taxable: Math.round((amount / 1.18) * 100) / 100 };
    const pct = inv && inv.mechanic_id ? Number(inv.mechanic_rate) || 0 : techPct({ lead, mechanic: mech, settings: { doorstep_pct: settings[0], garage_pct: settings[1] } });
    const share = companyShare({ collected: amount, pct, adjust: Number(lead.commission_adjust) || 0, bill });

    // Claim the link first so a double tap cannot record twice.
    const now = new Date().toISOString();
    // A unique index allows one reported link per booking, so two links reported at once cannot both record.
    const { data: claimed, error: claimErr } = await db.from('tech_job_links').update({ reported_at: now, amount_collected: amount, company_share: share.company }).eq('id', link.id).is('reported_at', null).select('id').maybeSingle();
    if (claimErr && claimErr.code === '23505') return json(req, { error: DONE }, 409);
    if (claimErr) { console.error('tech-job claim', claimErr); return json(req, { error: 'Could not save. Please try again.' }, 500); }
    if (!claimed) return json(req, { error: DONE }, 409);

    if (amount > 0) {
      const { error } = await db.from('ledger_entries').insert({ entry_type: 'customer_payment', lead_id: lead.id, mechanic_id: link.mechanic_id, amount, collected_by: 'mechanic', method: 'Collected by technician', note: note ?? 'Reported on the job link', source: 'technician' });
      if (error) { console.error('tech-job ledger', error); await db.from('tech_job_links').update({ reported_at: null, amount_collected: null, company_share: null }).eq('id', link.id); return json(req, { error: 'Could not save. Please try again.' }, 500); }
    }
    let payUrl: string | null = null;
    if (share.company >= 1 && mech) {
      try {
        const pl = await createPaymentLink({ amount: share.company, ref: lead.ref, leadId: lead.id, name: mech.name, phone: String(mech.phone ?? '').replace(/\D/g, '').slice(-10), description: `Company share for ${lead.booking_id ? 'booking ' + lead.booking_id : 'a job'}`, notes: { purpose: 'remittance', mechanic_id: link.mechanic_id } });
        payUrl = pl.url;
        await db.from('tech_job_links').update({ pay_link_url: payUrl }).eq('id', link.id);
      } catch (e) { console.error('tech-job pay link', (e as Error).message); }
    }
    const rs = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `Technician reported ${rs(amount)} collected. Company share ${rs(share.company)}.${note ? ' Note: ' + note : ''}${share.company >= 1 && !payUrl ? ' The payment link could not be made; send one from the admin.' : ''}` }).then(() => {}, () => {});
    await db.from('audit_log').insert({ action: 'tech_job_reported', details: { lead: lead.ref, amount, company_share: share.company, pct } });
    return json(req, { ok: true, reported: true, company_share: share.company, pay_url: payUrl });
  }
  return json(req, { error: NOT_VALID }, 400);
});

// ---------- OTP handover and photos (pickup jobs) ----------
const HANDOVER_ERR = 'Could not save. Please try again.';
async function handover(req: Request, db: ReturnType<typeof adminDb>, link: any, lead: any, action: string, body: any): Promise<Response> {
  if (!isPickupJob(lead)) return json(req, { pickup: false, steps: [] }, action === 'handover_state' ? 200 : 400);
  const { data: rows } = await db.from('handovers').select('id,kind,code_hash,code_expires_at,attempts,locked_at,verified_at,photo_paths,created_at').eq('lead_id', lead.id).order('created_at', { ascending: false });
  const all = rows ?? [];
  const pol = photoPolicy(lead.vehicle), doorOk = canChooseOutcome(all);
  // After the door code is verified, the pickup needs the photos only (the customer already gave the code at the door): its step is open with no code.
  const stepOf = (k: 'pickup' | 'return') => { const st = stepState(all, k); return k === 'pickup' && st.state !== 'verified' && doorOk ? { ...st, state: 'open', code_needed: false } : { ...st, code_needed: true }; };
  if (action === 'handover_state') return json(req, { pickup: true, booking_id: lead.booking_id ?? null, vehicle: lead.vehicle === 'car' ? 'car' : 'bike', photos: { min: pol.min, labels: pol.labels, hint: pol.hint }, steps: HANDOVER_KINDS.map((k) => stepOf(k)) });

  const kind = body?.kind;
  if (!isKind(kind)) return json(req, { error: 'Choose pickup or return.' }, 400);
  const step = stepOf(kind);
  if (step.state === 'verified') return json(req, { error: kind === 'pickup' ? 'The pickup is already verified.' : 'The return is already verified.' }, 409);
  if (step.state === 'waiting') return json(req, { error: 'Verify the pickup first.' }, 409);
  if (step.state === 'locked') return json(req, { error: 'Too many wrong codes. The desk will send a new code.' }, 423);
  if (step.state === 'no_code') return json(req, { error: 'The desk has not sent a code yet. Ask the desk.' }, 409);
  if (step.state === 'expired') return json(req, { error: 'The code has expired. Ask the desk for a new one.' }, 410);
  const row = all.find((r) => r.kind === kind) ?? null;
  const noCode = kind === 'pickup' && doorOk && !step.code_needed;

  if (action === 'handover_upload_url') {
    const v = cleanUploadRequest(body);
    if (!v.ok) return json(req, { error: v.error }, 400);
    const uploads: { path: string; url: string }[] = [];
    for (const ext of v.value) {
      const path = `${lead.id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from('handover').createSignedUploadUrl(path);
      if (error || !data) { console.error('tech-job upload url', error); return json(req, { error: HANDOVER_ERR }, 500); }
      uploads.push({ path, url: data.signedUrl });
    }
    return json(req, { uploads });
  }

  // handover_verify: photos first (a photo problem does not use up a try), then the code (not needed for a pickup once the door code is verified).
  if (!noCode && !isCode(body?.code)) return json(req, { error: 'Enter the 4-digit code.' }, 400);
  const photos = cleanPhotos(body?.photos, lead.id, kind, pol.min, pol.hint);
  if (!photos.ok) return json(req, { error: photos.error }, 400);
  const { data: files } = await db.storage.from('handover').list(`${lead.id}/${kind}`, { limit: 200 });
  const there = new Set((files ?? []).map((f: { name: string }) => `${lead.id}/${kind}/${f.name}`));
  if (!photos.value.every((p) => there.has(p))) return json(req, { error: 'A photo did not upload. Take it again.' }, 400);

  if (noCode) {
    // No work before approval: a pickup is the start of the workshop job, so the quote must be approved first (the database enforces the same).
    const { data: latest } = await db.from('job_quotes').select('status').eq('lead_id', lead.id).in('status', ['sent', 'approved']).order('version', { ascending: false }).limit(1).maybeSingle();
    if (lead.confirm_fee != null && latest?.status !== 'approved') return json(req, { error: 'The customer has not approved the quote yet. Ask the desk to record a phone approval.', blocked: 'quote' }, 409);
    const now0 = new Date().toISOString();
    const { error: e0 } = await db.from('handovers').insert({ lead_id: lead.id, kind: 'pickup', code_hash: 'door-verified', code_expires_at: now0, verified_at: now0, mechanic_id: link.mechanic_id, photo_paths: photos.value });
    if (e0 && e0.code === '23505') return json(req, { error: 'This handover is already verified.' }, 409);
    if (e0) { console.error('tech-job pickup', e0); return json(req, { error: HANDOVER_ERR }, 500); }
    const { error: e1 } = await db.from('leads').update({ visit_stage: 'picked_up', visit_stage_at: now0, job_place: 'garage' }).eq('id', lead.id);
    if (e1) { console.error('tech-job stage', e1); return json(req, { error: 'The customer has not approved the quote yet.', blocked: 'quote' }, 409); }
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `Pickup verified (door code already verified), ${photos.value.length} photos. Picked up for the workshop.` }).then(() => {}, () => {});
    await db.from('audit_log').insert({ action: 'handover_verified', details: { lead: lead.ref, kind, photos: photos.value.length, mechanic: link.mechanic_id, via: 'door_code' } });
    return json(req, { ok: true, kind, verified_at: now0, photos: photos.value.length });
  }
  if (!row) return json(req, { error: 'The desk has not sent a code yet. Ask the desk.' }, 409);
  // Count the try before comparing, so two quick requests cannot both get a free guess.
  const { data: tried } = await db.from('handovers').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts).is('verified_at', null).is('locked_at', null).select('id').maybeSingle();
  if (!tried) return json(req, { error: 'Please try again.' }, 409);
  const ok = sameHash(await handoverHash(row.id, String(body.code)), row.code_hash);
  if (!ok) {
    const w = afterWrongTry(row.attempts);
    if (w.locked) {
      await db.from('handovers').update({ locked_at: new Date().toISOString() }).eq('id', row.id);
      await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `The ${kind} code was entered wrong ${MAX_ATTEMPTS} times and is locked. Send a new code.` }).then(() => {}, () => {});
      await db.from('audit_log').insert({ action: 'handover_locked', details: { lead: lead.ref, kind } });
      return json(req, { error: 'Too many wrong codes. The desk will send a new code.', locked: true }, 423);
    }
    return json(req, { error: `That code is not right. ${w.left} ${w.left === 1 ? 'try' : 'tries'} left.`, left: w.left }, 400);
  }

  const now = new Date().toISOString();
  const { data: done, error: err } = await db.from('handovers').update({ verified_at: now, mechanic_id: link.mechanic_id, photo_paths: photos.value }).eq('id', row.id).is('verified_at', null).select('id').maybeSingle();
  if (err && err.code === '23505') return json(req, { error: 'This handover is already verified.' }, 409);
  if (err) { console.error('tech-job handover', err); return json(req, { error: HANDOVER_ERR }, 500); }
  if (!done) return json(req, { error: 'This handover is already verified.' }, 409);
  const { data: mech } = await db.from('mechanics').select('name').eq('id', link.mechanic_id).maybeSingle();
  const name = (mech as { name?: string } | null)?.name ?? 'the technician';
  const label = kind === 'pickup' ? 'Pickup' : 'Return';
  await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `${label} verified by ${name}, ${photos.value.length} photos.` }).then(() => {}, () => {});
  await db.from('audit_log').insert({ action: 'handover_verified', details: { lead: lead.ref, kind, photos: photos.value.length, mechanic: link.mechanic_id } });
  // The visit stage follows the handover: a verified return is "Delivered", a verified pickup is "Picked up" (the quote gate in the database applies).
  if (lead.confirm_fee != null) {
    const to = kind === 'return' ? 'returned' : 'picked_up';
    const { error: se } = await db.from('leads').update({ visit_stage: to, visit_stage_at: now }).eq('id', lead.id);
    if (se && kind === 'pickup') return json(req, { error: 'The customer has not approved the quote yet. Ask the desk to record a phone approval.', blocked: 'quote' }, 409);
  }
  return json(req, { ok: true, kind, verified_at: now, photos: photos.value.length });
}

// ---------- The visit (every job, bike and car) ----------
async function visit(req: Request, db: ReturnType<typeof adminDb>, link: any, lead: any, action: string, body: any): Promise<Response> {
  const [{ data: rows }, { data: q }, { data: mech }] = await Promise.all([
    db.from('handovers').select('id,kind,code_hash,code_expires_at,attempts,locked_at,verified_at,photo_paths,created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    db.from('job_quotes').select('status,version,eta_text').eq('lead_id', lead.id).in('status', ['sent', 'approved', 'declined']).order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('mechanics').select('name').eq('id', link.mechanic_id).maybeSingle(),
  ]);
  const all = rows ?? [], stage = lead.visit_stage ?? null, door = doorState(all), pol = photoPolicy(lead.vehicle), approved = q?.status === 'approved';
  const paid = lead.confirm_fee == null || !!lead.confirm_paid_at;
  const set = async (to: string, line: string, extra: Record<string, unknown> = {}) => {
    const now = new Date().toISOString();
    const upd = db.from('leads').update({ visit_stage: to, visit_stage_at: now, ...extra }).eq('id', lead.id);
    const { data: ok, error } = await (stage ? upd.eq('visit_stage', stage) : upd.is('visit_stage', null)).select('id').maybeSingle();   // only from the stage we read: a double tap changes nothing
    if (error) { console.error('tech-job visit stage', error); return json(req, { error: /approved/.test(error.message) ? 'Start work is blocked: the customer has not approved the quote yet.' : HANDOVER_ERR, blocked: /approved/.test(error.message) ? 'quote' : undefined }, /approved/.test(error.message) ? 409 : 500); }
    if (!ok) return json(req, { error: 'This step was already done. Reload the page.' }, 409);
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: line.replace('{who}', (mech as { name?: string } | null)?.name?.split(' ')[0] ?? 'The mechanic') }).then(() => {}, () => {});
    await db.from('audit_log').insert({ action: 'visit_' + to, details: { lead: lead.ref, mechanic: link.mechanic_id } });
    return json(req, { ok: true, stage: to });
  };
  if (action === 'visit_state') {
    return json(req, { vehicle: lead.vehicle === 'car' ? 'car' : 'bike', paid, stage, door, next: allowedStages(stage).filter((x) => x !== 'repair_doorstep' && x !== 'picked_up'),
      quote: q ? { status: q.status, version: q.version, eta_text: q.eta_text } : null, can_start_work: stage === 'started' && approved, place: lead.job_place === 'garage' ? 'garage' : 'doorstep',
      photos: { min: pol.min, labels: pol.labels, hint: pol.hint }, first_name: String(lead.name ?? '').split(' ')[0], address: lead.address ?? null, area: lead.area ?? null, pincode: lead.pincode ?? null });
  }
  if (!paid) return json(req, { error: 'This booking is not paid yet. Ask the desk.' }, 409);
  if (action === 'visit_status') {
    const to = String(body?.stage ?? '');
    if (!['on_the_way', 'arrived'].includes(to) || !allowedStages(stage).includes(to)) return json(req, { error: 'That step is not available now.' }, 409);
    return await set(to, to === 'on_the_way' ? '{who} is on the way.' : '{who} has arrived.');
  }
  if (action === 'visit_start') {
    if (['started', 'repair_doorstep', 'picked_up', 'ready', 'returned'].includes(stage ?? '') || door === 'verified') return json(req, { error: 'The job has already started.' }, 409);
    if (!isCode(body?.code)) return json(req, { error: 'Enter the 4-digit code.' }, 400);
    if (door === 'none') return json(req, { error: 'The customer has no code yet. Ask the desk to send one.' }, 409);
    if (door === 'locked') return json(req, { error: 'Too many wrong codes. The desk will send a new code.' }, 423);
    if (door === 'expired') return json(req, { error: 'The code has expired. Ask the desk for a new one.' }, 410);
    const row = all.find((r) => r.kind === DOOR_KIND)!;
    // Count the try before comparing, so two quick requests cannot both get a free guess.
    const { data: tried } = await db.from('handovers').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts).is('verified_at', null).is('locked_at', null).select('id').maybeSingle();
    if (!tried) return json(req, { error: 'Please try again.' }, 409);
    if (!sameHash(await handoverHash(row.id, String(body.code)), row.code_hash)) {
      const w = afterWrongTry(row.attempts);
      if (w.locked) {
        await db.from('handovers').update({ locked_at: new Date().toISOString() }).eq('id', row.id);
        await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `The door code was entered wrong ${MAX_ATTEMPTS} times and is locked. Send a new code.` }).then(() => {}, () => {});
        await db.from('audit_log').insert({ action: 'handover_locked', details: { lead: lead.ref, kind: DOOR_KIND } });
        return json(req, { error: 'Too many wrong codes. The desk will send a new code.', locked: true }, 423);
      }
      return json(req, { error: `That code is not right. ${w.left} ${w.left === 1 ? 'try' : 'tries'} left.`, left: w.left }, 400);
    }
    const now = new Date().toISOString();
    const { data: done, error } = await db.from('handovers').update({ verified_at: now, mechanic_id: link.mechanic_id }).eq('id', row.id).is('verified_at', null).select('id').maybeSingle();
    if (error && error.code === '23505') return json(req, { error: 'The job has already started.' }, 409);
    if (error || !done) { console.error('tech-job start', error); return json(req, { error: HANDOVER_ERR }, error ? 500 : 409); }
    await db.from('leads').update({ visit_stage: 'started', visit_stage_at: now }).eq('id', lead.id);
    await db.from('booking_secrets').update({ door_code: null }).eq('lead_id', lead.id);   // the code is spent: it is no longer shown anywhere
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: 'Door code verified. Job started.' }).then(() => {}, () => {});
    await db.from('audit_log').insert({ action: 'door_code_verified', details: { lead: lead.ref, mechanic: link.mechanic_id } });
    return json(req, { ok: true, stage: 'started' });
  }
  if (action === 'visit_outcome') {
    const o = String(body?.outcome ?? '');
    if (!['repair_doorstep', 'pickup'].includes(o)) return json(req, { error: 'Choose repair at the door or pick-up.' }, 400);
    if (stage !== 'started') return json(req, { error: stage ? 'The outcome is already set.' : 'Enter the customer\'s code first.' }, 409);
    // No work before approval. The database trigger enforces the same.
    if (lead.confirm_fee != null && !approved) return json(req, { error: q?.status === 'declined' ? 'The customer declined the quote. Do not start. Ask the desk.' : q ? 'Start work is blocked: the customer has not approved the quote yet. Ask the desk to record a phone approval.' : 'Start work is blocked: there is no approved quote yet. Ask the desk to send the quote.', blocked: 'quote' }, 409);
    if (o === 'pickup') { await db.from('leads').update({ job_place: 'garage' }).eq('id', lead.id); return json(req, { ok: true, stage: 'started', pickup: true }); }   // the pickup photos step now opens; the stage moves when they are verified
    return await set('repair_doorstep', '{who} started the repair at the customer\'s place (quote approved).', { job_place: 'doorstep' });
  }
  if (action === 'visit_ready') {
    if (!['repair_doorstep', 'picked_up'].includes(stage ?? '')) return json(req, { error: 'Mark ready after the work has started.' }, 409);
    return await set('ready', 'Vehicle ready.');
  }
  if (action === 'visit_deliver') {
    if (stage !== 'ready') return json(req, { error: 'Mark ready first.' }, 409);
    if (lead.job_place === 'garage') return json(req, { error: 'A pickup job is delivered with the return code and photos.' }, 409);
    return await set('returned', 'Vehicle handed back to the customer.');
  }
  return json(req, { error: NOT_VALID }, 400);
}
