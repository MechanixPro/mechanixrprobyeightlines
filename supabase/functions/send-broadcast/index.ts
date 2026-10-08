// POST /functions/v1/send-broadcast  { subject, headline, body, ctaText, ctaUrl, mode: 'test' | 'send' }
// Owner only. "test" sends one copy to the signed-in owner. "send" emails every customer who asked for offers,
// each with their own unsubscribe link. At most 150 recipients per call.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendEmail } from '../_shared/resend.ts';
import { marketing } from '../_shared/email-templates.ts';
import { cleanBroadcast, isEligible } from '../_shared/broadcast.ts';
import { unsubLinks } from '../_shared/unsub.ts';

const LIMIT = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id,role').eq('user_id', user.id).maybeSingle();
  if (!admin || admin.role !== 'owner') return json(req, { error: 'Only the owner can send offers' }, 403);

  const b = await req.json().catch(() => ({}));
  const v = cleanBroadcast(b);
  if (!v.ok) return json(req, { error: v.error }, 400);
  const siteUrl = env('SITE_URL', 'https://mechanixpro.in'), fnUrl = env('SUPABASE_URL') + '/functions/v1', secret = env('SUPABASE_SERVICE_ROLE_KEY');
  const site = { siteUrl, phoneDisplay: env('PHONE_DISPLAY', '+91 97430 31301'), phoneTel: env('PHONE_TEL', '+919743031301'), whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/919743031301'), email: 'hello@mechanixpro.in' };
  const build = (unsubPage: string) => marketing({ ...site, ...v.value, unsubscribeUrl: unsubPage });

  if (b.mode === 'test') {
    if (!user.email) return json(req, { error: 'Your admin login has no email address' }, 400);
    const m = build(siteUrl + '/unsubscribe/');
    const r = await sendEmail({ to: user.email, subject: '[Test] ' + m.subject, html: m.html, text: m.text, tags: { template: 'marketing_test' } });
    await db.from('email_log').insert({ to_email: user.email, template: 'marketing_test', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    return json(req, r.ok ? { ok: true, sent: 1, to: user.email } : { error: r.skipped ? 'Email is not set up yet' : (r.error ?? 'Could not send') }, r.ok ? 200 : 400);
  }
  if (b.mode !== 'send') return json(req, { error: 'Choose test or send' }, 400);

  const campaign = String(b.campaign ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!campaign) return json(req, { error: 'Missing campaign key' }, 400);
  const { data: done } = await db.from('email_log').select('to_email').eq('campaign', campaign).eq('status', 'sent').limit(5000);
  const already = new Set((done ?? []).map((r: { to_email: string }) => String(r.to_email).toLowerCase()));
  const { data: rows } = await db.from('customers').select('id,email,email_marketing_consent,email_unsubscribed_at,blocked').not('email', 'is', null).eq('email_marketing_consent', true).is('email_unsubscribed_at', null).eq('blocked', false).limit(LIMIT + already.size);
  const people = (rows ?? []).filter(isEligible).filter((c: { email: string }) => !already.has(String(c.email).toLowerCase()));
  let sent = 0, failed = 0;
  for (const c of people.slice(0, LIMIT)) {
    const links = await unsubLinks(c.id, secret, siteUrl, fnUrl);
    const m = build(links.page);
    const r = await sendEmail({ to: c.email, subject: m.subject, html: m.html, text: m.text, unsubscribeUrl: links.oneClick, tags: { template: 'marketing' } });
    await db.from('email_log').insert({ to_email: c.email, template: 'marketing', campaign, status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    if (r.ok) sent++; else failed++;
    await sleep(600);
  }
  await db.from('audit_log').insert({ actor: user.id, action: 'offer_email_sent', details: { subject: v.value.subject, sent, failed } });
  return json(req, { ok: true, sent, failed, more: people.length > LIMIT });
});
