// The booking rules the new page must follow. Pure functions (no React, no network) so Node can test them against the server's own validation (cleanBooking).
// These mirror assets/js/book-pay.js (problems, payload) and supabase/functions/_shared/book-form.ts and today-slots.ts. Nothing here sets a fee: the server does.
export const SLOT_START = { morning: 9, afternoon: 12, evening: 16 };
export const LEAD_HOURS = 2, ASAP_FROM = 8, ASAP_UNTIL = 18;
export const SLOT_LABEL = { morning: ['Morning', '9 to 12'], afternoon: ['Afternoon', '12 to 4'], evening: ['Evening', '4 to 7'], asap: ['As soon as possible', 'today, 8 to 6'] };
export const CAR_NEEDS = { service: 'Service', inspection: 'Car inspection', brakes: 'Brake service', ac: 'AC service', battery: 'Battery check or replacement', tyres: 'Tyres, alignment and balancing', repair: 'Clutch, suspension or other repair', cleaning: 'Cleaning and detailing', problem: 'Problem check' };
// The package names on the page map to the service ids the server knows. "Standard" is stored as "general".
export const SERVICE_ID = { basic: 'basic', standard: 'general', full: 'full', repair: 'repair' };

export const istToday = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);
export function todaySlots(now = Date.now()) {
  const ist = new Date(now + 330 * 60000), h = ist.getUTCHours() + ist.getUTCMinutes() / 60, open = (s) => s >= h + LEAD_HOURS;
  return { morning: open(SLOT_START.morning), afternoon: open(SLOT_START.afternoon), evening: open(SLOT_START.evening), asap: h >= ASAP_FROM && h < ASAP_UNTIL };
}
/** The next 7 days as { iso, label, sub, slots } where slots says which windows can still be booked. */
export function nextDays(now = Date.now(), n = 7) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = new Date(now + 330 * 60000 + i * 864e5).toISOString().slice(0, 10), d = new Date(iso + 'T12:00:00+05:30');
    const today = i === 0, slots = today ? todaySlots(now) : { morning: true, afternoon: true, evening: true, asap: false };
    out.push({ iso, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }), sub: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), slots, any: Object.values(slots).some(Boolean) });
  }
  return out;
}

const ERR = { phone: 'Enter a valid 10-digit mobile number.', email: 'Enter a valid email address. We send your confirmation and code there.', name: 'Enter your name.', house: 'Enter your house or flat number.', street: 'Enter your street or a landmark.', area: 'Enter your area.', pincode: 'Enter a Bengaluru PIN code (6 digits, like 560102).', model: 'Choose or type your model.', service_id: 'Choose what your bike needs.', car_model: 'Enter your car make and model.', car_need: 'Choose what your car needs.', preferred_date: 'Pick a day.', preferred_slot: 'Pick a time slot.' };
/** { field: message } for what is wrong. step 1, 2 or 3 limits the check to that step; no step checks everything. */
export function problems(v, step) {
  const e = {}, car = v.vehicle === 'car';
  if (!step || step === 1) {
    if (car) { if (String(v.car_model || '').trim().length < 2) e.car_model = ERR.car_model; if (!CAR_NEEDS[v.car_need]) e.car_need = ERR.car_need; }
    else { if (String(v.model || '').trim().length < 2) e.model = ERR.model; if (!Object.values(SERVICE_ID).includes(v.service_id)) e.service_id = ERR.service_id; }
  }
  if (!step || step === 2) {
    if (String(v.house || '').trim().length < 2) e.house = ERR.house;
    if (String(v.street || '').trim().length < 3) e.street = ERR.street;
    if (String(v.area || '').trim().length < 2) e.area = ERR.area;
    if (!/^56[0-2]\d{3}$/.test(String(v.pincode || '').replace(/\s/g, ''))) e.pincode = ERR.pincode;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.preferred_date || '')) e.preferred_date = ERR.preferred_date;
    if (!['morning', 'afternoon', 'evening', 'asap'].includes(v.preferred_slot)) e.preferred_slot = ERR.preferred_slot;
  }
  if (!step || step === 3) {
    if (String(v.name || '').trim().length < 2) e.name = ERR.name;
    if (!/^[6-9]\d{9}$/.test(String(v.phone || '').replace(/\D/g, '').slice(-10))) e.phone = ERR.phone;
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v.email || '').trim())) e.email = ERR.email;
  }
  return e;
}
/** The body sent to book-start. The fee is not in it: the server works it out from the vehicle and model. */
export function toPayload(v, key, utm = {}) {
  const car = v.vehicle === 'car';
  return {
    client_key: key, vehicle: car ? 'car' : 'bike', brand: car ? '' : v.brand || '', model: car ? v.car_model : v.model, engine_class: car ? null : v.engine_class || null,
    service_id: car ? '' : v.service_id, car_need: car ? v.car_need : undefined, need_text: v.need_text || '', note: v.note || undefined,
    house: v.house, street: v.street, area: v.area, pincode: String(v.pincode || '').replace(/\s/g, ''), lat: v.lat || null, lng: v.lng || null,
    preferred_date: v.preferred_date, preferred_slot: v.preferred_slot, name: v.name, phone: String(v.phone || '').replace(/\D/g, '').slice(-10), email: String(v.email || '').trim(),
    consent_whatsapp: !!v.consent_whatsapp, utm,
  };
}
