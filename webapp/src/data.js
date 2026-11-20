import bengaluru from './assets/city-bengaluru-hero.png';
import delhi from './assets/city-delhi-hero.png';

// Live cities and their illustrations. Only Bengaluru is live today. Delhi has artwork but is "coming soon".
export const ART = { Bengaluru: bengaluru, Delhi: delhi };
export const STATES = [
  { name: 'Karnataka', cities: [['Bengaluru', true], ['Mysore', false]] },
  { name: 'Maharashtra', cities: [['Mumbai', false], ['Pune', false], ['Nagpur', false], ['Kalyan', false]] },
  { name: 'Delhi', cities: [['Delhi', false]] },
  { name: 'Haryana', cities: [['Gurugram', false], ['Faridabad', false]] },
  { name: 'Uttar Pradesh', cities: [['Noida', false], ['Ghaziabad', false], ['Lucknow', false], ['Greater Noida', false]] },
  { name: 'Telangana', cities: [['Hyderabad', false]] },
  { name: 'Tamil Nadu', cities: [['Chennai', false]] },
  { name: 'West Bengal', cities: [['Kolkata', false]] },
  { name: 'Gujarat', cities: [['Ahmedabad', false]] },
  { name: 'Rajasthan', cities: [['Jaipur', false]] },
  { name: 'Kerala', cities: [['Kochi', false]] },
  { name: 'Madhya Pradesh', cities: [['Bhopal', false], ['Indore', false]] },
];
export const stateOf = (city) => STATES.find((s) => s.cities.some(([c]) => c === city))?.name || '';
export const isLive = (city) => STATES.some((s) => s.cities.some(([c, l]) => c === city && l));

// Prices from the live price table (bikes up to 149cc, before GST). Totals include 18% GST.
export const SERVICES = [
  { id: 'basic', name: 'Basic service', price: 499, points: 15, bullets: ['Engine oil level check', 'Brake cleaning and adjustment', 'Chain cleaning and lubrication'] },
  { id: 'standard', name: 'Standard service', price: 799, points: 24, bullets: ['Everything in Basic', 'Added filter and brake checks', 'Written findings in photos'], hot: true },
  { id: 'full', name: 'Full service', price: 1299, points: 28, bullets: ['Engine oil change', 'Minor adjustments', 'Foam wash'] },
];
export const total = (p) => Math.round(p * 1.18 * 100) / 100;
export const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

// Sample areas. The real list comes from the PIN code table.
export const AREAS = {
  Bengaluru: [
    ['HSR Layout', 44, 52], ['Koramangala', 56, 40], ['Indiranagar', 66, 30], ['Whitefield', 86, 28],
    ['Jayanagar', 36, 64], ['BTM Layout', 48, 62], ['Marathahalli', 76, 44], ['Electronic City', 60, 84],
  ],
};
export const FAQ = [
  ['What is the small fee for?', 'It holds your slot and comes off your final bill. If you cancel more than 2 hours before the slot, it is refunded in full.'],
  ['What if extra work is needed?', 'The mechanic sends an itemised quote on WhatsApp. Nothing extra starts until you approve it.'],
  ['What if I decline the quote?', 'A visit-and-quote charge of ₹349 applies once someone has been assigned. If you go ahead, it is not added.'],
  ['Is the work guaranteed?', 'If the same work fails within 30 days, we redo it free.'],
];

// Engine classes decide the price and the confirmation fee: std up to 149cc, mid 150 to 250cc, big 251cc and above.
export const CLASS_LABEL = { std: 'Up to 149cc', mid: '150 to 250cc', big: '251 to 500cc' };
export const FEE = { std: 49, mid: 69, big: 99, car: 99 };
export const PRICE = { basic: { std: 499, mid: 799, big: 999 }, standard: { std: 799, mid: 999, big: 1499 }, full: { std: 1299, mid: 1799, big: 2199 } };
export const ADDONS = [['wash', 'Foam wash', 199], ['chain', 'Chain clean and lube', 149], ['brake', 'Brake check', 99], ['tyre', 'Tyre pressure and check', 49], ['battery', 'Battery health check', 0]];
export const BRANDS = {
  Honda: [['Activa 6G', 'std'], ['Shine 125', 'std'], ['Unicorn 160', 'mid'], ['CB350', 'big']],
  TVS: [['Jupiter', 'std'], ['Raider 125', 'std'], ['Apache RTR 160', 'mid']],
  Bajaj: [['Pulsar 150', 'mid'], ['Pulsar 220F', 'mid'], ['Dominar 400', 'big']],
  Hero: [['Splendor Plus', 'std'], ['Xtreme 160R', 'mid']],
  'Royal Enfield': [['Classic 350', 'big'], ['Hunter 350', 'big']],
  Suzuki: [['Access 125', 'std'], ['Gixxer 155', 'mid']],
  Yamaha: [['FZ-S', 'std'], ['R15', 'mid']],
  KTM: [['Duke 200', 'mid'], ['Duke 390', 'big']],
};
export const CAR_BRANDS = { Maruti: ['Swift', 'Baleno', 'Alto'], Hyundai: ['i20', 'Creta', 'Venue'], Honda: ['City', 'Amaze'], Tata: ['Nexon', 'Punch'], Mahindra: ['Thar', 'XUV700'] };
// Car prices are starting prices before GST. The exact price comes after the inspection.
export const CAR_SERVICES = [['inspection', 'Car inspection', 474, 'A doorstep check with written findings.'], ['basic', 'Basic car service', 1994, 'Periodic service. Exact quote after inspection.'], ['standard', 'Standard car service', 2535, 'Fuller service. Exact quote after inspection.']];
export const DAYS = ['Fri 20 Nov', 'Sat 21 Nov', 'Sun 22 Nov', 'Mon 23 Nov', 'Tue 24 Nov', 'Wed 25 Nov'];
export const SLOTS = [['Early morning', '7 to 9', false], ['Morning', '9 to 12', true], ['Afternoon', '12 to 4', true], ['Evening', '4 to 7', true]];
