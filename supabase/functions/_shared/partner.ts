// The "join us" form for garages and independent mechanics: which kinds of work they do, and cleaning of an application. Pure functions so Node can test them.
export const PARTNER_KINDS = [{ id: 'garage', label: 'Garage or workshop' }, { id: 'mechanic', label: 'Independent mechanic' }];
export const PARTNER_WORK = [{ id: 'bike', label: 'Motorcycles' }, { id: 'scooter', label: 'Scooters' }, { id: 'electric', label: 'Electric bikes and scooters' }, { id: 'car', label: 'Cars' }];
const kinds = new Set(PARTNER_KINDS.map((k) => k.id)), work = new Set(PARTNER_WORK.map((w) => w.id));
const text = (v: unknown, max: number) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>"\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export type Partner = { kind: string; name: string; owner_name: string; mobile: string; address: string; pincode: string | null; categories: string[]; bays: number | null; note: string };

export function cleanPartner(b: Record<string, unknown>): { ok: true; value: Partner } | { ok: false; error: string } {
  const kind = String(b.kind ?? '');
  if (!kinds.has(kind)) return { ok: false, error: 'Choose whether you are a garage or an independent mechanic.' };
  const owner = text(b.owner_name, 80), name = text(b.name, 80) || (kind === 'mechanic' ? owner : '');
  if (owner.length < 2) return { ok: false, error: 'Enter your name.' };
  if (name.length < 2) return { ok: false, error: 'Enter your garage name.' };
  const mobile = String(b.mobile ?? '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
  const address = text(b.address, 200);
  if (address.length < 3) return { ok: false, error: 'Enter your area or address in Bengaluru.' };
  const pin = String(b.pincode ?? '').replace(/\D/g, ''), pincode = pin ? (/^\d{6}$/.test(pin) ? pin : null) : null;
  if (pin && !pincode) return { ok: false, error: 'Enter a valid 6-digit PIN code, or leave it empty.' };
  const categories = [...new Set((Array.isArray(b.categories) ? b.categories : []).map((x) => String(x)).filter((x) => work.has(x)))];
  if (!categories.length) return { ok: false, error: 'Pick at least one kind of vehicle you work on.' };
  const baysN = Math.round(Number(b.bays));
  const bays = kind === 'garage' && baysN >= 1 && baysN <= 60 ? baysN : null;
  if (b.consent !== true) return { ok: false, error: 'Please tick the box so we may contact you.' };
  return { ok: true, value: { kind, name, owner_name: owner, mobile, address, pincode, categories, bays, note: text(b.note, 300) } };
}
