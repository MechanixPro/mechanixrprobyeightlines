// POST /functions/v1/tech-job  { action: 'get' | 'report', t, amount?, note? }
// Public, for the /job/ page the desk sends a technician. The token (t) is the only key: only its SHA-256 hash is stored, it is for one booking, expires and takes one report.
// get: the job (no prices). report: the amount the technician collected; records it in the ledger, works out the company's share and makes its Razorpay link.
import { adminDb, env, json, corsHeaders, sha256Hex as ipHashOf, getSetting } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';
import { sha256Hex, techPct, companyShare, cleanReport } from '../_shared/tech-job.ts';
import { formatWhen } from '../_shared/when.ts';

const NOT_VALID = 'This link is not valid.', EXPIRED = 'This link has expired. Ask the desk for a new one.', DONE = 'This job is already reported.';
const hidesIds = (t: string) => !(/[A-Z]{5}[0-9]{4}[A-Z]/i.test(t) || /[0-9]{12,}/.test(t.replace(/[ -]/g, '')));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await ipHashOf((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'tech_job_hit').eq('details->>ip', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);

  const body = await req.json().catch(() => ({}));
  const action = body?.action === 'report' ? 'report' : 'get';
  const t = String(body?.t ?? '');
  await db.from('audit_log').insert({ action: 'tech_job_hit', details: { ip: ipHash, action } });
  if (!/^[0-9a-f]{64}$/.test(t)) return json(req, { error: NOT_VALID }, 404);

  const { data: link } = await db.from('tech_job_links').select('*').eq('token_hash', await sha256Hex(t)).maybeSingle();
  if (!link) return json(req, { error: NOT_VALID }, 404);
  const done = link.reported_at ? { reported: true, company_share: Number(link.company_share ?? 0), pay_url: link.pay_link_url ?? null } : null;
  if (!done && Date.parse(link.expires_at) <= Date.now()) return json(req, { error: EXPIRED }, 410);

  const { data: lead } = await db.from('leads').select('id,ref,name,phone,area,address,notes,preferred_date,preferred_slot,preferred_time,service_id,bike_id,mechanic_id,job_place,commission_pct,status,deleted_at').eq('id', link.lead_id).maybeSingle();
  if (!lead || lead.deleted_at || lead.mechanic_id !== link.mechanic_id) return json(req, { error: EXPIRED }, 410);

  if (action === 'get') {
    const [svc, bike] = await Promise.all([
      lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.bike_id ? db.from('bikes').select('brand,model,reg_no').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!link.opened_at) await db.from('tech_job_links').update({ opened_at: new Date().toISOString() }).eq('id', link.id);
    const b = bike.data as { brand?: string; model?: string; reg_no?: string } | null;
    return json(req, {
      ref: lead.ref, first_name: String(lead.name ?? '').split(' ')[0], phone: lead.phone, area: lead.area ?? null, address: lead.address ?? null,
      bike: b ? [b.reg_no ? String(b.reg_no).toUpperCase() : '', [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || null : null,
      service: (svc.data as { name?: string } | null)?.name ?? null,
      when: lead.preferred_date ? formatWhen(String(lead.preferred_date), String(lead.preferred_slot ?? ''), lead.preferred_time ?? null) : null,
      notes: lead.notes && hidesIds(String(lead.notes)) ? String(lead.notes).slice(0, 300) : null,
      ...(done ?? { reported: false }),
    });
  }

  if (action === 'report') {
    if (done) return json(req, { error: DONE, ...done }, 409);
    // One report per booking, even if the desk made a new link after an earlier report.
    const { data: earlier } = await db.from('tech_job_links').select('company_share,pay_link_url').eq('lead_id', lead.id).not('reported_at', 'is', null).limit(1).maybeSingle();
    if (earlier) return json(req, { error: DONE, reported: true, company_share: Number(earlier.company_share ?? 0), pay_url: earlier.pay_link_url ?? null }, 409);
    const v = cleanReport(body);
    if (!v.ok) return json(req, { error: v.error }, 400);
    const { amount, note } = v.value;

    const [{ data: mech }, { data: inv }, settings] = await Promise.all([
      db.from('mechanics').select('id,name,phone,payout_rate').eq('id', link.mechanic_id).maybeSingle(),
      db.from('invoices').select('total,taxable').eq('lead_id', lead.id).order('revision', { ascending: false }).limit(1).maybeSingle(),
      Promise.all([getSetting(db, 'doorstep_pct', 30), getSetting(db, 'garage_pct', 30), getSetting(db, 'payout_basis', 'before_gst')]),
    ]);
    const pct = techPct({ lead, mechanic: mech, settings: { doorstep_pct: settings[0], garage_pct: settings[1] } });
    const share = companyShare({ collected: amount, pct, basis: String(settings[2]), invoice: inv as { total: number; taxable: number } | null });

    // Claim the link first so a double tap cannot record twice.
    const now = new Date().toISOString();
    const { data: claimed } = await db.from('tech_job_links').update({ reported_at: now, amount_collected: amount, company_share: share.company }).eq('id', link.id).is('reported_at', null).select('id').maybeSingle();
    if (!claimed) return json(req, { error: DONE }, 409);

    if (amount > 0) {
      const { error } = await db.from('ledger_entries').insert({ entry_type: 'customer_payment', lead_id: lead.id, mechanic_id: link.mechanic_id, amount, collected_by: 'mechanic', method: 'Collected by technician', note: note ?? 'Reported on the job link', source: 'technician' });
      if (error) { console.error('tech-job ledger', error); await db.from('tech_job_links').update({ reported_at: null, amount_collected: null, company_share: null }).eq('id', link.id); return json(req, { error: 'Could not save. Please try again.' }, 500); }
    }
    let payUrl: string | null = null;
    if (share.company >= 1 && mech) {
      try {
        const pl = await createPaymentLink({ amount: share.company, ref: lead.ref, leadId: lead.id, name: mech.name, phone: String(mech.phone ?? '').replace(/\D/g, '').slice(-10), description: `Company share for booking ${lead.ref}`, notes: { purpose: 'remittance', mechanic_id: link.mechanic_id } });
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
