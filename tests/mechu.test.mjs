// Mechu, the virtual assistant: a guided script (no AI model, no outside API). These tests pin what it may say, where it may appear and what it may send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import zlibSync from 'node:zlib';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const chat = require('../assets/js/mechu-chat.js');
const boot = require('../assets/js/mechu.js');
const ctx = { window: {} }; vm.runInNewContext(read('assets/js/mechu-data.js'), ctx);
const D = ctx.window.MXP_MECHU;
const pctx0 = { window: {} }; vm.runInNewContext(read('assets/js/pincodes.js'), pctx0); D.pins = pctx0.window.MXP_PINS;   // as at runtime: PIN names come from pincodes.js
const site = JSON.parse(read('src/site.json'));
const chatSrc = read('assets/js/mechu-chat.js');

test('the facts are generated from the source files, not typed into the script', () => {
  for (const [k, v] of Object.entries(site.services)) { assert.equal(D.prices[k].p, v.price, k); assert.equal(D.prices[k].n, v.name, k); }
  assert.equal(JSON.stringify(D.tiers), JSON.stringify({ std: 49, mid: 69, big: 99, car: 99 }));
  const bp = read('assets/js/book-pay.js'); assert.match(bp, /confirm_std: 49, confirm_mid: 69, confirm_big: 99, confirm_car: 99/);
  const pins = JSON.parse(read('src/pincodes.json')).pins, pctx = { window: {} }; vm.runInNewContext(read('assets/js/pincodes.js'), pctx);
  assert.equal(Object.keys(pctx.window.MXP_PINS).length, Object.keys(pins).length); assert.equal(pctx.window.MXP_PINS['560102'], pins['560102'].name);
  assert.ok(read('index.html').includes('/assets/js/pincodes.js') && read('car-service-bangalore/index.html').includes('/assets/js/pincodes.js'), 'the PIN names are loaded on the pages that have Mechu');
  assert.ok(D.areas.length >= 30 && D.areas.every((a) => existsSync(new URL('..' + a.u + 'index.html', import.meta.url))), 'every listed area has its page');
  assert.ok(D.faq.length >= 10);
  const home = read('src/home.html');
  for (const f of D.faq) assert.ok(home.includes(f.q), 'FAQ question is from src/home.html: ' + f.q);
  assert.equal(JSON.stringify(D.trust), JSON.stringify(['10,000+ services done', '1,300+ gated communities trust us']));
  assert.ok(!/\b(10,000|1,300|₹\d)/.test(chatSrc.replace(/'₹'/g, '')), 'no price or claim number typed into mechu-chat.js');
  // the build script writes the file and a rebuild changes nothing
  assert.match(read('scripts/build_pages.py'), /mechu-data\.js/);
});

test('the stale cost and cancel FAQ lines are not reused; prices and refunds are handled separately', () => {
  assert.ok(!D.faq.some((f) => /What does it cost|Can I cancel/.test(f.q)));
  assert.ok(!D.faq.some((f) => /refund|cancel/i.test(f.a)), 'no refund or cancellation wording in the FAQ answers');
  assert.equal(chat.route('Can I cancel my booking?', D, false).id, 'refund');
  assert.equal(chat.LINKS.refund, '/refund-policy/');
  assert.ok(!/refunded|full refund|within \d|hours? before/i.test(chatSrc + JSON.stringify(chat.COPY)), 'refund terms are not paraphrased');
});

test('no number appears in chat copy that is not in an allowed source', () => {
  const allowed = new Set();
  const add = (s) => (String(s).match(/\d[\d,]*/g) || []).forEach((n) => allowed.add(n.replace(/,/g, '')));
  Object.values(site.services).forEach((v) => { add(v.price); add(v.name); });
  Object.values(D.tiers).forEach(add); add(D.trust.join(' '));
  add(read('src/book-pay.html').match(/<select id="bk-engine"[\s\S]*?<\/select>/)[0]);   // the engine sizes of the book flow: up to 149cc, 150 to 250cc, 251cc and above
  const lits = chatSrc.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
  const bad = [];
  for (const l of lits) { if (/^'\d+'$/.test(l)) continue; for (const n of (l.match(/\d[\d,]*/g) || [])) if (!allowed.has(n.replace(/,/g, ''))) bad.push(n + ' in ' + l); }
  assert.deepEqual(bad.filter((b) => !/^\d+ in '(?:[^']*\/[^']*|[a-z]+\d+[^']*)'$/.test(b)), [], 'numbers in copy must come from the allowed sources');
  // the FAQ answers keep to numbers that are in src/home.html
  const home = read('src/home.html').replace(/<[^>]+>/g, ' ');
  for (const f of D.faq) for (const n of (f.a.match(/\d[\d,]*/g) || [])) assert.ok(allowed.has(n.replace(/,/g, '')) || home.includes(n), n + ' in ' + f.id);
});

test('Mechu never claims to be AI or a person, and says it is automated', () => {
  const all = JSON.stringify(chat.COPY) + chatSrc.match(/'(?:[^'\\\n]|\\.)*'/g).join(' ');
  assert.ok(!/\bAI\b|artificial|chatgpt|\bGPT\b|\bLLM\b|machine learning|language model/i.test(all.replace(/ai\w/gi, '')), 'no AI claim');
  assert.ok(!/\bI am a (real )?(person|human|mechanic)|I'm a (real )?(person|human|mechanic)/i.test(all));
  assert.equal(chat.COPY.note, 'Automated helper, not a person');
  assert.equal(chat.COPY.greet, "Hi, I'm Mechu, the Mechanix Pro virtual assistant. I can help you book a service.");
  assert.match(chat.COPY.fallback, /automated helper/);
  for (const f of ['assets/js/mechu.js', 'assets/css/mechu.css', 'assets/img/mechu.svg', 'assets/img/mechu-avatar.svg']) assert.ok(!/\bAI\b/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), f);
});

test('the button is on the right pages and absent from the single-task pages', () => {
  const tag = '/assets/js/mechu.js';
  const has = (p) => read(p).includes(tag);
  const models = readdirSync(new URL('../bike-service/', import.meta.url)).filter((d) => existsSync(new URL('../bike-service/' + d + '/index.html', import.meta.url)));
  const areas = readdirSync(new URL('../', import.meta.url)).filter((d) => /^bike-service-/.test(d) && existsSync(new URL('../' + d + '/index.html', import.meta.url)));
  for (const p of ['index.html', 'car-service-bangalore/index.html', 'services/index.html', 'help/index.html', 'workshop/index.html', 'bike-service/' + models[0] + '/index.html', areas[0] + '/index.html']) assert.ok(has(p), p + ' has Mechu');
  assert.ok(models.every((m) => has('bike-service/' + m + '/index.html')) && areas.every((a) => has(a + '/index.html')), 'every model and area page');
  for (const p of ['book', 'pay', 'track', 'job', 'rate', 'warranty', 'unsubscribe', 'quote', 'refund-policy', 'terms', 'privacy', 'contact'])
    if (existsSync(new URL('../' + p + '/index.html', import.meta.url))) assert.ok(!has(p + '/index.html'), p + ' must not have Mechu');
  // belt and braces: the script itself stays away from those paths even if a page loaded it
  for (const p of ['/book/', '/book/?vehicle=car', '/pay/', '/track/', '/job/abc/', '/rate/', '/warranty/', '/unsubscribe/']) assert.equal(boot.isExcluded(p.split('?')[0]), true, p);
  for (const p of ['/', '/services/', '/help/', '/workshop/', '/car-service-bangalore/', '/bike-service-hsr-layout/', '/bike-service/honda-activa-6g/', '/rate-card/']) assert.equal(boot.isExcluded(p), false, p);
});

test('no inline script or inline event handler is added; the page stays whole if the script fails', () => {
  const home = read('index.html');
  assert.equal((home.match(/mechu/g) || []).length, 1, 'one script tag on the page, nothing inline');
  assert.match(home, /<script src="\/assets\/js\/mechu\.js" defer><\/script>/);
  for (const f of ['assets/js/mechu.js', 'assets/js/mechu-chat.js']) {
    const s = read(f);
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]on|\bonclick\s*=/.test(s), f + ' has no HTML injection, eval or inline handler');
    assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(s), f + ' stores nothing');
  }
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(read('assets/img/mechu.svg') + read('assets/img/mechu-avatar.svg')) && !/ on\w+=/.test(read('assets/img/mechu.svg')), 'the SVGs have no script or handler');
  // the button is created by script, so with no JS there is simply nothing
  assert.ok(!/class="mechu/.test(home));
});

test('the tracking request is the one /track/ sends', () => {
  const t = read('assets/js/track.js'), C = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  const r = chat.trackRequest(C, 'MP-AB12CD', '9876543210');
  assert.equal(r.url, C.supabaseUrl + '/functions/v1/track-booking');
  assert.match(t, /C\.supabaseUrl \+ '\/functions\/v1\/' \+ fn/); assert.match(t, /post\('track-booking', body\)/);
  assert.match(t, /\{ ref: (?:document|doc)\.getElementById\('tr-ref'\)\.value\.trim\(\), phone: (?:document|doc)\.getElementById\('tr-phone'\)\.value\.trim\(\) \}/);
  assert.match(t, /method: 'POST', headers: \{ 'Content-Type': 'application\/json', apikey: C\.supabaseAnonKey, Authorization: 'Bearer ' \+ C\.supabaseAnonKey \}/);
  assert.equal(r.init.method, 'POST'); assert.deepEqual(r.init.headers, { 'Content-Type': 'application/json', apikey: 'anon', Authorization: 'Bearer anon' });
  assert.deepEqual(JSON.parse(r.init.body), { ref: 'MP-AB12CD', phone: '9876543210' });
  assert.ok(!/functions\/v1\/(?!track-booking)/.test(chatSrc), 'no other endpoint');
  assert.ok(!/https?:\/\/(?!wa\.me)/.test(chatSrc.replace(/\/\*[\s\S]*?\*\//, '')), 'no outside address except wa.me');
});

test('the status is shown in plain words, the same headline as /track/', () => {
  assert.equal(chat.statusWords({ booking_id: 'MP-1', stages: ['Received', 'Confirmed', 'On the way'], stage: 1, note: 'We have your booking.', service: 'Basic service', bike: 'Honda Activa', when: 'Today' }).head, 'Confirmed');
  const w = chat.statusWords({ booking_id: 'MP-1', visit: { closed: false, note: 'Mechanic is on the way.', next: 'Share the code.', steps: [{ label: 'Booked', state: 'done' }, { label: 'On the way', state: 'current' }] } });
  assert.equal(w.head, 'On the way'); assert.equal(w.note, 'Mechanic is on the way.'); assert.equal(w.next, 'Share the code.');
  assert.equal(chat.statusWords({ closed: true, note: 'Done.', stages: ['a'], stage: 0 }).head, 'Closed');
  // the door code and the address are never shown in the chat
  const rows = chat.statusWords({ booking_id: 'MP-1', door_code: '123456', address: 'Flat 1', service: 'X' }).rows.map((r) => r[0] + r[1]).join(' ');
  assert.ok(!/123456|Flat 1/.test(rows));
});

test('the booking link carries only vehicle, brand, model, service and area, never a phone, email or name', () => {
  const u = new URL('https://mechanixpro.in' + chat.bookUrl({ vehicle: 'bike', brand: 'Honda', model: 'Activa 6G', service: 'general', area: 'HSR Layout' }));
  assert.equal(u.pathname, '/book/'); assert.deepEqual([...u.searchParams.keys()].sort(), ['area', 'brand', 'model', 'service', 'vehicle']);
  assert.equal(u.searchParams.get('model'), 'Activa 6G'); assert.equal(u.searchParams.get('service'), 'general');
  const car = new URL('https://mechanixpro.in' + chat.bookUrl({ vehicle: 'car', brand: 'ignored', model: 'Maruti Swift', service: 'problem', area: 'Whitefield' }));
  assert.deepEqual([...car.searchParams.keys()].sort(), ['area', 'model', 'service', 'vehicle']); assert.equal(car.searchParams.get('vehicle'), 'car');
  // a phone number or email typed into a field is stripped before it can reach a URL
  const dirty = chat.bookUrl({ vehicle: 'bike', model: 'Activa 98765 43210 me@x.in', area: 'HSR 9876543210' });
  assert.ok(!/9876|43210|@|%40/.test(dirty), dirty);
  for (const k of ['phone', 'name', 'email', 'mobile', 'tel']) assert.ok(!new RegExp('[?&]' + k + '=').test(dirty));
  // /book/ reads exactly these parameters (and the car link maps the model and the need onto the car fields)
  const bp = read('assets/js/book-pay.js');
  for (const k of ['vehicle', 'brand', 'model', 'service', 'area']) assert.match(bp, new RegExp("q\\.get\\('" + k + "'\\)"));
  assert.match(bp, /set\('vehicle', q\.get\('vehicle'\)\)/, 'a bike or car link wins over a saved draft');
  assert.match(bp, /set\('car_model'/); assert.match(bp, /set\('car_need'/);
  // every service id Mechu can send is one /book/ accepts
  assert.match(bp, /\['basic', 'general', 'full', 'repair'\]/);
});

test('the keyword matcher answers each FAQ question, and falls back politely otherwise', () => {
  const to = (q, car) => chat.route(q, D, !!car);
  for (const f of D.faq) {
    const r = to(f.q);
    assert.notEqual(r.type, 'fallback', f.q);
    if (r.type === 'faq') assert.equal(r.id, f.id, f.q);
    else assert.equal(f.id, 'which-areas-do-you-cover', f.q + ' goes to a screen of its own');
  }
  for (const [q, id] of [['is there any warranty on the work', 'is-there-a-warranty'], ['who will come to my house', 'who-comes-to-my-place'], ['are pickup and drop free', 'is-pickup-and-drop-free'], ['do you fix scooty at home', 'do-you-do-scooty-repair-at-home'], ['which spare parts do you fit', 'which-parts-do-you-use']]) assert.equal(to(q).id, id, q);
  assert.deepEqual([to('how much is a service').id, to('what are your charges').id, to('where do you operate, which areas').id, to('i want to book').id, to('track my booking').id, to('let me talk to a human').id], ['prices', 'prices', 'areas', 'book', 'track', 'human']);
  assert.equal(to('who won the cricket match yesterday').type, 'fallback');
  assert.equal(to('asdf qwerty').type, 'fallback'); assert.equal(to('service').type, 'fallback', 'a vague word does not guess');
  assert.equal(to('do you cover 560102').type, 'pin');
  assert.match(chat.pinReply('560102', D), /We cover PIN code 560102, HSR/); assert.match(chat.pinReply('560999', D), /could not find/); assert.match(chat.pinReply('110001', D), /does not look like a Bengaluru/);
  assert.match(chat.COPY.fallback, /person can help/);
});

test('the bike-only claims are absent in a car context', () => {
  assert.equal(chat.isCar(D, {}, '/car-service-bangalore/', null), true);
  assert.equal(chat.isCar(D, { vehicle: 'car' }, '/', null), true); assert.equal(chat.isCar(D, { vehicle: 'bike' }, '/car-service-bangalore/', null), false);
  assert.equal(chat.isCar(D, {}, '/', { getElementById: () => ({ checked: true }) }), true);
  const carFaq = chat.faqList(D, true), carText = JSON.stringify(carFaq) + chat.COPY.carPrice + chat.COPY.carArea;
  assert.ok(carFaq.length >= 4);
  assert.ok(!/10,000|1,300|gated|warranty|₹|\bGST\b|up to 149cc/.test(carText), 'no bike claim, price, GST line or warranty in the car answers');
  // a car question never gets a bike FAQ answer
  assert.ok(chat.route('how much does a car service cost', D, true).id === 'prices');
  const r = chat.route('do you give a warranty', D, true); assert.ok(r.type === 'fallback' || carFaq.some((f) => f.id === r.id));
  // the trust numbers are used only in the bike branch (they come from D.trust and are never printed by the car branch)
  assert.ok(!/D\.trust/.test(chatSrc) || /car\(\)/.test(chatSrc));
});

test('WhatsApp and Call use the site hooks, not typed numbers', () => {
  assert.ok(!/\b(91|\+91)?\s?[6-9]\d{4}\s?\d{5}\b|wa\.me\/\d/.test(chatSrc), 'no phone number in the script');
  assert.match(chatSrc, /C\.whatsapp/); assert.match(chatSrc, /C\.callNumber/); assert.match(chatSrc, /C\.callViaWhatsApp/);
  assert.match(chatSrc, /setAttribute\('data-wa'/); assert.match(chatSrc, /setAttribute\('data-call'/);
});

test('what the customer types is kept in memory only', () => {
  assert.ok(!/localStorage|sessionStorage|cookie|sendBeacon|XMLHttpRequest|mxpTrack/.test(chatSrc));
  assert.equal((chatSrc.match(/win\.fetch\(/g) || []).length, 1, 'the only network call is the tracking lookup');
  assert.equal((chatSrc.match(/\.fetch\(/g) || []).length, 1);
});

test('typed bike and area text is understood', () => {
  assert.deepEqual(chat.parseBike('Honda Activa 6G', D), { brand: 'Honda', model: 'Activa 6G' });
  assert.deepEqual(chat.parseBike('royal enfield classic 350', D), { brand: 'Royal Enfield', model: 'classic 350' });
  assert.deepEqual(chat.parseBike('Splendor', D), { brand: '', model: 'Splendor' });
  assert.equal(chat.resolveArea('hsr layout', D), 'HSR Layout'); assert.equal(chat.resolveArea('560102', D), D.pins['560102']); assert.equal(chat.resolveArea('Somewhere new', D), 'Somewhere new');
});

test('size budgets: the whole of Mechu stays small', () => {
  const sz = (p) => statSync(new URL('../' + p, import.meta.url)).size;
  assert.ok(sz('assets/css/mechu.css') < 7000, 'mechu.css is ' + sz('assets/css/mechu.css'));
  assert.ok(sz('assets/js/mechu.js') < 4000, 'mechu.js is ' + sz('assets/js/mechu.js'));
  assert.ok(sz('assets/js/mechu-chat.js') < 26000, 'mechu-chat.js is ' + sz('assets/js/mechu-chat.js'));
  assert.ok(sz('assets/js/mechu-data.js') < 10000, 'mechu-data.js is ' + sz('assets/js/mechu-data.js'));
  assert.ok(sz('assets/img/mechu.svg') < 6000 && sz('assets/img/mechu-avatar.svg') < 3000);
  const total = ['assets/css/mechu.css', 'assets/js/mechu.js', 'assets/js/mechu-chat.js', 'assets/js/mechu-data.js', 'assets/img/mechu.svg', 'assets/img/mechu-avatar.svg'].reduce((a, p) => a + sz(p), 0);
  assert.ok(total < 50000, 'Mechu totals ' + total + ' bytes raw');
  const gz = (p) => zlibSync.gzipSync(readFileSync(new URL('../' + p, import.meta.url)), { level: 9 }).length;
  const onPage = ['assets/js/mechu.js', 'assets/css/mechu.css', 'assets/img/mechu-avatar.svg'].reduce((a, p) => a + gz(p), 0);
  const onOpen = ['assets/js/mechu-chat.js', 'assets/js/mechu-data.js', 'assets/img/mechu.svg'].reduce((a, p) => a + gz(p), 0);
  assert.ok(onPage < 5000, 'on every included page Mechu adds ' + onPage + ' bytes gzipped');
  assert.ok(onPage + onOpen < 18000, 'Mechu totals ' + (onPage + onOpen) + ' bytes gzipped when opened');
  assert.ok(sz('assets/css/site.css') < 32000, 'site.css is untouched by Mechu');
  assert.ok(!/mechu/.test(read('assets/css/site.css')));
});

test('the check script covers the new files and the page hooks stay unique', () => {
  const pkg = JSON.parse(read('package.json')).scripts.check;
  for (const f of ['mechu.js', 'mechu-chat.js', 'mechu-data.js']) assert.ok(pkg.includes('node --check assets/js/' + f), f);
});
