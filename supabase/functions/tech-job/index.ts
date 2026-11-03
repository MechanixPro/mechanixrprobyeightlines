// POST /functions/v1/tech-job  { action: 'get' | 'report', t, amount?, note? }
// Public, for the /job/ page the desk sends a technician. The token (t) is the only key: only its SHA-256 hash is stored, it is for one booking, expires and takes one report.
// get: the job (no prices). report: the amount the technician collected; records it in the ledger, works out the company's share and makes its Razorpay link.
import { adminDb, env, json, corsHeaders, sha256Hex as ipHashOf, getSetting } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';
import { sha256Hex, techPct, companyShare, cleanReport } from '../_shared/tech-job.ts';
import { formatWhen } from '../_shared/when.ts';
import { buildInvoice } from '../_shared/invoice.ts';

const NOT_VALID = 'This link is not valid.', EXPIRED = 'This link has expired. Ask the desk for a new one.', DONE = 'This job is already reported.';
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
  const action = body?.action === 'report' ? 'report' : 'get';
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
  // Once reported, the link shows only the payment (for 30 more days), never the customer's details.
  if (link.reported_at) {
    if (Date.parse(link.reported_at) + 30 * 864e5 <= Date.now()) return json(req, { error: EXPIRED }, 410);
    const done = { ref: lead.ref, reported: true, company_share: Number(link.company_share ?? 0), pay_url: link.pay_link_url ?? null };
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
      ref: lead.ref, first_name: String(lead.name ?? '').split(' ')[0], phone: lead.phone, area: lead.area ?? null, address: lead.address ?? null,
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
