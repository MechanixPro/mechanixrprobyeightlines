// Sends email through Resend. The API key comes from the RESEND_API_KEY secret, never from the repo.
import { cleanEmail } from './email-address.ts';
export const FROM_DEFAULT = 'Mechanix Pro <no-reply@mechanixpro.in>';
export const REPLY_TO = 'hello@mechanixpro.in';
export type OutMail = { to: string; subject: string; html: string; text: string; from?: string; unsubscribeUrl?: string; tags?: Record<string, string> };
const tagValue = (v: string) => String(v).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);

export function buildEmailPayload(m: OutMail) {
  const headers: Record<string, string> = {};
  if (m.unsubscribeUrl) { headers['List-Unsubscribe'] = `<${m.unsubscribeUrl}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'; }
  return {
    from: m.from ?? FROM_DEFAULT, to: [m.to], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text,
    headers, tags: Object.entries(m.tags ?? {}).map(([name, value]) => ({ name: tagValue(name), value: tagValue(value) })),
  };
}

type Deps = { apiKey?: string; fetch?: typeof fetch };
export async function sendEmail(m: OutMail, deps: Deps = {}): Promise<{ ok: boolean; id?: string; error?: string; skipped?: boolean }> {
  const to = cleanEmail(m.to);
  if (!to) return { ok: false, error: 'Invalid email address.' };
  const apiKey = deps.apiKey ?? (typeof Deno !== 'undefined' ? Deno.env.get('RESEND_API_KEY') ?? '' : '');
  if (!apiKey) return { ok: false, skipped: true, error: 'Email is not set up yet.' };
  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildEmailPayload({ ...m, to })),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(j.message ?? `Resend error ${res.status}`) };
    return { ok: true, id: String(j.id ?? '') };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}
