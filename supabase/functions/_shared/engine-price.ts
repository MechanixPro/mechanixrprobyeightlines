// Prices a booking from rows of the services table. Pure (no database, no imports) so Node can test it.
// A package (basic, general, full) has a price per engine class: the row itself (up to 149cc), id+250 (150 to 250cc) and id+500 (251 to 500cc).
// Before the 251-500cc rows existed, the large class was the 150-250cc price plus the above-250cc surcharge; that is still the fallback.
// A missing tier row falls back to the standard price, so a half-set price sheet never breaks a booking.
export type PriceRow = { id: string; kind: string; name: string; price: number };
export const PACKAGES = ['basic', 'general', 'full'];
export function wantsTier(serviceId: string, engine: string | null): boolean { return PACKAGES.includes(serviceId) && (engine === 'mid' || engine === 'big'); }
export function priceFromRows(data: PriceRow[], serviceId: string, addons: string[], bigBike: boolean, engine: string | null) {
  const base = data.find((r) => r.id === serviceId && r.kind === 'service');
  if (!base) return null;
  const row = (suffix: string) => data.find((r) => r.id === serviceId + suffix && r.kind === 'service');
  const tiered = wantsTier(serviceId, engine);
  const tier = !tiered ? null : engine === 'big' ? (row('500') ?? row('250')) : row('250');
  const svc = tier ? { ...base, price: tier.price, name: tier.name } : base; // keeps the package id, takes the tier's price and name
  const bigFee = data.find((r) => r.id === 'bigbike' && r.kind === 'fee');
  // With an engine class, only the old fallback (no 251-500cc row) adds the surcharge. Without one (an old booking or client), the old yes/no rule applies.
  const surcharge = !PACKAGES.includes(serviceId) ? 0 : engine ? (engine === 'big' && !row('500') ? Number(bigFee?.price ?? 300) : 0) : (bigBike ? Number(bigFee?.price ?? 300) : 0);
  const validAddons = data.filter((r) => r.kind === 'addon' && addons.includes(r.id));
  return { service: svc, addons: validAddons, total: svc.price + surcharge + validAddons.reduce((s, r) => s + r.price, 0) };
}
