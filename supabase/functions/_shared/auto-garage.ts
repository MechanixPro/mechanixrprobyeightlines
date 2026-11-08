// Pure helpers for automatic garage assignment. No I/O, so they can be tested with plain node.
export type AutoGarage = { id: string; name?: string; pincode?: string | null; lat?: number | null; lng?: number | null; open_jobs: number; last_assigned_at?: string | null; available: boolean };
export type AutoLead = { lat?: number | null; lng?: number | null; pincode?: string | null };
export type AutoSettings = { enabled: boolean; max_open_jobs: number; radius_km: number };

export const DEFAULT_AUTO: AutoSettings = { enabled: false, max_open_jobs: 3, radius_km: 15 };

/** Settings as stored (any shape) to safe numbers. Anything odd means the default, and enabled only when exactly true. */
export function normalizeAuto(v: unknown): AutoSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number, lo: number, hi: number) => { const k = Number(x); return Number.isFinite(k) && k >= lo && k <= hi ? Math.round(k * 10) / 10 : d; };
  return { enabled: o.enabled === true, max_open_jobs: Math.round(n(o.max_open_jobs, 3, 1, 50)), radius_km: n(o.radius_km, 15, 1, 200) };
}

const num = (x: unknown): number | null => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180, dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const lastMs = (g: AutoGarage) => (g.last_assigned_at ? Date.parse(g.last_assigned_at) || 0 : 0);
/** Fewest open jobs, then the one that was given work longest ago (never first), then id so ties are always the same. */
const byRoundRobin = (a: AutoGarage, b: AutoGarage) => a.open_jobs - b.open_jobs || lastMs(a) - lastMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The garage id to use, or null when none qualifies. */
export function pickGarage(lead: AutoLead, garages: AutoGarage[], s: Pick<AutoSettings, 'max_open_jobs' | 'radius_km'>): string | null {
  const ok = garages.filter((g) => g.available && g.open_jobs < s.max_open_jobs);
  if (!ok.length) return null;
  const llat = num(lead.lat), llng = num(lead.lng);
  if (llat !== null && llng !== null) {
    const near = ok.map((g) => { const a = num(g.lat), b = num(g.lng); return { g, d: a !== null && b !== null ? haversineKm(llat, llng, a, b) : Infinity }; })
      .filter((x) => x.d <= s.radius_km).sort((x, y) => x.d - y.d || byRoundRobin(x.g, y.g));
    if (near.length) return near[0].g.id;
  }
  const pin = lead.pincode ? String(lead.pincode) : '';
  if (pin) { const same = ok.filter((g) => g.pincode === pin).sort(byRoundRobin); if (same.length) return same[0].id; }
  return [...ok].sort(byRoundRobin)[0].id;
}
