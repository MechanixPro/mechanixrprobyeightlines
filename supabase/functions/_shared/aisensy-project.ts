// AiSensy Project API: send a session (free text) WhatsApp message from the desk number. Pure builder plus a small sender, so Node can test the builder.
export const PROJECT_API = 'https://apis.aisensy.com/project-apis/v1';

export function buildSessionText(o: { projectId: string; phone: string; text: string }): { ok: true; path: string; body: Record<string, unknown> } | { ok: false; error: string } {
  const phone = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
  const text = String(o.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(o.projectId ?? '')) return { ok: false, error: 'AiSensy project id is not set' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'phone' };
  if (!text) return { ok: false, error: 'Write a message first' };
  if (text.length > 1000) return { ok: false, error: 'Keep the message under 1000 characters' };
  return { ok: true, path: `/project/${o.projectId}/messages`, body: { to: '91' + phone, type: 'text', recipient_type: 'individual', text: { body: text } } };
}

/** Never throws, and never puts the password in an error message. */
export async function sendSessionText(o: { projectId: string; password: string; phone: string; text: string }, doFetch: typeof fetch = fetch): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!o.password) return { ok: false, error: 'AiSensy is not connected' };
  const req = buildSessionText(o);
  if (!req.ok) return { ok: false, error: req.error };
  try {
    const r = await doFetch(PROJECT_API + req.path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AiSensy-Project-API-Pwd': o.password }, body: JSON.stringify(req.body) });
    const t = await r.text().catch(() => '');
    if (!r.ok) return { ok: false, error: `AiSensy said ${r.status}${t ? ': ' + t.replace(o.password, '***').slice(0, 200) : ''}` };
    let id: string | undefined; try { id = JSON.parse(t)?.messages?.[0]?.id; } catch { /* body is optional */ }
    return { ok: true, id };
  } catch { return { ok: false, error: 'Could not reach AiSensy' }; }
}
