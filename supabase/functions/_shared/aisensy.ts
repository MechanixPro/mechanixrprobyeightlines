// Validates a booking sent by the AiSensy chatbot flow. No Deno APIs, so Node can test it.
const strip = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const SLOTS = ['morning', 'afternoon', 'evening', 'asap'];

export function cleanAisensyLead(b: Record<string, unknown>):
  { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  const name = strip(b?.name, 60);
  const phone = String(b?.phone ?? '').replace(/\D/g, '').slice(-10);
  if (name.length < 2) return { ok: false, error: 'name' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'phone' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.preferred_date ?? '')) ? String(b.preferred_date) : null;
  const slot = SLOTS.includes(String(b.preferred_slot ?? '')) ? String(b.preferred_slot) : null;
  const pin = String(b.pincode ?? '').replace(/\s/g, '');
  return {
    ok: true,
    value: {
      name, phone, source: 'whatsapp', consent_whatsapp: true,
      service_id: strip(b.service, 30) || null,
      bike_brand: strip(b.bike_brand, 30), bike_model: strip(b.bike_model, 40), bike_nickname: strip(b.bike_nickname, 24) || null,
      area: strip(b.area, 40) || null, pincode: /^\d{6}$/.test(pin) ? pin : null, address: strip(b.address, 200) || null,
      preferred_date: date, preferred_slot: slot, note: strip(b.note, 300) || null,
      campaign: strip(b.campaign, 60).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || null,
      ref_code: strip(b.ref_code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || null,
    },
  };
}

/** Validates one incoming customer message forwarded by an AiSensy flow step. Field names vary between flows, so the common ones are all accepted. */
export function cleanAisensyInbound(b: Record<string, unknown>):
  { ok: true; value: { phone: string; name: string; text: string; id: string | null } } | { ok: false; error: string } {
  const pick = (...keys: string[]) => { for (const k of keys) { const v = b?.[k]; if (v != null && String(v).trim() !== '') return String(v); } return ''; };
  const phone = pick('phone', 'mobile', 'waNumber', 'wa_number', 'from', 'destination', 'userNumber').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'phone' };
  const text = strip(pick('message', 'text', 'body', 'userMessage', 'user_message', 'lastMessage'), 4000);
  if (!text) return { ok: false, error: 'message' };
  const id = strip(pick('message_id', 'messageId', 'wamid', 'id'), 120);
  return { ok: true, value: { phone, name: strip(pick('name', 'userName', 'profileName', 'customer_name'), 60), text, id: id ? 'as:' + id : null } };
}

/** Reads an AiSensy native webhook notification (topic message.sender.user) into the same shape as a flow message. Other topics return null. */
export function inboundFromNotification(n: any): { phone: string; name: string; text: string; id: string | null } | null {
  if (n?.topic !== 'message.sender.user') return null;
  const m = n?.data?.message ?? {};
  const phone = String(m.phone_number ?? '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return null;
  const c = m.message_content ?? {};
  const raw = typeof c === 'string' ? c : c.text?.body ?? c.body ?? c.text ?? c.caption ?? c.interactive?.button_reply?.title ?? c.interactive?.list_reply?.title ?? c.button?.text ?? '';
  const text = strip(typeof raw === 'string' ? raw : '', 4000) || '[' + String(m.message_type ?? 'message').toLowerCase() + ']';
  const id = strip(m.messageId ?? m.id ?? '', 120);
  return { phone, name: '', text, id: id ? 'as:' + id : null };
}
