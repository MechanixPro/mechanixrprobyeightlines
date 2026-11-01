// Agentive voice: the call-menu key press webhook (event ivr.keypress). Pure helpers so Node can test them.
// Docs: https://agentive.co.in/docs/voice-broadcast-api#ivr-keypress-webhook
// The signature header is X-Agentive-Signature-V2: t=<unix seconds>,v2=<hex>, where v2 is HMAC-SHA256(secret, t + "." + raw body). Reject if t is more than 5 minutes old.
export const TOLERANCE_SEC = 300;

export function parseSignature(header: string | null): { t: number; v2: string } | null {
  const m = /^t=(\d{9,12}),v2=([a-f0-9]{64})$/i.exec(String(header ?? '').trim());
  return m ? { t: Number(m[1]), v2: m[2].toLowerCase() } : null;
}

export async function verifyAgentive(raw: string, header: string | null, secret: string, hmacHex: (secret: string, data: string) => Promise<string>, equal: (a: string, b: string) => boolean, now = Date.now()): Promise<boolean> {
  const sig = parseSignature(header);
  if (!secret || !sig || Math.abs(now / 1000 - sig.t) > TOLERANCE_SEC) return false;
  return equal(sig.v2, await hmacHex(secret, sig.t + '.' + raw));
}

export type MenuKey = { label: string; lead: boolean; campaign: string | null };
/** What each key on the call menu means. Must match docs/IVR-FLOW.md. A key not listed here is only noted. */
export const MENU: Record<string, MenuKey> = {
  '1': { label: 'Breakdown or puncture', lead: true, campaign: 'mxp_ivr_roadside' },
  '2': { label: 'Book a bike service or problem check', lead: true, campaign: 'mxp_ivr_book' },
  '3': { label: 'Booking, payment or invoice', lead: false, campaign: 'mxp_ivr_track' },
  '4': { label: 'Car service or parts', lead: true, campaign: 'mxp_ivr_car' },
  '5-1': { label: 'Fleet or society', lead: true, campaign: 'mxp_ivr_business' },
  '5-2': { label: 'Garage partnership', lead: true, campaign: 'mxp_ivr_business' },
  '0': { label: 'Talk to a Care Buddy', lead: true, campaign: null },
};

export type Keypress = { id: string; test: boolean; callUuid: string; phone: string; keyPath: string; keyLabel: string };
export function cleanKeypress(b: any): { ok: true; value: Keypress } | { ok: false; error: string } {
  if (!b || b.event !== 'ivr.keypress' && b.type !== 'ivr.keypress') return { ok: false, error: 'event' };
  const d = b.data ?? {};
  const id = String(b.id ?? '').slice(0, 60); if (!/^evt_[a-z0-9_]{8,40}$/i.test(id)) return { ok: false, error: 'id' };
  const phone = String(d.from_number ?? '').replace(/\D/g, '').slice(-10);
  const keyPath = String(d.key_path ?? '').replace(/[^0-9*#-]/g, '').slice(0, 20);
  if (!keyPath) return { ok: false, error: 'key_path' };
  return { ok: true, value: { id, test: b.test === true, callUuid: String(d.call_uuid ?? '').slice(0, 60), phone: /^[6-9]\d{9}$/.test(phone) ? phone : '', keyPath, keyLabel: String(d.key_label ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 60) } };
}
