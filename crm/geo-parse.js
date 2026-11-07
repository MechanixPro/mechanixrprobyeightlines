/* Coordinates typed or pasted in any common form become two plain numbers.
   Accepted: 12.939596, 77.722511  |  12.939596 and 77.722511 in two boxes  |  12°56'22.6"N 77°43'21.0"E (Google Maps degrees)  |  a Google Maps link (@lat,lng, ?q=lat,lng or !3d..!4d..)
   The Bengaluru range check stays on the server; this only turns text into numbers. */
const dms = (deg, min, sec, hemi) => { const v = Number(deg) + Number(min) / 60 + Number(sec || 0) / 3600; return /[SW]/i.test(hemi) ? -v : v; };
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;

function pairFrom(text) {
  const t = String(text == null ? '' : text).replace(/[“”″]/g, '"').replace(/[’′]/g, "'").trim();
  if (!t) return null;
  let m = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i) || t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]) ? { lat: r6(+m[1]), lng: r6(+m[2]) } : null;
  const d = [...t.matchAll(/(\d{1,3})\s*[°d]\s*(\d{1,2})\s*['m]\s*(\d{1,2}(?:\.\d+)?)?\s*"?\s*([NSEW])/gi)];
  if (d.length >= 2) {
    let lat = null, lng = null;
    for (const x of d) { const v = dms(x[1], x[2], x[3], x[4]); if (/[NS]/i.test(x[4]) && lat == null) lat = v; if (/[EW]/i.test(x[4]) && lng == null) lng = v; }
    if (lat != null && lng != null && ok(lat, lng)) return { lat: r6(lat), lng: r6(lng) };
  }
  const nums = [...t.replace(/[NSEW]\b/gi, ' ').matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
  if (nums.length === 2 && ok(nums[0], nums[1])) {
    const hemiSwap = /\b[EW]\b.*\b[NS]\b/i.test(t) && !/\b[NS]\b.*\b[EW]\b/i.test(t);   // "77.7 E, 12.9 N"
    const [a, b] = hemiSwap ? [nums[1], nums[0]] : [nums[0], nums[1]];
    return { lat: r6(a), lng: r6(b) };
  }
  return null;
}
const single = (t) => { const s = String(t == null ? '' : t).trim(); return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null; };

/** latText and lngText are what is in the two boxes. Returns { lat, lng } or null (the caller shows the help text). */
export function parseLatLng(latText, lngText) {
  const a = single(latText), b = single(lngText);
  if (a != null && b != null && ok(a, b)) return { lat: r6(a), lng: r6(b) };
  for (const t of [latText, lngText, `${latText || ''} ${lngText || ''}`]) { const p = pairFrom(t); if (p) return p; }
  return null;
}
export const COORD_HELP = 'Paste the location like 12.939596, 77.722511 or the Google Maps link (in either box). It must be in or near Bengaluru.';
