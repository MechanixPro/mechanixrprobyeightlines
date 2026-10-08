// Validates the extra booking details sent by the website. No Deno APIs here so Node can test it.
import { cleanEmail } from './email-address.ts';
const KM = ['new', 'lt3', 'mid', 'gt6', 'unsure'];
const ISSUES = ['start', 'pickup', 'brake', 'chain', 'clutch', 'gear', 'battery', 'tyre', 'leak', 'heat', 'elec', 'susp', 'rain', 'range', 'sw'];
const PLACES = ['home', 'road', 'unsure', 'pickup'];
const CONTACT = ['whatsapp', 'call'];
const TYPES = ['m', 's', 'e'];
const strip = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const pick = (list: string[], v: unknown) => (list.includes(String(v)) ? String(v) : null);

const num = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

const cleanReg = (v: unknown): string | null => { const t = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(t) ? t : null; };

export function cleanLeadFields(b: Record<string, unknown>) {
  const issues = Array.isArray(b.issues) ? [...new Set(b.issues.map(String))].filter((i) => ISSUES.includes(i)).slice(0, 15) : [];
  const lat = num(b.lat), lng = num(b.lng);
  const geo = Number.isFinite(lat) && Number.isFinite(lng) && lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
  return {
    km_band: pick(KM, b.km_band),
    issues,
    note: strip(b.note, 300) || null,
    place: pick(PLACES, b.place) ?? 'home',
    contact_pref: pick(CONTACT, b.contact_pref) ?? 'whatsapp',
    bike_type: pick(TYPES, b.bike_type),
    ref_code: strip(b.ref_code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || null,
    campaign: strip(b.campaign, 100).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || null,
    address: strip(b.address, 200) || null,
    pincode: /^\d{6}$/.test(String(b.pincode ?? '').replace(/\s/g, '')) ? String(b.pincode).replace(/\s/g, '') : null,
    lat: geo ? r5(lat) : null,
    lng: geo ? r5(lng) : null,
    email: cleanEmail(b.email),
    email_marketing: cleanEmail(b.email) !== null && b.email_marketing === true,
    request_type: b.request_type === 'callback' ? 'callback' : 'quote',
    reg_no: cleanReg(b.reg_no),
    reminder_opt_in: b.reminder_opt_in === true,
    preferred_time: strip(b.preferred_time, 30) || null,
  };
}
