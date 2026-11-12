// POST /functions/v1/desk-payment-link  { lead_id, amount?, send_whatsapp? } — called from the Care Buddy desk by a signed-in team member.
// The database decides who may do this (crm_payment_context). The link is sent from the desk's AiSensy number when it is connected; otherwise the link is returned for the agent to share.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders, rupee } from '../_shared/util.ts';
import { createPaymentLink, paymentsReady } from '../_shared/gateway.ts';
import { sendCampaign } from '../_shared/aisensy-send.ts';
import { slotFee } from '../_shared/checkout.ts';
import { isReturningCustomer } from '../_shared/customer.ts';
import { forBooking, idParam } from '../_shared/booking-id.ts';
import { prepareConfirmationLink, linkText, CALL_SCRIPT } from '../_shared/confirm-link.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));

  // Permission, ownership and status are checked by the database as this person.
  const { data: ctx, error: ce } = await userClient.rpc('crm_payment_context', { p_lead: String(b.lead_id ?? '') });
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : 400);
  const db = adminDb();
  const { data: lead } = await db.from('leads').select('*').eq('id', ctx.lead_id).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);

  // Confirmation fee link (the sales call): the website pay page with the reference filled in. The fee is worked out here from the vehicle and model, never typed.
  if (b.purpose === 'confirm') {
    try {
      const c = await prepareConfirmationLink(db, lead, { email: b.email, actor: user.id });
      const first = String(lead.name).split(' ')[0];
      let sent = false, why: string | null = null;
      if (b.send_whatsapp !== false) {
        if (!env('AISENSY_API_KEY')) why = 'not_connected';
        else { const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: env('AISENSY_CAMPAIGN_PAYMENT', 'mxp_desk_payment_link'), phone: lead.phone, name: lead.name, params: [first, String(c.amount), idParam(lead), c.url], source: 'mechanix-desk' }); sent = r.ok; if (!r.ok) why = r.error ?? 'failed'; }
      }
      await db.from('crm_activities').insert({ lead_id: lead.id, actor: user.id, kind: 'whatsapp', body: `Payment link sent: ₹${c.amount} confirmation fee${sent ? ' on WhatsApp' : ' (created, not sent on WhatsApp)'}${c.review ? '. Fee needs a check: engine size not clear.' : ''}` });
      if (sent) await db.from('messages').insert({ lead_id: lead.id, phone: lead.phone, direction: 'out', sender: 'staff', body: `Confirmation fee link ₹${c.amount}: ${c.url}` });
      if (!lead.crm_first_contact_at && sent) await db.from('leads').update({ crm_first_contact_at: new Date().toISOString() }).eq('id', lead.id);
      await db.from('audit_log').insert({ actor: user.id, action: 'confirm_link_sent', details: { lead: lead.ref, amount: c.amount, sent, review: c.review } });
      return json(req, { ok: true, url: c.url, amount: c.amount, suggested: c.amount, whatsapp_sent: sent, whatsapp_note: why, whatsapp_text: linkText(first, c.amount, c.url), fee_line: c.feeLine, call_script: CALL_SCRIPT(c.amount), review: c.review, has_email: c.hasEmail, nudge_minutes: c.nudgeMinutes });
    } catch (e) { return json(req, { error: (e as Error).message }, 400); }
  }
  if (!paymentsReady()) return json(req, { error: 'Payments are not connected yet' }, 503);

  const { data: fees } = await db.from('services').select('id,price').eq('kind', 'fee').eq('active', true);
  const feeOf = (id: string, d: number) => Number((fees ?? []).find((r) => r.id === id)?.price ?? d);
  const returning = await isReturningCustomer(db, { id: lead.id, phone: lead.phone });
  const suggested = slotFee({ returning, advance: feeOf('advance', 349), newFee: feeOf('newfee', 99) });
  const amount = b.amount == null || b.amount === '' ? suggested : Math.round(Number(b.amount));
  if (!(amount >= 1 && amount <= 100000)) return json(req, { error: 'Amount must be between ₹1 and ₹1,00,000' }, 400);
  const cap = Math.max(suggested, Number(ctx.est_total) || 0);
  if (!ctx.can_override && amount > cap) return json(req, { error: `Amount cannot be more than ${rupee(cap)}. A supervisor can send a higher amount.` }, 400);

  try {
    const reuse = lead.payment_link && Number(lead.amount_due) === amount;
    const link = reuse ? { id: lead.payment_link_id as string, url: lead.payment_link as string }
      : await createPaymentLink({ amount, ref: lead.ref, leadId: lead.id, name: lead.name, phone: lead.phone, description: `Mechanix Pro ${lead.booking_id ? 'booking ' + lead.booking_id : 'slot fee'}` });
    if (!reuse) await db.from('leads').update({ payment_link: link.url, payment_link_id: link.id, amount_due: amount, status: 'payment_sent', followup_step: 2, next_followup_at: new Date(Date.now() + 2 * 3600_000).toISOString() }).eq('id', lead.id);

    const first = String(lead.name).split(' ')[0];
    let sent = false, why: string | null = null;
    if (b.send_whatsapp !== false) {
      if (!env('AISENSY_API_KEY')) why = 'not_connected';
      else {
        const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: env('AISENSY_CAMPAIGN_PAYMENT', 'mxp_desk_payment_link'), phone: lead.phone, name: lead.name, params: [first, String(amount), idParam(lead), link.url], source: 'mechanix-desk' });
        sent = r.ok; if (!r.ok) why = r.error ?? 'failed';
      }
    }
    await db.from('crm_activities').insert({ lead_id: lead.id, actor: user.id, kind: 'whatsapp', body: sent ? `Payment link for ${rupee(amount)} sent on WhatsApp` : `Payment link for ${rupee(amount)} created (not sent on WhatsApp)` });
    if (!lead.crm_first_contact_at && sent) await db.from('leads').update({ crm_first_contact_at: new Date().toISOString() }).eq('id', lead.id);
    if (sent) await db.from('messages').insert({ lead_id: lead.id, phone: lead.phone, direction: 'out', sender: 'staff', body: `Payment link for ${rupee(amount)}: ${link.url}` });
    await db.from('audit_log').insert({ actor: user.id, action: 'desk_payment_link', details: { lead: lead.ref, amount, sent } });
    return json(req, { ok: true, url: link.url, amount, suggested, whatsapp_sent: sent, whatsapp_note: why, whatsapp_text: `Hi ${first}, here is your secure link to pay ${rupee(amount)} for ${forBooking(lead)}: ${link.url}` });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
});
