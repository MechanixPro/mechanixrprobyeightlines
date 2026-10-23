// Supabase Auth "Send Email" hook: Auth calls our function instead of an SMTP server, and we send the login code through Resend.
// Messages are signed with the Standard Webhooks scheme; we check the signature before doing anything.
import { passwordReset, type Site } from './email-templates.ts';

const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function verifyWebhook(secret: string, h: { id: string; timestamp: string; signature: string }, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  try {
    if (!secret || !h.id || !h.timestamp || !h.signature) return false;
    const ts = Number(h.timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
    const key = await crypto.subtle.importKey('raw', unb64(secret.replace(/^v1,/, '').replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h.id}.${h.timestamp}.${body}`)));
    return h.signature.split(' ').some((part) => { const [v, sig] = part.split(','); return v === 'v1' && !!sig && safeEqual(sig, want); });
  } catch { return false; }
}

export type HookPayload = { user?: { email?: string }; email_data?: { token?: string; token_hash?: string; redirect_to?: string; site_url?: string; email_action_type?: string } };
/** The only mail Auth may send is the password-reset link. Login codes and magic links are never sent, so there is no code login for the admin. */
export function authMailFor(p: HookPayload, site: Partial<Site>, supabaseUrl: string): { to: string; subject: string; html: string; text: string } | null {
  const to = String(p?.user?.email ?? '').trim(), d = p?.email_data ?? {};
  if (!to || d.email_action_type !== 'recovery' || !d.token_hash || !supabaseUrl) return null;
  const redirect = String(d.redirect_to || d.site_url || '');
  const link = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/verify?token=${encodeURIComponent(d.token_hash)}&type=recovery&redirect_to=${encodeURIComponent(redirect)}`;
  const m = passwordReset({ ...(site as Site), link, minutes: 60 });
  return { to, subject: m.subject, html: m.html, text: m.text };
}
