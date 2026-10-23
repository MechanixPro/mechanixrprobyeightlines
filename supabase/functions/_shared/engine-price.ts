// Prices a booking from rows of the services table. Pure (no database, no imports) so Node can test it.
// A package (basic, general, full) has a second price for 150 to 250cc bikes (the row with the same id plus 250).
// Above 250cc is that price plus the above-250cc surcharge. A missing or off tier row falls back to the standard price.
export type PriceRow = { id: string; kind: string; name: string; price: number };
export const PACKAGES = ['basic', 'general', 'full'];
export function wantsTier(serviceId: string, engine: string | null): boolean { return PACKAGES.includes(serviceId) && (engine === 'mid' || engine === 'big'); }
export function priceFromRows(data: PriceRow[], serviceId: string, addons: string[], bigBike: boolean, engine: string | null) {
  const base = data.find((r) => r.id === serviceId && r.kind === 'service');
  if (!base) return null;
  const tier = wantsTier(serviceId, engine) ? data.find((r) => r.id === serviceId + '250' && r.kind === 'service') : null;
  const svc = tier ? { ...base, price: tier.price, name: tier.name } : base; // keeps the package id, takes the tier's price and name
  const bigFee = data.find((r) => r.id === 'bigbike' && r.kind === 'fee');
  const surcharge = bigBike && PACKAGES.includes(serviceId) ? Number(bigFee?.price ?? 300) : 0;
  const validAddons = data.filter((r) => r.kind === 'addon' && addons.includes(r.id));
  return { service: svc, addons: validAddons, total: svc.price + surcharge + validAddons.reduce((s, r) => s + r.price, 0) };
}
