// POST /functions/v1/booking-notify  { action, lead_id, ... } — called from Crew or the Admin by a signed-in team member. The database decides who may (crm_quote_send, crm_quote_eta, crm_resend_guard: every admin, plus the Crew roles that may assign the technician).
//   action 'quote_send'  { lead_id }                         marks the saved quote as sent (RPC), then emails it and sends the "Quote ready" WhatsApp. A revised quote (version 2+) says so.
//   action 'eta'         { lead_id, eta: {kind, hours|date, window} }   changes the delivery estimate (RPC) and tells the customer once per change.
//   action 'delivery_update' { lead_id, stage: 'ready'|'delivered' }   after crm_delivery_set: emails and WhatsApps the customer once per stage (any desk user who can see the booking).
//   action 'approval_notice' { lead_id }   after an approval (crm_quote_admin_approve): tells the customer (email and WhatsApp) and the assigned garage, once per quote version.
//   action 'estimate_rejected' { lead_id, estimate_id }   after crm_garage_estimate_review rejected: WhatsApp notice to the garage.
//   action 'resend'      { lead_id, kind, n? }               forced resend of one logged message (confirmation email, receipt, WhatsApp, team alert, quote email or WhatsApp).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { resendKind, sendQuoteMessages, sendEtaMessages, sendOnTheWay, sendDeliveryUpdate, sendApprovalNotice, notifyGarageEstimateRejected } from '../_shared/after-payment.ts';
import { type Kind } from '../_shared/notify.ts';

const RESENDABLE = ['confirm_email', 'receipt_email', 'confirm_whatsapp', 'team_paid', 'quote_email', 'quote_whatsapp', 'eta_email', 'ontheway_email', 'delivery_ready_email', 'delivery_ready_whatsapp', 'delivery_done_email', 'delivery_done_whatsapp', 'approval_email', 'approval_whatsapp'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const leadId = String(b.lead_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return json(req, { error: 'Booking not found' }, 404);
  const db = adminDb();
  const fail = (e: { message: string; code?: string }) => json(req, { error: e.message }, e.code === '42501' ? 403 : 400);

  if (b.action === 'quote_send') {
    const { data, error } = await userClient.rpc('crm_quote_send', { p_lead: leadId });
    if (error) return fail(error);
    const sent = await sendQuoteMessages(db, leadId, data.version, data.version > 1);
    return json(req, { ok: true, version: data.version, sent });
  }
  if (b.action === 'eta') {
    const { data, error } = await userClient.rpc('crm_quote_eta', { p_lead: leadId, p_eta: b.eta ?? {} });
    if (error) return fail(error);
    const sent = data.changed ? await sendEtaMessages(db, leadId, data.eta_rev) : {};
    return json(req, { ok: true, changed: data.changed, eta_text: data.eta_text, sent });
  }
  if (b.action === 'delivery_update' || b.action === 'approval_notice' || b.action === 'estimate_rejected') {
    const { error } = await userClient.rpc('crm_booking_state', { p_lead: leadId });   // the database decides: a desk user who may see this booking
    if (error) return fail(error);
    if (b.action === 'delivery_update') {
      const stage = String(b.stage ?? '');
      if (stage !== 'ready' && stage !== 'delivered') return json(req, { error: 'Choose ready or delivered.' }, 400);
      const sent = await sendDeliveryUpdate(db, leadId, stage);
      return sent.error ? json(req, { error: sent.error }, 409) : json(req, { ok: true, sent });
    }
    if (b.action === 'approval_notice') {
      const sent = await sendApprovalNotice(db, leadId);
      return sent.error ? json(req, { error: sent.error }, 409) : json(req, { ok: true, sent });
    }
    const eid = String(b.estimate_id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(eid)) return json(req, { error: 'Estimate not found' }, 404);
    return json(req, { ok: true, result: await notifyGarageEstimateRejected(db, leadId, eid) });
  }
  if (b.action === 'resend') {
    const kind = String(b.kind ?? ''), n = Number.isInteger(b.n) && b.n > 0 ? b.n : null;
    if (!RESENDABLE.includes(kind)) return json(req, { error: 'This message cannot be resent.' }, 400);
    const { error } = await userClient.rpc('crm_resend_guard', { p_lead: leadId });
    if (error) return fail(error);
    await db.from('audit_log').insert({ actor: user.id, action: 'notification_resend', details: { lead: leadId, kind, n } });
    if (kind === 'quote_email' || kind === 'quote_whatsapp') { if (!n) return json(req, { error: 'Which quote version?' }, 400); const r = await sendQuoteMessages(db, leadId, n, n > 1, true, kind as 'quote_email' | 'quote_whatsapp'); return json(req, { ok: true, result: r[`${kind}:${n}`] ?? r }); }
    if (kind === 'eta_email') { if (!n) return json(req, { error: 'Which update?' }, 400); const r = await sendEtaMessages(db, leadId, n, true); return json(req, { ok: true, result: r }); }
    if (kind.startsWith('delivery_')) return json(req, { ok: true, result: await sendDeliveryUpdate(db, leadId, kind.startsWith('delivery_ready') ? 'ready' : 'delivered', true) });
    if (kind.startsWith('approval_')) return json(req, { ok: true, result: await sendApprovalNotice(db, leadId, true) });
    if (kind === 'ontheway_email') return json(req, { ok: true, result: await sendOnTheWay(db, leadId, true) });
    return json(req, { ok: true, result: await resendKind(db, leadId, kind as Kind) });
  }
  return json(req, { error: 'Unknown action' }, 400);
});
