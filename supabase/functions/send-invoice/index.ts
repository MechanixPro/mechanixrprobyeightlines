// POST /functions/v1/send-invoice  { lead_id }  — called from the admin panel by a signed-in admin.
// Emails the customer their invoice (GST split, company details) from booking@mechanixpro.in.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendEmail, FROM_BOOKING } from '../_shared/resend.ts';
import { invoiceEmail } from '../_shared/email-templates.ts';
import { buildInvoice } from '../_shared/invoice.ts';
import { COMPANY } from '../_shared/company.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const { data: lead } = await db.from('leads').select('*').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);
  const { data: cust } = lead.customer_id ? await db.from('customers').select('email').eq('id', lead.customer_id).maybeSingle() : { data: null };
  if (!cust?.email) return json(req, { error: 'This customer did not give an email address' }, 400);
  const { data: services } = await db.from('services').select('id,kind,name,price');
  const invoice = buildInvoice(lead, services ?? []);
  if (!invoice.lines.length) return json(req, { error: 'This booking has no priced items to invoice' }, 400);

  const mail = invoiceEmail({
    siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 97430 31301'), phoneTel: env('PHONE_TEL', '+919743031301'),
    whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/919743031301'), email: 'hello@mechanixpro.in', invoice, company: COMPANY,
  });
  const r = await sendEmail({ to: cust.email, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template: 'invoice' } });
  await db.from('email_log').insert({ lead_id: lead.id, to_email: cust.email, template: 'invoice', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
  await db.from('audit_log').insert({ actor: user.id, action: 'invoice_emailed', details: { lead: lead.ref } });
  return json(req, r.ok ? { ok: true } : { error: r.skipped ? 'Email is not set up yet' : (r.error ?? 'Could not send') }, r.ok ? 200 : 400);
});
