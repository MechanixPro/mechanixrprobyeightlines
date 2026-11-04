// Vehicle tag for a lead: bike, car or parts. Pure (no Deno APIs) so Node can test it and so the migration backfill uses the same word lists.
// Conservative: whole words only, case-insensitive. null means "no clear signal": the lead keeps whatever it has (the default is bike).
// Keep these lists in step with the backfill in supabase/migrations/20261226000000_lead_vehicle.sql (a test compares them).
export type Vehicle = 'bike' | 'car' | 'parts';
export const VEHICLES: Vehicle[] = ['bike', 'car', 'parts'];

export const CAR_WORDS = ['car', 'cars', 'four wheeler', 'four wheelers', '4 wheeler', '4 wheelers', '4wheeler', '4wheelers', 'hatchback', 'sedan', 'swift', 'i20', 'i10', 'creta', 'baleno', 'brezza', 'wagon r', 'wagonr', 'alto', 'nexon', 'innova'];
export const PARTS_WORDS = ['spare part', 'spare parts', 'auto part', 'auto parts', 'car part', 'car parts', 'bike part', 'bike parts', 'axlio'];
export const BIKE_WORDS = ['bike', 'bikes', 'scooter', 'scooty', 'motorcycle', 'motorbike', 'two wheeler', '2 wheeler', 'activa', 'splendor', 'pulsar'];

// "wagon r", "four-wheeler" and "car_service" are read as spaces so a campaign name like car_service_ad matches as words.
const norm = (s: string) => ` ${s.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ')} `;
const alt = (w: string[]) => new RegExp(`(?<![a-z0-9])(?:${w.join('|')})(?![a-z0-9])`, 'i');
const CAR_RE = alt(CAR_WORDS), PARTS_RE = alt(PARTS_WORDS), BIKE_RE = alt(BIKE_WORDS);

/** 'parts' for clear spare-part wording, 'car' for car wording with no bike wording, 'bike' for bike wording alone, else null. */
export function detectVehicle(text: unknown): Vehicle | null {
  const t = norm(String(text ?? '').slice(0, 6000));
  if (t.trim() === '') return null;
  if (PARTS_RE.test(t)) return 'parts';
  const car = CAR_RE.test(t), bike = BIKE_RE.test(t);
  if (car && bike) return null;   // "bike and car": do not guess
  return car ? 'car' : bike ? 'bike' : null;
}

export const cleanVehicle = (v: unknown): Vehicle | null => (VEHICLES.includes(String(v) as Vehicle) ? (String(v) as Vehicle) : null);

/** Columns to add to a new lead insert. Empty for bike or no signal, so the database default applies and nothing changes for bike leads. */
export const vehicleCols = (v: Vehicle | null): Record<string, string> => (v === 'car' || v === 'parts' ? { vehicle: v, vehicle_source: 'auto' } : {});

/** Moves a lead from the default bike to car or parts once. It never touches a lead the desk set (vehicle_source = 'desk') and never turns a tagged lead back to bike.
 *  The rule lives in the update filters, so there is no read first and a missing column (before the migration) only makes the update a no-op. */
export async function upgradeVehicle(db: any, leadId: string, v: Vehicle | null): Promise<boolean> {
  if (!leadId || (v !== 'car' && v !== 'parts')) return false;
  try {
    const { data } = await db.from('leads').update({ vehicle: v, vehicle_source: 'auto' }).eq('id', leadId).eq('vehicle', 'bike').or('vehicle_source.is.null,vehicle_source.eq.auto').select('id');
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}
