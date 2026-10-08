/* Mechanix Pro — pure booking logic (no DOM). Used by app.js in the browser and by tests/ in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_LOGIC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PACKAGES = ['basic', 'general', 'full'];
  var KM_TXT = { 'new': 'New bike (first service)', lt3: 'Under 3,000 km since last service', mid: '3,000–6,000 km since last service', gt6: 'Over 6,000 km since last service', unsure: 'Not sure' };
  var ISSUE_TXT = { start: 'Hard to start', pickup: 'Low pickup or mileage', brake: 'Brakes weak or noisy', chain: 'Chain noise or loose chain', clutch: 'Clutch hard or slipping', gear: 'Gear shifting problem', battery: 'Battery or self-start', tyre: 'Puncture or worn tyre', leak: 'Oil leak', heat: 'Engine heating', elec: 'Lights, horn or wiring', susp: 'Suspension noise', rain: 'Pre-monsoon check', range: 'Range dropped or charging problem', sw: 'Display or app problem' };

  function rupee(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function find(items, id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
  function findModel(bikes, brand, name) {
    var list = (bikes && bikes[brand]) || [], n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    for (var i = 0; i < list.length; i++) if (list[i][0].toLowerCase() === n) return list[i];
    return null;
  }
  function recommend(st) {
    if (st.type === 'e') return 'repair';
    var r = { 'new': 'basic', lt3: 'basic', mid: 'general', gt6: 'full', unsure: 'general', '': 'general' }[st.km] || 'general';
    if (st.issues.length && r === 'basic') r = 'general';
    if (st.issues.length >= 4 && r === 'general') r = 'full';
    if (!st.km && st.issues.length) r = 'repair';
    return r;
  }
  function surcharge(st, service, cfg) { return st.cc === 'big' && PACKAGES.indexOf(service.id) > -1 ? (cfg.bigBikeSurcharge || 0) : 0; }
  function total(st, items, cfg) {
    var s = find(items, st.service); if (!s) return 0;
    var t = s.price + surcharge(st, s, cfg);
    st.addons.forEach(function (a) { var x = find(items, a); if (x) t += x.price; });
    return t;
  }
  function bikeTitle(st) {
    var b = (st.brand && st.brand !== 'Other' ? st.brand + ' ' : '') + (st.model || 'your bike');
    return st.nick ? '"' + st.nick + '" (' + b.trim() + ')' : b.trim();
  }
  function isRoad(st) { return st.place === 'road' || st.service === 'sos'; }
  function buildMessage(st, items, cfg, whenText, ref) {
    var sv = find(items, st.service), road = isRoad(st);
    var placeTxt = { pickup: 'Pick up and drop (please collect my bike)', home: 'At my home or office', road: 'Stuck on the road (I will share my live location)', unsure: 'Not sure, please advise' }[road ? 'road' : st.place];
    var extras = st.addons.map(function (a) { var x = find(items, a); return x ? x.name : ''; }).filter(Boolean);
    var lines = ['Hi Mechanix Pro, I would like a quote for my bike:', '',
      'Bike: ' + bikeTitle(st) + (st.cc === 'big' ? ' (above 180cc)' : ''),
      'Service: ' + (sv ? sv.name : '') + (extras.length ? ' + ' + extras.join(', ') : '')];
    if (st.km) lines.push('Last service: ' + KM_TXT[st.km]);
    if (st.issues.length) lines.push('Problems: ' + st.issues.map(function (i) { return ISSUE_TXT[i] || i; }).join(', '));
    if (String(st.note || '').trim()) lines.push('Note: ' + st.note.trim());
    lines.push('Where: ' + placeTxt, 'Area: ' + st.area);
    if (String(st.address || '').trim()) lines.push('Address: ' + st.address.trim());
    if (cleanReg(st.reg)) lines.push('Registration: ' + cleanReg(st.reg));
    if (validGeo(st.lat, st.lng)) lines.push('Map pin: ' + mapsLink(st.lat, st.lng));
    if (!road) lines.push('Preferred time: ' + whenText);
    lines.push('Contact me by: ' + (st.contact === 'call' ? 'Phone call' : 'WhatsApp chat'));
    if (st.ref_code) lines.push('Referred by: ' + st.ref_code);
    if (cleanCoupon(st.coupon)) lines.push('Coupon code: ' + cleanCoupon(st.coupon));
    lines.push('Starting estimate: ' + rupee(total(st, items, cfg)), 'Name: ' + st.name.trim(), '', 'Please send me the quote. I will approve before work starts.');
    if (ref) lines.push('Booking ref: ' + ref);
    return lines.join('\n');
  }
  function leadPayload(st, dateIso, todayIso) {
    var asap = isRoad(st);
    return {
      name: st.name.trim(), phone: st.phone, area: st.area, bike_brand: st.brand, bike_model: st.model.trim(), bike_nickname: st.nick.trim(),
      big_bike: st.cc === 'big', bike_type: st.type, service_id: st.service, addons: st.addons, km_band: st.km, issues: st.issues,
      note: String(st.note || '').trim(), place: st.place, contact_pref: st.contact === 'call' ? 'call' : 'whatsapp', ref_code: st.ref_code || null, coupon_code: cleanCoupon(st.coupon) || null, request_type: st.requestType === 'callback' ? 'callback' : 'quote', reg_no: cleanReg(st.reg) || null, reminder_opt_in: st.reminder === true,
      email: validEmail(st.email) ? String(st.email).trim().toLowerCase() : null, email_marketing: validEmail(st.email) && st.emailOffers === true, campaign: st.campaign || null,
      address: String(st.address || '').trim() || null, lat: validGeo(st.lat, st.lng) ? st.lat : null, lng: validGeo(st.lat, st.lng) ? st.lng : null,
      preferred_date: asap ? (todayIso || dateIso) : dateIso, preferred_slot: asap ? 'asap' : (st.slot || (st.hour >= 9 ? hourGroup(st.hour) : '')), preferred_time: !asap && st.hour >= 9 && st.hour <= 19 ? windowLabel(st.hour) : null, consent_whatsapp: !!st.consent
    };
  }
  var AREA_COORDS = { 'HSR Layout': [12.9116, 77.6389], 'Koramangala': [12.9352, 77.6245], 'BTM Layout': [12.9166, 77.6101], 'Bellandur': [12.9304, 77.6784], 'Sarjapur Road': [12.9100, 77.6870], 'Electronic City': [12.8452, 77.6602], 'Marathahalli': [12.9569, 77.7011], 'Bommanahalli': [12.9081, 77.6247], 'JP Nagar': [12.9063, 77.5857] };
  function validGeo(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) && lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98; }
  function distanceKm(lat1, lng1, lat2, lng2) {
    var R = 6371, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function nearestArea(lat, lng) {
    if (!validGeo(lat, lng)) return null;
    var best = null, bd = Infinity;
    Object.keys(AREA_COORDS).forEach(function (name) { var d = distanceKm(lat, lng, AREA_COORDS[name][0], AREA_COORDS[name][1]); if (d < bd) { bd = d; best = name; } });
    return bd <= 5 ? best : 'Other area';
  }
  function mapsLink(lat, lng) { return 'https://maps.google.com/?q=' + lat.toFixed(5) + ',' + lng.toFixed(5); }
  var CRUISER_NAMES = /Avenger|Dominar|Intruder|Thunderbird|Bullet|Classic|Meteor|Himalayan|Scram|Interceptor|Continental|Shotgun|Guerrilla|Hunter|CB350|H.ness/i;
  var SPORTS_NAMES = /Apache|Pulsar|FZ|Gixxer|R15|MT-15|Xtreme|Raider|Hornet|Duke|^RC|CB200X|CB300F|Karizma|Xpulse|Ronin|Adventure|V-Strom|CBZ|Impulse|Hunk|Achiever|Ignitor|Stunner|Twister|Fazer|SZ|Gladiator|GS ?150|Ninja|Panigale|Monster/i;
  var CRUISER_BRANDS = ['Royal Enfield', 'Jawa / Yezdi', 'Harley-Davidson', 'Benelli'];
  var SPORTS_BRANDS = ['Kawasaki', 'Triumph', 'BMW Motorrad', 'Ducati', 'Husqvarna', 'Aprilia', 'KTM'];
  var RETRO_NAMES = /Bonneville|Thruxton|Speed Twin|Scrambler Icon|Eliminator|Vulcan|W175|Electra/i;
  function styleOf(brand, row) {
    if (row[1] === 'e') return 'electric';
    if (row[1] === 's') return 'scooter';
    if (CRUISER_BRANDS.indexOf(brand) > -1 || CRUISER_NAMES.test(row[0]) || RETRO_NAMES.test(row[0])) return 'cruiser';
    if (SPORTS_BRANDS.indexOf(brand) > -1 || SPORTS_NAMES.test(row[0])) return 'sports';
    return 'commuter';
  }
  function modelSlug(brand, name) { return (brand + ' ' + name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function tileImage(brand, row, photos) { return photos && photos[modelSlug(brand, row[0])] ? '/assets/img/models/' + modelSlug(brand, row[0]) + '.webp' : '/assets/img/tile-' + styleOf(brand, row) + '.svg'; }
  var EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
  function validEmail(v) { var t = String(v == null ? '' : v).trim(); return t.length <= 120 && EMAIL_RE.test(t); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function addDaysIso(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayLabelFor(iso) { var d = new Date(iso + 'T12:00:00Z'); return DAYNAMES[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3); }
  /* A month for the calendar picker (weeks start on Sunday). Days before today and beyond maxAhead days are disabled. */
  function calendarGrid(year, month, todayIso, maxAhead) {
    var startDow = new Date(Date.UTC(year, month, 1)).getUTCDay(), count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(), last = addDaysIso(todayIso, maxAhead), cells = [], i;
    for (i = 0; i < startDow; i++) cells.push(null);
    for (i = 1; i <= count; i++) { var iso = year + '-' + pad2(month + 1) + '-' + pad2(i); cells.push({ d: i, iso: iso, disabled: iso < todayIso || iso > last, today: iso === todayIso }); }
    while (cells.length % 7) cells.push(null);
    var weeks = []; for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    var ty = +todayIso.slice(0, 4), tm = +todayIso.slice(5, 7) - 1, ly = +last.slice(0, 4), lm = +last.slice(5, 7) - 1, cur = year * 12 + month;
    return { title: MONTHS[month] + ' ' + year, year: year, month: month, weeks: weeks, canPrev: cur > ty * 12 + tm, canNext: cur < ly * 12 + lm };
  }
  function h12(x) { return x % 12 === 0 ? 12 : x % 12; }
  function ampm(x) { return x < 12 ? 'AM' : 'PM'; }
  function windowLabel(h) { return ampm(h) === ampm(h + 1) ? h12(h) + '–' + h12(h + 1) + ' ' + ampm(h) : h12(h) + ' ' + ampm(h) + '–' + h12(h + 1) + ' ' + ampm(h + 1); }
  function hourGroup(h) { return h < 12 ? 'morning' : h < 16 ? 'afternoon' : 'evening'; }
  /* One-hour arrival windows from 9 AM to 8 PM. Today only offers windows that start at least two hours from now. */
  function timeWindows(dateIso, now) {
    var ist = new Date(now.getTime() + 330 * 60000), today = ist.toISOString().slice(0, 10), minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes(), earliest = Math.ceil((minutes + 120) / 60), out = [];
    for (var h = 9; h <= 19; h++) out.push({ hour: h, label: windowLabel(h), group: hourGroup(h), disabled: dateIso < today || (dateIso === today && h < earliest) });
    return out;
  }
  function whenLabel(iso, h) { return dayLabelFor(iso) + ' · ' + windowLabel(h); }
  function cleanReg(v) { var t = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(t) ? t : null; }
  function b64u(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(t) { var x = String(t).replace(/-/g, '+').replace(/_/g, '/'); while (x.length % 4) x += '='; var bin = atob(x), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  /* A build as a link: bike, package and problems only. Never a name, number, email or address. */
  function encodeBuild(st) { return b64u(JSON.stringify({ b: st.brand, m: st.model, t: st.type, c: st.cc, n: st.nick, k: st.km, i: st.issues, s: st.service, a: st.addons })); }
  function decodeBuild(token, bikes, items) {
    var o; try { o = JSON.parse(unb64u(token)); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || !bikes || typeof o.b !== 'string' || !Object.prototype.hasOwnProperty.call(bikes, o.b)) return null;
    var uniq = function (a, ok, max) { var out = []; (Array.isArray(a) ? a : []).forEach(function (x) { if (typeof x === 'string' && ok(x) && out.indexOf(x) < 0 && out.length < max) out.push(x); }); return out; };
    var kind = function (id, k) { return items.some(function (x) { return x.id === id && x.kind === k; }); };
    return {
      brand: o.b, model: String(o.m == null ? '' : o.m).slice(0, 40), type: ['m', 's', 'e'].indexOf(o.t) > -1 ? o.t : '', cc: o.c === 'big' ? 'big' : 'std', nick: String(o.n == null ? '' : o.n).slice(0, 24),
      km: Object.prototype.hasOwnProperty.call(KM_TXT, o.k) ? o.k : '', issues: uniq(o.i, function (x) { return Object.prototype.hasOwnProperty.call(ISSUE_TXT, x); }, 15),
      service: typeof o.s === 'string' && kind(o.s, 'service') ? o.s : '', addons: uniq(o.a, function (x) { return kind(x, 'addon'); }, 10)
    };
  }
  function buildDraftMessage(st, items, cfg, link) {
    var sv = find(items, st.service);
    var lines = ['Hi Mechanix Pro, I am still choosing and would like help finishing this:', '', 'Bike: ' + bikeTitle(st) + (st.cc === 'big' ? ' (above 180cc)' : '')];
    if (sv) { var ex = st.addons.map(function (a) { var x = find(items, a); return x ? x.name : ''; }).filter(Boolean); lines.push('Service: ' + sv.name + (ex.length ? ' + ' + ex.join(', ') : '')); }
    if (st.km) lines.push('Last service: ' + KM_TXT[st.km]);
    if (st.issues.length) lines.push('Problems: ' + st.issues.map(function (i) { return ISSUE_TXT[i] || i; }).join(', '));
    if (sv) lines.push('Starting estimate: ' + rupee(total(st, items, cfg || {})));
    if (link) lines.push('My build: ' + link);
    lines.push('', 'Please call or message me to finish the booking.');
    return lines.join('\n');
  }
  function shouldPromptExit(o) {
    if (!o.hasBuild || o.sent || o.promptedBefore) return false;
    if (o.trigger === 'idle' && o.step < 2) return false;
    return true;
  }
  function cleanCoupon(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20); }
  function prefillExtras(search, serviceIds) {
    var p = new URLSearchParams(search || ''), out = { nick: '', service: '' };
    out.nick = (p.get('nick') || '').replace(/<[^>]*>/g, '').replace(/[<>"\u0000-\u001f]/g, '').trim().slice(0, 24);
    var wantS = (p.get('service') || '').trim().toLowerCase(); if (wantS && (serviceIds || []).indexOf(wantS) > -1) out.service = wantS;
    return out;
  }
  function prefillFromQuery(search, bikes) {
    var p = new URLSearchParams(search || ''), out = { brand: '', model: '' };
    var wantB = (p.get('brand') || '').trim().toLowerCase(), wantM = (p.get('model') || '').trim().toLowerCase();
    var brands = Object.keys(bikes || {});
    for (var i = 0; i < brands.length; i++) if (brands[i].toLowerCase() === wantB) { out.brand = brands[i]; break; }
    if (out.brand && wantM) { var list = bikes[out.brand]; for (var j = 0; j < list.length; j++) if (list[j][0].toLowerCase() === wantM) { out.model = list[j][0]; break; } }
    return out;
  }
  /* A calendar file for the visitor's chosen slot (India time, one hour). Empty when there is no slot, e.g. roadside help. */
  function icsFor(st, ref, serviceName) {
    if (!st || st.place === 'road' || !st.dateIso || st.hour == null) return '';
    var d = st.dateIso.replace(/-/g, ''), h = function (n) { return String(n).padStart(2, '0') + '0000'; };
    var esc = function (t) { return String(t || '').replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); };
    var bike = st.nick ? '"' + st.nick + '" (' + [st.brand, st.model].filter(Boolean).join(' ') + ')' : [st.brand, st.model].filter(Boolean).join(' ') || 'your bike';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mechanix Pro//Booking//EN', 'BEGIN:VEVENT',
      'UID:' + (ref || 'draft') + '@mechanixpro.in', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
      'DTSTART;TZID=Asia/Kolkata:' + d + 'T' + h(st.hour), 'DTEND;TZID=Asia/Kolkata:' + d + 'T' + h(st.hour + 1),
      'SUMMARY:' + esc('Mechanix Pro: ' + (serviceName || 'bike service')), 'LOCATION:' + esc(st.area || 'Bengaluru'),
      'DESCRIPTION:' + esc('Doorstep service for ' + bike + '. Booking ' + (ref || '(pending)') + '. Quote and approval on WhatsApp.'),
      'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  }
  function captureAttribution(search, store) {
    var p = new URLSearchParams(search || ''), saved = {};
    try { saved = JSON.parse(store.getItem('mxp_attr') || '{}') || {}; } catch (e) { saved = {}; }
    var ref = (p.get('ref') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
    var camp = (p.get('campaign') || p.get('utm_campaign') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
    var out = { ref_code: ref || saved.ref_code || null, campaign: camp || saved.campaign || null };
    try { store.setItem('mxp_attr', JSON.stringify(out)); } catch (e) {}
    return out;
  }
  function callLink(num) { var d = String(num || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return /^91[6-9]\d{9}$/.test(d) ? 'tel:+' + d : null; }
  return { prefillExtras: prefillExtras, icsFor: icsFor, calendarGrid: calendarGrid, dayLabelFor: dayLabelFor, timeWindows: timeWindows, hourGroup: hourGroup, windowLabel: windowLabel, whenLabel: whenLabel, addDaysIso: addDaysIso, cleanReg: cleanReg, encodeBuild: encodeBuild, decodeBuild: decodeBuild, buildDraftMessage: buildDraftMessage, shouldPromptExit: shouldPromptExit, validEmail: validEmail, modelSlug: modelSlug, cleanCoupon: cleanCoupon, styleOf: styleOf, tileImage: tileImage, prefillFromQuery: prefillFromQuery, nearestArea: nearestArea, distanceKm: distanceKm, mapsLink: mapsLink, validGeo: validGeo, captureAttribution: captureAttribution, callLink: callLink, rupee: rupee, findModel: findModel, recommend: recommend, total: total, buildMessage: buildMessage, leadPayload: leadPayload, bikeTitle: bikeTitle, KM_TXT: KM_TXT, ISSUE_TXT: ISSUE_TXT, PACKAGES: PACKAGES };
});
