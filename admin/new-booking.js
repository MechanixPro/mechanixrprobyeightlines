// admin/new-booking.js — turns the "Add booking" form into rows to save (no DOM, no Supabase), so it can be tested in Node.
const SOURCES = ['phone', 'whatsapp', 'walk_in'];
const STATUSES = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed'];
const SLOTS = ['morning', 'afternoon', 'evening', 'asap'];
const KM = ['new', 'lt3', 'mid', 'gt6', 'unsure'];
const PLACES = ['home', 'road', 'unsure', 'pickup'];
const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const pick = (list, v, d) => (list.includes(v) ? v : d);
const reg = (v) => { const t = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(t) ? t : null; };

export { SOURCES, STATUSES };

export function buildNewBooking(f, { services = [], today }) {
  const name = txt(f.name, 60);
  const phone = String(f.phone ?? '').replace(/\D/g, '').slice(-10);
  if (name.length < 2) return { error: 'Enter the customer name' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: 'Enter a valid 10-digit mobile number' };
  const email = txt(f.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'That email address does not look right' };
  const pincode = String(f.pincode ?? '').replace(/\s/g, '');
  if (pincode && !/^\d{6}$/.test(pincode)) return { error: 'PIN code must be 6 digits' };

  const svc = f.service ? services.find((s) => s.id === f.service && s.kind === 'service') : null;
  if (f.service && !svc) return { error: 'Choose a valid service' };
  const addons = svc ? [...new Set((f.addons || []).filter((id) => services.some((s) => s.id === id && s.kind === 'addon')))] : [];
  const bigFee = services.find((s) => s.id === 'bigbike' && s.kind === 'fee')?.price ?? 300;
  const surcharge = svc && f.bigBike && ['basic', 'general', 'full'].includes(svc.id) ? bigFee : 0;
  const est = svc ? svc.price + surcharge + addons.reduce((t, id) => t + services.find((s) => s.id === id).price, 0) : null;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : null;
  const slot = pick(SLOTS, f.slot, null);
  if (date && !slot) return { error: 'Pick a time slot for that day' };
  if (date && today && date < today) return { error: 'That day is in the past' };

  const brand = txt(f.brand, 30), model = txt(f.model, 40);
  const bike = brand || model ? { brand, model, nickname: txt(f.nickname, 24) || null, big_bike: !!f.bigBike } : null;
  const status = pick(STATUSES, f.status, 'contacted');
  return {
    customer: { phone, name, email: email || null },
    bike,
    lead: {
      name, phone, source: pick(SOURCES, f.source, 'phone'), status,
      service_id: svc ? svc.id : null, addons, est_total: est,
      area: txt(f.area, 40) || null, pincode: pincode || null, address: txt(f.address, 200) || null,
      place: pick(PLACES, f.place, 'home'),
      preferred_date: date, preferred_slot: date ? slot : null, preferred_time: date ? txt(f.time, 30) || null : null,
      km_band: pick(KM, f.km, null), notes: txt(f.note, 1000) || null, email: email || null, reg_no: reg(f.regNo),
      consent_whatsapp: !!f.whatsapp, reminder_opt_in: !!f.reminder,
    },
  };
}
