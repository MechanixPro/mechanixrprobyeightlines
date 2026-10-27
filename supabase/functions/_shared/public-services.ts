// The public price list that partner sites (such as Axlio) may show. Names and descriptions are fixed here, so they always match the Mechanix Pro website;
// only the prices come from the Prices tab. Pure function so Node can test it.
const SITE = 'https://mechanixpro.in';
export const PUBLIC_ITEMS: { id: string; kind: 'service' | 'addon'; name: string; blurb: string; url: string }[] = [
  { id: 'basic', kind: 'service', name: 'Basic service', blurb: '15 checkpoints: engine oil level, air filter, spark plug, brakes, chain, tyres, battery and lights.', url: '/book/?service=basic' },
  { id: 'general', kind: 'service', name: 'Standard service', blurb: '24 checkpoints: oil level and condition, air and oil filter, brakes, clutch, chain, tyres, fork, battery and lights.', url: '/book/?service=general' },
  { id: 'full', kind: 'service', name: 'Full service', blurb: '28 checkpoints with an engine oil change, minor adjustments, a final road test and a foam wash.', url: '/book/?service=full' },
  { id: 'repair', kind: 'service', name: 'Repair or problem check', blurb: 'We find the cause and quote the fix before any work starts.', url: '/book/?service=repair' },
  { id: 'sos', kind: 'service', name: 'Roadside emergency visit', blurb: 'A mechanic comes to you when your bike breaks down or gets a puncture.', url: '/roadside/' },
  { id: 'wash', kind: 'addon', name: 'Foam wash', blurb: 'Foam wash for a clean bike, no water wasted at your door.', url: '/book/' },
  { id: 'chain', kind: 'addon', name: 'Chain clean and lube', blurb: 'Chain cleaned, lubed and tension checked.', url: '/book/' },
  { id: 'brake', kind: 'addon', name: 'Brake tuning', blurb: 'Pads and levers checked and adjusted for a firm, even stop.', url: '/book/' },
  { id: 'tyre', kind: 'addon', name: 'Tyre and puncture check', blurb: 'Pressure, tread and puncture check at your door.', url: '/book/' },
  { id: 'battery', kind: 'addon', name: 'Battery health test', blurb: 'Know if your battery will start the bike tomorrow.', url: '/book/' },
];

export function buildPublicServices(rows: { id: string; price: unknown; active?: boolean }[], source = 'axlio') {
  const price = new Map(rows.filter((r) => r.active !== false).map((r) => [r.id, Number(r.price)]));
  const bigFee = price.get('bigbike');
  const items = PUBLIC_ITEMS.filter((i) => price.has(i.id) && Number.isFinite(price.get(i.id)!)).map((i) => ({
    id: i.id, kind: i.kind, name: i.name, description: i.blurb, price_inr: price.get(i.id)!,
    ...(price.has(i.id + '250') ? { price_150_to_250cc_inr: price.get(i.id + '250')! } : {}),
    ...(price.has(i.id + '500') ? { price_251_to_500cc_inr: price.get(i.id + '500')! } : price.has(i.id + '250') ? { above_250cc_surcharge_inr: bigFee ?? 300 } : {}),
    price_note: price.has(i.id + '250') ? (price.has(i.id + '500') ? 'Starting price, excluding GST, for bikes and scooters up to 149cc. 150 to 250cc and 251 to 500cc have their own prices. Pickup and drop is free in the serviceable area' : 'Starting price, excluding GST, for bikes and scooters up to 149cc. 150 to 250cc has its own price; above 250cc add the surcharge to that price') : i.kind === 'service' && i.id !== 'sos' ? 'Starting price, excluding GST' : 'excluding GST',
    book_url: `${SITE}${i.url}${i.url.includes('?') ? '&' : '?'}campaign=${source}`,
  }));
  return {
    brand: 'Mechanix Pro', city: 'Bengaluru', vehicles: ['bike', 'scooter', 'electric scooter'], hours: 'Open 24/7', currency: 'INR',
    quote_policy: 'A quote is sent on WhatsApp first. Work starts only after the customer approves it.',
    contact: { website: SITE, whatsapp_url: 'https://wa.me/918042303061', call: '+918310621498' },
    roadside_url: `${SITE}/roadside/?campaign=${source}`, items, updated_at: new Date().toISOString(),
  };
}
