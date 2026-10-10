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
