// Looks one customer up in AiSensy (Project API, included in the plan) to learn when they last wrote to the desk number.
// That is enough to know whether the 24-hour reply window is open, with no webhook. The words of the message are not available this way.
import { PROJECT_API } from './aisensy-project.ts';

export type ContactState = { found: boolean; lastActive: number | null; windowOpen: boolean; intervened: boolean; name: string };
const DAY = 24 * 3600_000;

export function parseContact(body: any, now = Date.now()): ContactState {
  const c = body?.contact ?? body?.data ?? (Array.isArray(body) ? body[0] : body);
  if (!c || typeof c !== 'object' || (!c.phone_number && !c.id)) return { found: false, lastActive: null, windowOpen: false, intervened: false, name: '' };
  const raw = c.last_active;
  const t = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
  const lastActive = Number.isFinite(t) && t > 1e11 && t <= now + 5 * 60_000 ? t : null;
  return { found: true, lastActive, windowOpen: lastActive != null && now - lastActive < DAY, intervened: !!c.is_intervened, name: String(c.name ?? '').slice(0, 60) };
}

export async function fetchContact(o: { projectId: string; password: string; phone: string }, doFetch: typeof fetch = fetch): Promise<{ ok: boolean; state?: ContactState; error?: string }> {
  const phone = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
  if (!o.password || !/^[A-Za-z0-9_-]{6,60}$/.test(o.projectId ?? '')) return { ok: false, error: 'AiSensy is not connected' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'phone' };
  try {
    const r = await doFetch(`${PROJECT_API}/project/${o.projectId}/contact?action=FetchContact&mobile_number=91${phone}`, { headers: { 'X-AiSensy-Project-API-Pwd': o.password } });
    if (r.status === 404) return { ok: true, state: parseContact(null) };
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ }
    if (!r.ok) return { ok: false, error: `AiSensy said ${r.status}` };
    return { ok: true, state: parseContact(j) };
  } catch { return { ok: false, error: 'Could not reach AiSensy' }; }
}
