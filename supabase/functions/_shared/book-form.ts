// Validation of the /book/ form on the server. No Deno APIs, so Node can test it. Nothing here sets the fee; confirm-fee.ts does that from vehicle and model.
import { cleanEmail } from './email-address.ts';
import { cleanEngine } from './confirm-fee.ts';
import { todaySlots, istToday } from './today-slots.ts';
const SLOTS = ['morning', 'afternoon', 'evening', 'asap'];
const BIKE_SERVICES = ['basic', 'general', 'full', 'repair', 'puncture'];
const strip = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
export type Booking = {
  client_key: string; vehicle: 'bike' | 'car'; brand: string; model: string; engine_class: 'std' | 'mid' | 'big' | null; service_id: string; need_text: string;
  address: string; area: string; pincode: string; lat: number | null; lng: number | null; preferred_date: string; preferred_slot: string;
  name: string; phone: string; email: string; consent_whatsapp: boolean; note: string | null; ref_code: string | null; campaign: string | null; utm: Record<string, unknown>;
};
type Out = { ok: true; value: Booking } | { ok: false; error: string; field: string };
export function cleanBooking(b: Record<string, unknown>, now: number): Out {
  const no = (field: string, error: string): Out => ({ ok: false, field, error });
  const client_key = String(b.client_key ?? '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(client_key)) return no('form', 'Reload the page and try again.');
  const vehicle = b.vehicle === 'car' ? 'car' : b.vehicle === 'bike' ? 'bike' : null;
  if (!vehicle) return no('vehicle', 'Choose bike or car.');
  const brand = strip(b.brand, 30), model = strip(b.model, 40);
  if (model.length < 2) return no('model', vehicle === 'car' ? 'Enter your car make and model.' : 'Choose or type your bike model.');
  const service_id = strip(b.service_id, 30);
  if (vehicle === 'bike' && !BIKE_SERVICES.includes(service_id)) return no('service_id', 'Choose what your bike needs.');
  const need_text = strip(b.need_text, 120);
  if (vehicle === 'car' && !['service', 'problem'].includes(String(b.car_need)) ) return no('car_need', 'Choose what your car needs.');
  const house = strip(b.house, 80), street = strip(b.street, 100), area = strip(b.area, 40), pincode = String(b.pincode ?? '').replace(/\s/g, '');
  if (house.length < 2) return no('house', 'Enter your house or flat number.');
  if (street.length < 3) return no('street', 'Enter your street or a landmark.');
  if (area.length < 2) return no('area', 'Enter your area.');
  if (!/^56[0-2]\d{3}$/.test(pincode)) return no('pincode', 'Enter a Bengaluru PIN code (6 digits, like 560102).');
  const lat = num(b.lat), lng = num(b.lng), geo = Number.isFinite(lat) && Number.isFinite(lng) && lat >= 12.4 && lat <= 13.7 && lng >= 77 && lng <= 78.2;
  const preferred_date = strip(b.preferred_date, 10), preferred_slot = strip(b.preferred_slot, 12);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) return no('preferred_date', 'Pick a day.');
  const day = new Date(preferred_date + 'T00:00:00+05:30').getTime();
  if (!(day >= now - 36 * 3600_000) || day > now + 30 * 24 * 3600_000) return no('preferred_date', 'Pick a day within the next 30 days.');
  if (!SLOTS.includes(preferred_slot)) return no('preferred_slot', 'Pick a time slot.');
  // Today Slots: for today, the window must still be ahead (starts 2 hours from now or later); as soon as possible is for today only.
  if (preferred_slot === 'asap' && preferred_date !== istToday(now)) return no('preferred_slot', 'As soon as possible is for today. Pick a time window for another day.');
  if (preferred_date === istToday(now) && !(todaySlots(now) as Record<string, boolean>)[preferred_slot]) return no('preferred_slot', 'That time has passed for today. Pick a later time or another day.');
  const name = strip(b.name, 60), phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10), email = cleanEmail(b.email);
  if (name.length < 2) return no('name', 'Enter your name.');
  if (!/^[6-9]\d{9}$/.test(phone)) return no('phone', 'Enter a valid 10-digit mobile number.');
  if (!email) return no('email', 'Enter a valid email address. We send your confirmation and code there.');
  const utm = typeof b.utm === 'object' && b.utm ? Object.fromEntries(Object.entries(b.utm as Record<string, unknown>).slice(0, 8).map(([k, v]) => [strip(k, 30), strip(v, 80)])) : {};
  return { ok: true, value: {
    client_key, vehicle, brand, model, engine_class: cleanEngine(b.engine_class), service_id: vehicle === 'bike' ? service_id : '', need_text: vehicle === 'car' ? (b.car_need === 'problem' ? 'Problem check' : 'Service') + (need_text ? ': ' + need_text : '') : need_text,
    address: `${house}, ${street}`.slice(0, 200), area, pincode, lat: geo ? lat : null, lng: geo ? lng : null, preferred_date, preferred_slot, name, phone, email, consent_whatsapp: b.consent_whatsapp === true,
    note: strip(b.note, 300) || null, ref_code: strip(b.ref_code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || null, campaign: strip(b.campaign, 100).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || null, utm,
  } };
}
