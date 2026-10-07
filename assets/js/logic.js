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
    var placeTxt = { home: 'At my home or office', road: 'Stuck on the road (I will share my live location)', unsure: 'Not sure, please advise' }[road ? 'road' : st.place];
    var extras = st.addons.map(function (a) { var x = find(items, a); return x ? x.name : ''; }).filter(Boolean);
    var lines = ['Hi Mechanix Pro, I would like a quote for my bike:', '',
      'Bike: ' + bikeTitle(st) + (st.cc === 'big' ? ' (above 180cc)' : ''),
      'Service: ' + (sv ? sv.name : '') + (extras.length ? ' + ' + extras.join(', ') : '')];
    if (st.km) lines.push('Last service: ' + KM_TXT[st.km]);
    if (st.issues.length) lines.push('Problems: ' + st.issues.map(function (i) { return ISSUE_TXT[i] || i; }).join(', '));
    if (String(st.note || '').trim()) lines.push('Note: ' + st.note.trim());
    lines.push('Where: ' + placeTxt, 'Area: ' + st.area);
    if (String(st.address || '').trim()) lines.push('Address: ' + st.address.trim());
    if (validGeo(st.lat, st.lng)) lines.push('Map pin: ' + mapsLink(st.lat, st.lng));
    if (!road) lines.push('Preferred time: ' + whenText);
    lines.push('Contact me by: ' + (st.contact === 'call' ? 'Phone call' : 'WhatsApp chat'));
    if (st.ref_code) lines.push('Referred by: ' + st.ref_code);
    lines.push('Starting estimate: ' + rupee(total(st, items, cfg)), 'Name: ' + st.name.trim(), '', 'Please send me the quote. I will approve before work starts.');
    if (ref) lines.push('Booking ref: ' + ref);
    return lines.join('\n');
  }
  function leadPayload(st, dateIso, todayIso) {
    var asap = isRoad(st);
    return {
      name: st.name.trim(), phone: st.phone, area: st.area, bike_brand: st.brand, bike_model: st.model.trim(), bike_nickname: st.nick.trim(),
      big_bike: st.cc === 'big', bike_type: st.type, service_id: st.service, addons: st.addons, km_band: st.km, issues: st.issues,
      note: String(st.note || '').trim(), place: st.place, contact_pref: st.contact === 'call' ? 'call' : 'whatsapp', ref_code: st.ref_code || null, campaign: st.campaign || null,
      address: String(st.address || '').trim() || null, lat: validGeo(st.lat, st.lng) ? st.lat : null, lng: validGeo(st.lat, st.lng) ? st.lng : null,
      preferred_date: asap ? (todayIso || dateIso) : dateIso, preferred_slot: asap ? 'asap' : st.slot, consent_whatsapp: !!st.consent
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
  var SPORTS_NAMES = /Apache|Pulsar|FZ|Gixxer|R15|MT-15|Xtreme|Raider|Hornet|Duke|^RC|CB200X|CB300F|Karizma|Xpulse|Ronin|Adventure|V-Strom/i;
  function styleOf(brand, row) {
    if (row[1] === 'e') return 'electric';
    if (row[1] === 's') return 'scooter';
    if (brand === 'Royal Enfield' || brand === 'Jawa / Yezdi' || CRUISER_NAMES.test(row[0])) return 'cruiser';
    if (SPORTS_NAMES.test(row[0])) return 'sports';
    return 'commuter';
  }
  function tileImage(brand, row) { return '/assets/img/tile-' + styleOf(brand, row) + '.svg'; }
  function prefillFromQuery(search, bikes) {
    var p = new URLSearchParams(search || ''), out = { brand: '', model: '' };
    var wantB = (p.get('brand') || '').trim().toLowerCase(), wantM = (p.get('model') || '').trim().toLowerCase();
    var brands = Object.keys(bikes || {});
    for (var i = 0; i < brands.length; i++) if (brands[i].toLowerCase() === wantB) { out.brand = brands[i]; break; }
    if (out.brand && wantM) { var list = bikes[out.brand]; for (var j = 0; j < list.length; j++) if (list[j][0].toLowerCase() === wantM) { out.model = list[j][0]; break; } }
    return out;
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
  return { styleOf: styleOf, tileImage: tileImage, prefillFromQuery: prefillFromQuery, nearestArea: nearestArea, distanceKm: distanceKm, mapsLink: mapsLink, validGeo: validGeo, captureAttribution: captureAttribution, callLink: callLink, rupee: rupee, findModel: findModel, recommend: recommend, total: total, buildMessage: buildMessage, leadPayload: leadPayload, bikeTitle: bikeTitle, KM_TXT: KM_TXT, ISSUE_TXT: ISSUE_TXT, PACKAGES: PACKAGES };
});
