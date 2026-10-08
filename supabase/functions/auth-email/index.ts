// POST /functions/v1/auth-email  — called by Supabase Auth (the "Send Email" hook), never by browsers.
// Sends the admin login code through Resend from no-reply@mechanixpro.in. The code is never stored or logged.
import { adminDb, env } from '../_shared/util.ts';
import { sendEmail } from '../_shared/resend.ts';
import { verifyWebhook, loginMailFor, type HookPayload } from '../_shared/auth-hook.ts';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: { http_code: 405, message: 'Method not allowed' } });
  const raw = await req.text();
  const ok = await verifyWebhook(env('SEND_EMAIL_HOOK_SECRET'), { id: req.headers.get('webhook-id') ?? '', timestamp: req.headers.get('webhook-timestamp') ?? '', signature: req.headers.get('webhook-signature') ?? '' }, raw);
  if (!ok) return reply(401, { error: { http_code: 401, message: 'Invalid signature' } });

  let payload: HookPayload;
  try { payload = JSON.parse(raw); } catch { return reply(400, { error: { http_code: 400, message: 'Bad request' } }); }
  const mail = loginMailFor(payload, {
    siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 97430 31301'), phoneTel: env('PHONE_TEL', '+919743031301'),
    whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/919743031301'), email: 'hello@mechanixpro.in',
  });
  if (!mail) return reply(400, { error: { http_code: 400, message: 'Nothing to send' } });

  const r = await sendEmail({ to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, tags: { template: 'login_code' } });
  try { await adminDb().from('email_log').insert({ to_email: mail.to, template: 'login_code', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null }); } catch { /* the log must never block a login */ }
  if (!r.ok) { console.error('login mail failed'); return reply(500, { error: { http_code: 500, message: 'Could not send the login email' } }); }
  return reply(200, {});
});
