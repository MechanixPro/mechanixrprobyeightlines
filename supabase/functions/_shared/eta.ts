// "About N min away": a plain straight-line estimate, never a promise. Pure (no Deno APIs), so Node can test it.
// Distance is the haversine (great-circle) distance; roads are longer than a straight line, so it is multiplied by a detour factor, then divided by an average Bengaluru speed.
export const DETOUR = 1.3;          // road distance is about 30% longer than a straight line in the city
export const AVG_KMPH = 18;         // average two-wheeler speed in Bengaluru traffic, with signals
export const STALE_SECONDS = 600;   // a point older than this is not shown (also enforced in the database)

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes, rounded up to the next 5 (never promises an exact arrival); null if either point is missing or invalid. */
export function etaMinutes(from: { lat: number; lng: number } | null | undefined, to: { lat: number | null; lng: number | null } | null | undefined): { km: number; minutes: number } | null {
  if (!from || !to || to.lat == null || to.lng == null) return null;
  const f = { lat: Number(from.lat), lng: Number(from.lng) }, t = { lat: Number(to.lat), lng: Number(to.lng) };
  if (![f.lat, f.lng, t.lat, t.lng].every(Number.isFinite)) return null;
  const km = haversineKm(f, t) * DETOUR;
  const raw = (km / AVG_KMPH) * 60;
  return { km: Math.round(km * 10) / 10, minutes: Math.max(5, Math.ceil(raw / 5) * 5) };
}

/** The line the customer reads. Always says it is an estimate. */
export function etaLine(e: { km: number; minutes: number } | null): string | null {
  if (!e) return null;
  if (e.km < 0.3) return 'Your mechanic is very close (estimate).';
  return `about ${e.minutes} min away (estimate)`;
}

export const mapsPointUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
/** Google Maps directions to the customer, for the mechanic's Navigate button. Bikes use the two-wheeler mode, cars driving. A pin is used when there is one, else the address text. */
export function navigateUrl(d: { lat?: number | null; lng?: number | null; address?: string | null; vehicle?: string | null }): string | null {
  const pin = d.lat != null && d.lng != null && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)), addr = String(d.address ?? '').trim().slice(0, 250);
  if (!pin && !addr) return null;
  const dest = pin ? `${Number(d.lat).toFixed(6)},${Number(d.lng).toFixed(6)}` : encodeURIComponent(addr);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${d.vehicle === 'car' ? 'driving' : 'two_wheeler'}`;
}
