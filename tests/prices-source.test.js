const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const site = JSON.parse(read('src/site.json'));
const inr = (n) => '₹' + n.toLocaleString('en-IN');
const pages = () => { const o = ['index.html']; for (const d of fs.readdirSync(root)) if (!['node_modules', 'dist-site', 'dist-admin', 'admin'].includes(d) && fs.existsSync(path.join(root, d, 'index.html'))) o.push(d + '/index.html'); return o; };
const sources = () => [...fs.readdirSync(path.join(root, 'src')).filter((f) => /\.(html|jsonld)$/.test(f)).map((f) => 'src/' + f), 'scripts/build_pages.py', 'assets/js/hero.js'];

test('site.json is the one list of prices, the fees and the warranty length', () => {
  assert.equal(site.warrantyDays, 30); assert.equal(site.advance, 199); assert.equal(site.bigBike, 300);
  for (const id of ['basic', 'general', 'full', 'repair', 'sos']) { assert.ok(site.services[id].price >= 0); assert.ok(site.services[id].includes.length >= 3, id); }
});
test('the database holds every service, add-on and fee, and the app defaults match site.json', () => {
  const seed = read('supabase/migrations/20261006000000_init.sql');
  for (const id of Object.keys(site.services)) assert.match(seed, new RegExp(`\\('${id}','service',`), 'seed ' + id);
  for (const id of Object.keys(site.addons)) assert.match(seed, new RegExp(`\\('${id}','addon',`), 'seed ' + id);
  const app = read('assets/js/app.js');
  for (const [id, s] of Object.entries(site.services)) assert.match(app, new RegExp(`id: '${id}', kind: 'service'[^}]*price: ${s.price}\\b`), 'app ' + id);
  for (const [id, n] of Object.entries(site.addons)) assert.match(app, new RegExp(`id: '${id}', kind: 'addon'[^}]*price: ${n}\\b`), 'app ' + id);
  const fees = read('supabase/migrations/20261012000000_prices_fees_includes.sql');
  assert.match(fees, /\('advance','fee',/); assert.match(fees, /\('bigbike','fee',/);
});
test('the services in the database carry the "what is included" lists from site.json', () => {
  const m = read('supabase/migrations/20261012000000_prices_fees_includes.sql');
  assert.match(m, /add column if not exists includes jsonb not null default '\[\]'::jsonb/);
  for (const [id, s] of Object.entries(site.services)) {
    const hit = m.match(new RegExp(`update public\\.services set includes = '(\\[[^\\n]*\\])'::jsonb where id = '${id}'`));
    assert.ok(hit, 'no includes for ' + id); assert.ok(JSON.parse(hit[1]).length >= 3, id);
  }
  assert.match(read('assets/js/app.js'), /includes: \[/);
});
test('the services table accepts fee rows', () => assert.match(read('supabase/migrations/20261012000000_prices_fees_includes.sql'), /check \(kind in \('service','addon','fee'\)\)/));
test('no source file holds a price as typed text: prices come from site.json through tokens', () => {
  const lit = /₹\s?(799|1,299|1,999|199|349|149|99|49|300)(?![0-9,])|1999\b/;
  for (const f of sources()) assert.doesNotMatch(read(f), lit, f);
});
test('every price shown on a generated page equals site.json and can be refreshed in the browser', () => {
  for (const f of pages()) {
    const h = read(f);
    for (const m of h.matchAll(/<span data-price="([a-z]+)">([^<]*)<\/span>/g)) { const n = site.services[m[1]]?.price ?? site.addons[m[1]]; assert.equal(m[2], n === 0 ? 'Free' : inr(n), f + ' ' + m[1]); }
    for (const m of h.matchAll(/<span data-fee="([a-z]+)">([^<]*)<\/span>/g)) assert.equal(m[2], inr(m[1] === 'advance' ? site.advance : site.bigBike), f + ' ' + m[1]);
  }
  const home = read('index.html'); for (const id of ['basic', 'general', 'full']) assert.ok(home.includes(`data-price="${id}"`), 'home ' + id);
  const sv = read('services/index.html'); for (const id of [...Object.keys(site.services), ...Object.keys(site.addons)]) assert.ok(sv.includes(`data-price="${id}"`), 'services ' + id);
});
test('the browser refreshes those prices from the live database', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /\[data-price\]/); assert.match(app, /\[data-fee\]/);
  assert.match(read('assets/js/hero.js'), /data-price/);
  assert.doesNotMatch(read('assets/js/hero.js'), /PRICE = \{/);
});
test('the warranty is 30 days everywhere and the old 15-day wording is gone', () => {
  for (const f of [...pages(), ...sources(), 'supabase/functions/_shared/ai.ts', 'README.md']) assert.doesNotMatch(read(f), /15[- ]days?|15 days|15-day|Labour is covered/i, f);
  assert.match(read('index.html'), /30-day service warranty/);
  assert.match(read('terms/index.html'), /Our service work is covered for 30 days/);
  assert.match(read('refund-policy/index.html'), /within 30 days/);
  assert.match(read('supabase/functions/_shared/ai.ts'), /30 days/);
});
test('prices and fees are read from the services table on the server, not from settings', () => {
  assert.match(read('supabase/functions/_shared/util.ts'), /'bigbike'/);
  assert.doesNotMatch(read('supabase/functions/_shared/util.ts'), /getSetting\(db, 'big_bike_surcharge'/);
  const hook = read('supabase/functions/whatsapp-webhook/index.ts');
  assert.doesNotMatch(hook, /getSetting\(db, 'booking_advance'/); assert.doesNotMatch(hook, /getSetting\(db, 'big_bike_surcharge'/);
  const admin = read('admin/admin.js');
  assert.doesNotMatch(admin, /id="st-adv"/); assert.doesNotMatch(admin, /id="st-big"/);
  assert.match(admin, /fee\(/);
});
test('the booking steps show what is included in the chosen service', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /What is included/); assert.match(app, /class="included"/);
  assert.match(read('assets/css/style.css'), /\.included\b/);
});
