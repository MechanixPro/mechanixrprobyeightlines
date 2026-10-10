// POST /functions/v1/payment-link  { lead_id, amount }  — called from the admin panel by a signed-in admin.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders, rupee } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';
import { sendSmart, TPL } from '../_shared/whatsapp.ts';
import { paymentLinkEmail } from '../_shared/email-templates.ts';
import { sendEmail, FROM_BOOKING } from '../_shared/resend.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  // Verify the caller is a signed-in admin.
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id,name').eq('user_id', user.id).maybeSingle();
  if (!admin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount));
  if (!(amount >= 1 && amount <= 100000)) return json(req, { error: 'Amount must be between ₹1 and ₹1,00,000' }, 400);
  const { data: lead } = await db.from('leads').select('*').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);

  try {
    const link = await createPaymentLink({ amount, ref: lead.ref, leadId: lead.id, name: lead.name, phone: lead.phone, description: `Mechanix Pro booking ${lead.ref}` });
    await db.from('leads').update({ payment_link: link.url, payment_link_id: link.id, amount_due: amount, status: 'payment_sent', followup_step: 2, next_followup_at: new Date(Date.now() + 2 * 3600_000).toISOString() }).eq('id', lead.id);
    const first = String(lead.name).split(' ')[0];
    const sent = b.send_whatsapp === false ? null : await sendSmart(db, lead, `Hi ${first}, here is your secure link to pay ${rupee(amount)} for booking ${lead.ref}: ${link.url}`, { name: TPL.payment(), params: [first, String(amount), lead.ref, link.url] }, 'staff');
    // Email the link too when the customer gave an address. A failure here never blocks the link.
    let emailed = false, hasEmail = false;
    try {
      const { data: cust } = lead.customer_id ? await db.from('customers').select('email').eq('id', lead.customer_id).maybeSingle() : { data: null };
      if (cust?.email) {
        hasEmail = true;
        const mail = paymentLinkEmail({ siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 83106 21498'), phoneTel: env('PHONE_TEL', '+918310621498'),
          whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918310621498'), email: 'hello@mechanixpro.in', name: lead.name, ref: lead.ref, amount, payUrl: link.url });
        const r = await sendEmail({ to: cust.email, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template: 'payment_link' } });
        await db.from('email_log').insert({ lead_id: lead.id, to_email: cust.email, template: 'payment_link', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
        emailed = r.ok;
      }
    } catch (e) { console.error('payment link email', e); }
    await db.from('audit_log').insert({ actor: user.id, action: 'payment_link_created', details: { lead: lead.ref, amount } });
    return json(req, { ok: true, url: link.url, whatsapp_sent: !!sent, emailed, has_email: hasEmail });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
});
