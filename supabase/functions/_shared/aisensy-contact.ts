// Looks one customer up in AiSensy (Project API, included in the plan) to learn when they last wrote to the desk number.
// That is enough to know whether the 24-hour reply window is open, with no webhook. The words of the message are not available this way.
import { PROJECT_API } from './aisensy-project.ts';

export type ContactState = { id: string; found: boolean; lastActive: number | null; lastMessage: number | null; windowOpen: boolean; intervened: boolean; name: string };
const DAY = 24 * 3600_000;

export function parseContact(body: any, now = Date.now()): ContactState {
  const c = body?.contact ?? body?.data ?? (Array.isArray(body) ? body[0] : body);
  if (!c || typeof c !== 'object' || (!c.phone_number && !c.id)) return { id: '', found: false, lastActive: null, lastMessage: null, windowOpen: false, intervened: false, name: '' };
  const raw = c.last_active;
  const t = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
  const lastActive = Number.isFinite(t) && t > 1e11 && t <= now + 5 * 60_000 ? t : null;
  const rm = c.last_message; const tm = typeof rm === 'number' ? rm : typeof rm === 'string' ? Date.parse(rm) : NaN;
  const lastMessage = Number.isFinite(tm) && tm > 1e11 && tm <= now + 5 * 60_000 ? tm : null;
  return { id: String(c.id ?? ''), found: true, lastActive, lastMessage, windowOpen: lastActive != null && now - lastActive < DAY, intervened: !!c.is_intervened, name: String(c.name ?? '').slice(0, 60) };
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

/** The context a Care Buddy sees in AiSensy Live Chat: bike, service, PIN code and slot, written as contact attributes (these attribute names exist in the project). Empty values are never sent. */
export function leadAttributes(l: { bike?: string | null; service?: string | null; pincode?: string | null; slot?: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown, n: number) => { const t = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); if (t) out[k] = t; };
  put('vehicle_model', l.bike, 80); put('service_need', l.service, 80); put('location_pincode', l.pincode, 10); put('preferred_slot', l.slot, 20);
  return out;
}

export async function patchContact(o: { projectId: string; password: string; contactId: string; name?: string; attributes?: Record<string, string> }, doFetch: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  if (!o.password || !/^[A-Za-z0-9_-]{6,60}$/.test(o.projectId ?? '') || !/^[A-Za-z0-9_-]{6,60}$/.test(o.contactId ?? '')) return { ok: false, error: 'not connected' };
  const body: Record<string, unknown> = {};
  if (o.name) body.name = String(o.name).slice(0, 60);
  if (o.attributes && Object.keys(o.attributes).length) body.attributes = o.attributes;
  if (!Object.keys(body).length) return { ok: true };
  try {
    const r = await doFetch(`${PROJECT_API}/project/${o.projectId}/contact/${o.contactId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-AiSensy-Project-API-Pwd': o.password }, body: JSON.stringify(body) });
    return r.ok ? { ok: true } : { ok: false, error: `AiSensy said ${r.status}` };
  } catch { return { ok: false, error: 'Could not reach AiSensy' }; }
}

export async function createContact(o: { projectId: string; password: string; phone: string; name: string }, doFetch: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const phone = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
  if (!o.password || !/^[A-Za-z0-9_-]{6,60}$/.test(o.projectId ?? '') || !/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'not connected' };
  try {
    const r = await doFetch(`${PROJECT_API}/project/${o.projectId}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AiSensy-Project-API-Pwd': o.password }, body: JSON.stringify({ name: String(o.name || 'Customer').slice(0, 60), mobile_number: '91' + phone }) });
    return r.ok || r.status === 409 ? { ok: true } : { ok: false, error: `AiSensy said ${r.status}` };
  } catch { return { ok: false, error: 'Could not reach AiSensy' }; }
}
