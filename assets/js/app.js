/* Mechanix Pro — booking builder, WhatsApp hand-off, lead capture. No framework, no build step. */
(function () {
  'use strict';
  var C = window.MXP || {};
  var L = window.MXP_LOGIC;
  var KEY = 'mxp_build_v1';
  var DEFAULT_ITEMS = [
    { id: 'basic', kind: 'service', name: 'Basic service', price: 599, description: 'Oil level check, chain lube, brake adjust, wash', includes: ['Engine oil level check', 'Chain clean and lube', 'Brake adjustment', 'Wash and wipe'] },
    { id: 'general', kind: 'service', name: 'General service', price: 1299, description: 'Engine oil change, filter clean, 20-point check', includes: ['Engine oil change (brand of your choice)', 'Air filter clean and spark plug check', 'Chain clean, lube and adjust', 'Brake inspection and adjustment', 'Battery, lights and horn check', 'Tyre pressure and 20-point safety check', 'Wash and wipe'] },
    { id: 'full', kind: 'service', name: 'Full service', price: 1999, description: 'General service plus throttle body clean, brake pads check, polish', includes: ['Everything in the General service', 'Throttle body clean', 'Brake pads check', 'Polish'] },
    { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 199, description: 'Inspection visit; repair quoted before work starts', includes: ['Inspection visit at your location', 'Diagnosis of the problem', 'Itemised quote before any work starts'] },
    { id: 'sos', kind: 'service', name: 'Roadside emergency', price: 349, description: 'Puncture, battery or breakdown; mechanic dispatched now', includes: ['Mechanic dispatched to your location now', 'Puncture repair or battery help', 'Breakdown check and advice'] },
    { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 },
    { id: 'chain', kind: 'addon', name: 'Chain clean and lube', price: 149 },
    { id: 'brake', kind: 'addon', name: 'Brake tuning', price: 99 },
    { id: 'tyre', kind: 'addon', name: 'Tyre and puncture check', price: 49 },
    { id: 'battery', kind: 'addon', name: 'Battery health test', price: 0 },
    { id: 'advance', kind: 'fee', name: 'Booking advance', price: 199 },
    { id: 'bigbike', kind: 'fee', name: 'Above-180cc surcharge', price: 300 }
  ];
  var ICONS = {
    basic: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
    general: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z"/>',
    full: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    repair: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    sos: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'
  };
  function icon(id) { return '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">' + (ICONS[id] || ICONS.general) + '</svg></span>'; }
  var BIKES = window.MXP_BIKES || {};
  var BRANDS = Object.keys(BIKES).length ? Object.keys(BIKES) : ['Honda', 'Hero', 'TVS', 'Bajaj', 'Royal Enfield', 'Yamaha', 'Suzuki', 'KTM', 'Other'];
  var AREAS = ['HSR Layout', 'Koramangala', 'BTM Layout', 'Bellandur', 'Sarjapur Road', 'Electronic City', 'Marathahalli', 'Bommanahalli', 'JP Nagar', 'Other area'];
  var SLOTS = [['morning', 'Morning', '9 AM – 12 PM'], ['afternoon', 'Afternoon', '12 – 4 PM'], ['evening', 'Evening', '4 – 8 PM']];
  var STEPS = ['Your bike', 'What it needs', 'Your package', 'When & where'];
  var KM = [['new', 'New bike, first service'], ['lt3', 'Under 3,000 km'], ['mid', '3,000 – 6,000 km'], ['gt6', 'Over 6,000 km'], ['unsure', 'Not sure']];
  var ISSUES = [['start', 'Hard to start'], ['pickup', 'Low pickup or mileage'], ['brake', 'Brakes weak or noisy'], ['chain', 'Chain noise or loose chain'], ['clutch', 'Clutch hard or slipping'], ['gear', 'Gear shifting problem'], ['battery', 'Battery or self-start'], ['tyre', 'Puncture or worn tyre'], ['leak', 'Oil leak'], ['heat', 'Engine heating'], ['elec', 'Lights, horn or wiring'], ['susp', 'Suspension noise'], ['rain', 'Pre-monsoon check']];
  var ISSUES_EV = [['range', 'Range dropped or charging problem'], ['brake', 'Brakes weak or noisy'], ['tyre', 'Puncture or worn tyre'], ['elec', 'Lights, horn or wiring'], ['susp', 'Suspension noise'], ['sw', 'Display or app problem'], ['rain', 'Pre-monsoon check']];
  var PLACES = [['home', 'At my home or office'], ['road', 'I am stuck on the road'], ['unsure', 'Not sure, expert will advise']];
  var items = DEFAULT_ITEMS.slice();
  var st = load();
  var errMsg = '';
  var sending = false;
  var locating = false;
  var locMsg = '';

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rupee(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function svc(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
  function isEV() { return st.type === 'e'; }
  function services() { return items.filter(function (x) { return x.kind === 'service' && !(isEV() && ['basic', 'general', 'full'].indexOf(x.id) > -1); }); }
  function addons() { return items.filter(function (x) { return x.kind === 'addon'; }); }
  function load() {
    var d = { email: '', emailOffers: false, coupon: '', address: '', lat: null, lng: null, contact: 'whatsapp', step: 0, brand: '', model: '', type: '', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', picked: false, addons: [], place: 'home', area: '', date: 1, slot: '', name: '', phone: '', consent: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') for (var k in d) if (k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function days() { var out = [], t = new Date(); for (var i = 0; i < 6; i++) { var x = new Date(t); x.setDate(t.getDate() + i); out.push(x); } return out; }
  function dayLabel(x, i) { return i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : x.toLocaleDateString('en-IN', { weekday: 'short' }); }
  function dayStr(x) { return x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function isoDate(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }

  function fee(id, d) { var x = svc(id); return x ? x.price : d; }
  function cfg() { return { bigBikeSurcharge: fee('bigbike', 300), bookingAdvance: fee('advance', 199) }; }
  function priceLabel(n) { return n === 0 ? 'Free' : '\u20b9' + n.toLocaleString('en-IN'); }
  /* Prices typed on the pages are build-time defaults. Once the live prices load, every [data-price] and [data-fee] shows the live number. */
  function applyLivePrices() {
    document.querySelectorAll('[data-price]').forEach(function (el) { var x = svc(el.getAttribute('data-price')); if (x) el.textContent = priceLabel(x.price); });
    document.querySelectorAll('[data-fee]').forEach(function (el) { var x = svc(el.getAttribute('data-fee')); if (x) el.textContent = priceLabel(x.price); });
  }
  function includedBox(x, title) {
    var list = x && x.includes; if (!list || !list.length) return '';
    return '<div class="included"><b>' + esc(title || 'What is included') + '</b><ul>' + list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
  }
  function total() { return L.total(st, items, cfg()); }
  function bikeTitle() { return L.bikeTitle(st); }
  function findModel(brand, name) { return L.findModel(BIKES, brand, name); }
  function applyModel() {
    var m = findModel(st.brand, st.model);
    if (m) { st.type = m[1]; st.cc = m[2] ? 'big' : 'std'; } else st.type = '';
    if (isEV() && !svc(st.service) || (isEV() && ['basic', 'general', 'full'].indexOf(st.service) > -1)) { st.service = 'repair'; }
  }
  function modelNote() {
    var m = findModel(st.brand, st.model);
    if (!m) return st.model.trim().length > 1 ? 'Not in our list. No problem, our expert will confirm the details.' : '';
    return (m[1] === 's' ? 'Scooter' : m[1] === 'e' ? 'Electric scooter' : 'Motorcycle') + (m[2] && m[1] !== 'e' ? ', above 180cc' : m[1] === 'e' ? '' : ', up to 180cc');
  }
  function recommend() { return L.recommend(st); }
  function priceTxt(x) {
    var p = x.price + (st.cc === 'big' && ['basic', 'general', 'full'].indexOf(x.id) > -1 ? fee('bigbike', 300) : 0);
    return rupee(p);
  }

  /* ---------- builder render ---------- */
  function render() {
    var el = $('#builder'); if (!el) return;
    var s = st.step, h = '';
    h += '<div class="b-top"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b>Step ' + (s + 1) + ' of 4: ' + STEPS[s] + '</b><span class="saved">Saved on this phone</span></div>';
    h += '<div class="progress" aria-hidden="true">' + STEPS.map(function (_, i) { return '<i class="' + (i <= s ? 'on' : '') + '"></i>'; }).join('') + '</div></div><div class="b-body fade">';
    if (s === 0) {
      h += '<span class="label" id="lb-brand">Brand</span><div class="chips" role="group" aria-labelledby="lb-brand">' + BRANDS.map(function (b) { return '<button type="button" class="chip" data-act="brand" data-v="' + esc(b) + '" aria-pressed="' + (st.brand === b) + '">' + esc(b) + '</button>'; }).join('') + '</div>';
      var list = BIKES[st.brand] || [];
      if (list.length) {
        if (list.length > 12) h += '<input id="mfilter" type="search" placeholder="Search your model" aria-label="Search your model" autocomplete="off" style="margin-bottom:10px">';
        h += '<span class="label" id="lb-model">Choose your model</span><div class="model-grid" role="group" aria-labelledby="lb-model">' + list.map(function (m) {
          var img = L.tileImage(st.brand, m, window.MXP_MODEL_PHOTOS || {});
          return '<button type="button" class="model-tile" data-act="model" data-name="' + esc(m[0].toLowerCase()) + '" data-v="' + esc(m[0]) + '" aria-pressed="' + (st.model.trim().toLowerCase() === m[0].toLowerCase()) + '"><img' + (img.indexOf('/models/') > -1 ? ' class="photo"' : '') + ' src="' + img + '" alt="" width="300" height="210" loading="lazy" decoding="async"><span>' + esc(m[0]) + '</span></button>';
        }).join('') + '</div>';
      }
      h += '<label class="label" for="f-model">' + (list.length ? 'Not listed? Type your model' : 'Model') + '</label><input id="f-model" data-f="model" list="models" maxlength="40" placeholder="' + (st.brand && st.brand !== 'Other' ? 'Pick from the list or type your model' : 'Type your bike model') + '" value="' + esc(st.model) + '" autocomplete="off"><datalist id="models">' + (BIKES[st.brand] || []).map(function (m) { return '<option value="' + esc(m[0]) + '">'; }).join('') + '</datalist>';
      h += '<p class="tiny muted" id="modelInfo" style="margin:6px 0 0">' + esc(modelNote()) + '</p>';
      h += '<span class="label" id="lb-cc">Engine size</span><div class="seg" id="ccSeg" role="group" aria-labelledby="lb-cc">' + ccSeg() + '</div>';
      h += '<label class="label" for="f-nick">Give your bike a name <span class="muted" style="font-weight:400">(optional)</span></label><input id="f-nick" data-f="nick" maxlength="24" placeholder="e.g. Bullet Raja" value="' + esc(st.nick) + '">';
      h += '<p class="tiny muted" style="margin-top:6px">We use it on your quote and service reminders.</p>';
    }
    if (s === 1) {
      if (isEV()) h += '<p class="note"><b>Electric bike.</b> No oil or spark plug work. Our expert checks brakes, tyres, suspension, wiring and battery health, and quotes anything else on WhatsApp.</p>';
      h += '<span class="label" id="lb-km">' + (isEV() ? 'Last service' : 'Kilometres since your last service') + '</span><div class="chips" role="group" aria-labelledby="lb-km">' + KM.map(function (k) { return '<button type="button" class="chip" data-act="km" data-v="' + k[0] + '" aria-pressed="' + (st.km === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>';
      h += '<span class="label" id="lb-iss">Anything wrong? <span class="muted" style="font-weight:400">(pick all that apply)</span></span><div class="chips" role="group" aria-labelledby="lb-iss">' + (isEV() ? ISSUES_EV : ISSUES).map(function (k) { return '<button type="button" class="chip" data-act="issue" data-v="' + k[0] + '" aria-pressed="' + (st.issues.indexOf(k[0]) > -1) + '">' + k[1] + '</button>'; }).join('') + '</div>';
      h += '<label class="label" for="f-note">Tell us more <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="f-note" data-f="note" rows="3" maxlength="300" placeholder="e.g. Makes a rattling sound at low speed">' + esc(st.note) + '</textarea>';
      h += '<p class="tiny muted" style="margin-top:6px">Not sure what it needs? Skip this. Our expert will ask you on WhatsApp.</p>';
    }
    if (s === 2) {
      var rec = recommend();
      h += '<p class="small muted" style="margin:0 0 10px">Our suggestion for ' + esc(st.nick || 'your bike') + ' is marked. Change it any time. Your exact quote comes on WhatsApp after our expert checks the details.</p>';
      services().forEach(function (x) {
        h += '<button type="button" class="opt" data-act="service" data-v="' + esc(x.id) + '" aria-pressed="' + (st.service === x.id) + '">' + icon(x.id) + '<span class="t"><b>' + esc(x.name) + (x.id === rec ? ' <i class="tag">Suggested</i>' : '') + '</b><span>' + esc(x.description || '') + '</span></span><span class="p"><small>from</small> ' + priceTxt(x) + '</span></button>';
      });
      h += includedBox(svc(st.service), 'What is included in ' + (svc(st.service) ? svc(st.service).name : 'this service'));
      h += '<span class="label" style="margin-top:20px">Add-ons</span>';
      addons().forEach(function (a) {
        var on = st.addons.indexOf(a.id) > -1;
        h += '<label class="toggle-row"><span class="t">' + esc(a.name) + '</span><span class="p">' + (a.price ? '+' + rupee(a.price) : 'Free') + '</span><span class="switch"><input type="checkbox" role="switch" data-act="addon" data-v="' + esc(a.id) + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(a.name) + '"><i></i></span></label>';
      });
      var sv = svc(st.service), isl = st.issues.map(issueName).filter(Boolean);
      h += '<div class="package"><div class="nm">Your package for ' + esc(bikeTitle()) + '</div><b>' + esc(sv ? sv.name : '') + '</b><ul>' + st.addons.map(function (a) { var x = svc(a); return x ? '<li>' + esc(x.name) + '</li>' : ''; }).join('') + isl.map(function (t) { return '<li>Check: ' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    }
    if (s === 3) {
      if (st.service === 'sos') st.place = 'road';
      h += includedBox(svc(st.service), 'Your package: ' + (svc(st.service) ? svc(st.service).name : ''));
      h += '<span class="label" id="lb-place">Where will the work happen?</span><div class="chips" role="group" aria-labelledby="lb-place">' + PLACES.map(function (k) { return '<button type="button" class="chip" data-act="place" data-v="' + k[0] + '" aria-pressed="' + (st.place === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>';
      h += '<p class="tiny muted" style="margin:8px 0 0">Most routine services are done at your doorstep. If a job needs workshop tools, we pick up the bike only after you share a one-time code.</p>';
      var hasPin = L.validGeo(st.lat, st.lng);
      h += '<div class="locate"><button type="button" class="btn btn-ghost btn-sm" data-act="locate"' + (locating ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>' + (locating ? 'Finding you…' : hasPin ? 'Update my location' : 'Use my current location') + '</button>' + (hasPin ? '<button type="button" class="btn btn-ghost btn-sm" data-act="clearloc">Remove</button>' : '') + '</div>';
      if (locMsg || hasPin) h += '<p class="small locmsg" role="status">' + esc(locMsg || ('Location saved. Nearest area: ' + (st.area || 'Other area') + '.')) + '</p>';
      h += '<label class="label" for="f-area">Area</label><select id="f-area" data-f="area"><option value="">Choose your area</option>' + AREAS.map(function (a) { return '<option' + (st.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select>';
      h += '<label class="label" for="f-address">Flat, street or landmark <span class="muted" style="font-weight:400">(helps the mechanic find you)</span></label><input id="f-address" data-f="address" maxlength="200" autocomplete="street-address" placeholder="e.g. Flat 4B, Green Apartments, 27th Main" value="' + esc(st.address) + '">';
      if (st.place !== 'road') {
        var ds = days();
        h += '<span class="label" id="lb-day">Preferred day</span><div class="chips" role="group" aria-labelledby="lb-day">' + ds.map(function (x, i) { return '<button type="button" class="chip" data-act="date" data-v="' + i + '" aria-pressed="' + (st.date === i) + '">' + dayLabel(x, i) + ' · ' + dayStr(x) + '</button>'; }).join('') + '</div>';
        h += '<span class="label" id="lb-slot">Preferred time</span><div class="chips" role="group" aria-labelledby="lb-slot">' + SLOTS.map(function (x) { return '<button type="button" class="chip" data-act="slot" data-v="' + x[0] + '" aria-pressed="' + (st.slot === x[0]) + '">' + x[1] + ' <span class="tiny">' + x[2] + '</span></button>'; }).join('') + '</div>';
      } else h += '<p class="small" style="margin:14px 0 0"><b>Stuck on the road?</b> Send this and share your live location on WhatsApp. We send the nearest mechanic.</p>';
      h += '<label class="label" for="f-name">Your name</label><input id="f-name" data-f="name" autocomplete="name" maxlength="60" value="' + esc(st.name) + '">';
      h += '<label class="label" for="f-phone">Mobile number</label><input id="f-phone" data-f="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="10-digit number" value="' + esc(st.phone) + '">';
      h += '<span class="label" id="lb-contact">How should our expert reach you?</span><div class="chips" role="group" aria-labelledby="lb-contact"><button type="button" class="chip" data-act="contact" data-v="whatsapp" aria-pressed="' + (st.contact !== 'call') + '">WhatsApp chat</button><button type="button" class="chip" data-act="contact" data-v="call" aria-pressed="' + (st.contact === 'call') + '">Phone call</button></div>';
      h += '<label class="label" for="f-email">Email <span class="muted" style="font-weight:400">(optional, for your booking confirmation)</span></label><input id="f-email" data-f="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="you@example.com" value="' + esc(st.email) + '">';
      h += '<label class="check"><input type="checkbox" data-act="emailOffers"' + (st.emailOffers ? ' checked' : '') + '><span>Also email me offers and service reminders. You can unsubscribe any time.</span></label>';
      h += '<label class="label" for="f-coupon">Coupon code <span class="muted" style="font-weight:400">(optional)</span></label><input id="f-coupon" data-f="coupon" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="e.g. MONSOON10" value="' + esc(st.coupon) + '"><p class="tiny muted" style="margin:6px 0 0">Your expert applies it to your quote on WhatsApp.</p>';
      h += '<label class="check"><input type="checkbox" data-act="consent"' + (st.consent ? ' checked' : '') + '><span>Send me my quote, booking updates and reminders on WhatsApp. Reply STOP anytime. See our <a href="/privacy/">Privacy Policy</a>.</span></label>';
      h += '<p class="note" style="margin-top:14px"><b>What happens next:</b> you send this on WhatsApp. Our expert calls or messages you, checks what is needed, and sends your quote. Work starts only after you approve it.</p>';
      if (C.turnstileSiteKey) h += '<div id="ts" style="margin-top:12px"></div>';
    }
    if (errMsg) h += '<p class="err" role="alert">' + esc(errMsg) + '</p>';
    h += '</div><div class="b-foot"><div class="sum"><b><small>from</small> ' + rupee(total()) + '</b><span>Starting estimate, GST included. Final quote on WhatsApp.</span></div>';
    if (s > 0) h += '<button class="btn btn-ghost btn-sm" type="button" data-act="back">Back</button>';
    h += s < 3 ? '<button class="btn btn-primary" type="button" data-act="next">Continue</button>' : '<button class="btn btn-wa" type="button" data-act="send"' + (sending ? ' disabled' : '') + '>' + (sending ? 'Opening…' : 'Send on WhatsApp') + '</button>';
    h += '</div>';
    el.innerHTML = h;
    if (s === 3 && C.turnstileSiteKey) mountTurnstile();
    renderSummary();
  }
  function ccSeg() { return '<button type="button" data-act="cc" data-v="std" aria-pressed="' + (st.cc === 'std') + '">Up to 180cc</button><button type="button" data-act="cc" data-v="big" aria-pressed="' + (st.cc === 'big') + '">Above 180cc</button>'; }
  function issueName(id) { var l = ISSUES.concat(ISSUES_EV); for (var i = 0; i < l.length; i++) if (l[i][0] === id) return l[i][1]; return ''; }

  function validate() {
    errMsg = '';
    if (st.step === 0) {
      if (!st.brand) errMsg = 'Choose your bike brand.';
      else if (st.model.trim().length < 2) errMsg = 'Enter your bike model.';
    }
    if (st.step === 2 && !svc(st.service)) errMsg = 'Choose a service.';
    if (st.step === 3) {
      if (!st.area) errMsg = 'Choose your area.';
      else if (st.place !== 'road' && !st.slot) errMsg = 'Pick a preferred time.';
      else if (st.name.trim().length < 2) errMsg = 'Enter your name.';
      else if (!/^[6-9]\d{9}$/.test(st.phone)) errMsg = 'Enter a valid 10-digit mobile number.';
      else if (st.email.trim() && !L.validEmail(st.email)) errMsg = 'That email address does not look right. Fix it or leave it empty.';
    }
    return !errMsg;
  }

  /* ---------- WhatsApp hand-off ---------- */
  function waNumber() { return String(C.whatsapp || '').replace(/\D/g, ''); }
  function waLink(text) { return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(text); }
  function buildMessage(ref) {
    var ds = days()[st.date], slot = SLOTS.filter(function (x) { return x[0] === st.slot; })[0];
    var when = dayLabel(ds, st.date) + ', ' + dayStr(ds) + ' · ' + (slot ? slot[1] + ' (' + slot[2] + ')' : '');
    return L.buildMessage(st, items, cfg(), when, ref);
  }
  function utm() {
    try {
      var p = new URLSearchParams(location.search), o = JSON.parse(sessionStorage.getItem('mxp_utm') || '{}');
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) { if (p.get(k)) o[k] = p.get(k).slice(0, 100); });
      sessionStorage.setItem('mxp_utm', JSON.stringify(o)); return o;
    } catch (e) { return {}; }
  }
  var tsToken = '';
  function mountTurnstile() {
    function go() { if (window.turnstile && $('#ts')) window.turnstile.render('#ts', { sitekey: C.turnstileSiteKey, callback: function (t) { tsToken = t; } }); }
    if (window.turnstile) return go();
    if (!document.getElementById('ts-js')) { var s = document.createElement('script'); s.id = 'ts-js'; s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = go; document.head.appendChild(s); }
  }
  function submitLead() {
    if (!C.supabaseUrl || !C.supabaseAnonKey) return Promise.resolve(null);
    var ds = days()[st.date];
    var body = Object.assign(L.leadPayload(st, isoDate(ds), isoDate(new Date())), { utm: utm(), turnstile_token: tsToken, page: location.pathname });
    var ctrl = 'AbortController' in window ? new AbortController() : null, t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    return fetch(C.supabaseUrl.replace(/\/$/, '') + '/functions/v1/submit-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
      body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { clearTimeout(t); return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || 'Failed'), { status: r.status }); return j; }); });
  }
  function track(name, params) {
    try { if (window.gtag) { window.gtag('event', name, params || {}); if (name === 'generate_lead' && C.googleAdsSendTo) window.gtag('event', 'conversion', { send_to: C.googleAdsSendTo, value: total(), currency: 'INR' }); } } catch (e) {}
  }
  function send() {
    if (!validate()) return render();
    if (!/^\d{12}$/.test(waNumber())) { errMsg = 'Booking is not set up yet: the business WhatsApp number is missing in config.js.'; return render(); }
    sending = true; render();
    submitLead().then(function (r) { finish(r && r.ref); }).catch(function (e) {
      if (e && e.status === 429) { sending = false; errMsg = 'Too many requests from this number. Please wait a few minutes or message us directly on WhatsApp.'; return render(); }
      if (e && e.status === 403) { sending = false; errMsg = 'Please complete the security check above and try again.'; return render(); }
      finish(null); // network/server issue: never lose the customer, go to WhatsApp anyway
    });
  }
  function finish(ref) {
    track('generate_lead', { service: st.service, area: st.area, value: total() });
    var url = waLink(buildMessage(ref));
    sending = false; render();
    toast(ref ? 'Booking ' + ref + ' saved. Opening WhatsApp…' : 'Opening WhatsApp…');
    setTimeout(function () { location.href = url; }, 400);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b && b.closest('#builder')) {
      var a = b.getAttribute('data-act'), v = b.getAttribute('data-v');
      if (a === 'brand') { if (st.brand !== v) { st.brand = v; st.model = ''; st.type = ''; } }
      else if (a === 'cc') st.cc = v;
      else if (a === 'service') { st.service = v; st.picked = true; }
      else if (a === 'km') { st.km = v; }
      else if (a === 'model') { st.model = v; applyModel(); }
      else if (a === 'contact') { st.contact = v; }
      else if (a === 'locate') { locate(); return; }
      else if (a === 'clearloc') { st.lat = null; st.lng = null; locMsg = ''; }
      else if (a === 'place') { st.place = v; }
      else if (a === 'issue') { var ix = st.issues.indexOf(v); if (ix > -1) st.issues.splice(ix, 1); else st.issues.push(v); }
      else if (a === 'date') st.date = +v;
      else if (a === 'slot') st.slot = v;
      else if (a === 'next') { if (validate()) { st.step++; errMsg = ''; if (st.step === 2 && !st.picked) st.service = recommend(); scrollToBuilder(); } }
      else if (a === 'back') { st.step = Math.max(0, st.step - 1); errMsg = ''; }
      else if (a === 'send') { save(); return send(); }
      else return;
      save(); render(); return;
    }
    var cl = e.target.closest('[data-call]');
    if (cl) { var tel = L.callLink(C.callNumber) || L.callLink(C.whatsapp); if (!tel) { e.preventDefault(); return toast('Phone number not set yet.'); } cl.setAttribute('href', tel); return; }
    var pk = e.target.closest('[data-pick]');
    if (pk && svc(pk.getAttribute('data-pick'))) { st.service = pk.getAttribute('data-pick'); st.picked = true; save(); if (!$('#builder')) { e.preventDefault(); location.href = '/book/'; return; } render(); }
    var w = e.target.closest('[data-wa]');
    if (w) { e.preventDefault(); if (!/^\d{12}$/.test(waNumber())) return toast('WhatsApp number not set yet.'); location.href = waLink('Hi Mechanix Pro, I need help with my bike.'); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest('#builder')) return;
    var a = t.getAttribute('data-act');
    if (a === 'addon') { var v = t.getAttribute('data-v'), i = st.addons.indexOf(v); if (t.checked && i < 0) st.addons.push(v); if (!t.checked && i > -1) st.addons.splice(i, 1); save(); render(); }
    if (a === 'consent') { st.consent = t.checked; save(); }
    if (a === 'emailOffers') { st.emailOffers = t.checked; save(); }
    if (t.getAttribute('data-f') === 'area') { st.area = t.value; save(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'mfilter') { var q = t.value.trim().toLowerCase(); document.querySelectorAll('.model-tile').forEach(function (b) { b.hidden = q !== '' && b.getAttribute('data-name').indexOf(q) === -1; }); return; }
    var f = t.getAttribute && t.getAttribute('data-f');
    if (!f || !t.closest('#builder')) return;
    st[f] = f === 'phone' ? t.value.replace(/\D/g, '').slice(0, 10) : f === 'coupon' ? L.cleanCoupon(t.value) : t.value;
    if (f === 'phone' && t.value !== st.phone) t.value = st.phone;
    if (f === 'coupon' && t.value !== st.coupon) t.value = st.coupon;
    if (f === 'model') { applyModel(); var mi = $('#modelInfo'), cs = $('#ccSeg'); if (mi) mi.textContent = modelNote(); if (cs) cs.innerHTML = ccSeg(); }
    save();
  });
  function scrollToBuilder() { var b = $('#build'); if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: 'smooth' }); }

  /* Use the phone's location: pick the nearest service area and attach a map pin. No third-party lookup, so nothing leaves the site. */
  function locate() {
    if (!navigator.geolocation) { locMsg = 'Your browser cannot share location. Type your address below.'; return render(); }
    locating = true; locMsg = ''; render();
    navigator.geolocation.getCurrentPosition(function (p) {
      locating = false;
      st.lat = Math.round(p.coords.latitude * 1e5) / 1e5; st.lng = Math.round(p.coords.longitude * 1e5) / 1e5;
      var area = L.nearestArea(st.lat, st.lng);
      if (!area) { st.lat = null; st.lng = null; locMsg = 'That location looks wrong. Choose your area below.'; }
      else { st.area = area; locMsg = area === 'Other area' ? 'You are outside our current areas. Send it anyway and we will tell you when we reach you.' : 'Location saved. Nearest area: ' + area + '.'; }
      save(); render();
    }, function (err) {
      locating = false;
      locMsg = err && err.code === 1 ? 'Location is blocked. Allow it in your browser settings, or type your address below.' : 'Could not get your location. Choose your area and type your address below.';
      render();
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* SOS: share location on WhatsApp */
  function sos() {
    if (!/^\d{12}$/.test(waNumber())) return toast('WhatsApp number not set yet.');
    var base = 'SOS: my bike needs help right now.';
    function go(extra) { track('generate_lead', { service: 'sos' }); location.href = waLink(base + (extra ? '\nMy location: ' + extra : '\nMy area: ')); }
    if (!navigator.geolocation) return go('');
    toast('Getting your location…');
    navigator.geolocation.getCurrentPosition(function (p) { go('https://maps.google.com/?q=' + p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5)); }, function () { go(''); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  function toast(m) { var t = document.createElement('div'); t.className = 'toast fade'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }

  function renderPrices() {
    var el = $('#priceList'); if (!el) return;
    el.innerHTML = services().map(function (x) { return '<li' + (x.id === 'sos' ? ' class="sos-row"' : '') + '>' + icon(x.id) + '<h3>' + esc(x.name) + '</h3><span class="pr">' + rupee(x.price) + '</span><p>' + esc(x.description || '') + '</p><a class="go" href="/book/" data-pick="' + esc(x.id) + '">Build with this</a></li>'; }).join('');
  }
  function renderSummary() {
    var el = $('#summary'); if (!el) return;
    var sv = svc(st.service), extra = (st.cc === 'big' && sv && ['basic', 'general', 'full'].indexOf(sv.id) > -1) ? fee('bigbike', 300) : 0;
    var rows = sv ? '<div><dt>' + esc(sv.name) + '</dt><dd>' + rupee(sv.price) + '</dd></div>' : '';
    if (extra) rows += '<div><dt>Above 180cc</dt><dd>+' + rupee(extra) + '</dd></div>';
    st.addons.forEach(function (a) { var x = svc(a); if (x) rows += '<div><dt>' + esc(x.name) + '</dt><dd>' + (x.price ? '+' + rupee(x.price) : 'Free') + '</dd></div>'; });
    el.innerHTML = '<div class="card"><small>Your package for</small><h3>' + esc(bikeTitle().replace(/^./, function (c) { return c.toUpperCase(); })) + '</h3><dl>' + rows + '</dl>' + includedBox(sv, 'Included') + '<div class="tot tear"><span>Starting estimate, GST included</span><b>' + rupee(total()) + '</b></div><p>' + '₹' + fee('advance', 199) + ' booking advance locks your slot after you approve the quote, and is adjusted in your final bill. Final quote comes on WhatsApp.</p></div>';
  }
  function loadPrices() {
    if (!C.supabaseUrl || !C.supabaseAnonKey) return;
    fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/services?select=id,kind,name,price,description,includes&active=eq.true&order=sort.asc', { headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { if (Array.isArray(rows) && rows.length) { items = rows; if (!svc(st.service)) st.service = services()[0].id; st.addons = st.addons.filter(svc); render(); renderPrices(); applyLivePrices(); } })
      .catch(function () {});
  }
  function analytics() {
    if (!C.gaId) return;
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(C.gaId); document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', C.gaId); if (C.googleAdsSendTo) window.gtag('config', C.googleAdsSendTo.split('/')[0]);
  }

  function init() {
    utm(); analytics();
    var attr = L.captureAttribution(location.search, (function () { try { return sessionStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })());
    st.ref_code = attr.ref_code; st.campaign = attr.campaign;
    var p = new URLSearchParams(location.search), area = p.get('area'), service = p.get('service');
    if (area && AREAS.indexOf(area) > -1) st.area = area;
    var pre = L.prefillFromQuery(location.search, BIKES);
    if (pre.brand) { if (st.brand !== pre.brand) { st.brand = pre.brand; st.model = ''; } if (pre.model) st.model = pre.model; st.step = 0; }
    if (service && svc(service)) st.service = service;
    if (st.step > 3) st.step = 0;
    applyModel();
    render(); renderPrices(); loadPrices();
    var phoneEls = document.querySelectorAll('[data-phone]'); for (var i = 0; i < phoneEls.length; i++) if (C.phoneDisplay) phoneEls[i].textContent = C.phoneDisplay;
    var tel0 = L.callLink(C.callNumber) || L.callLink(C.whatsapp); if (tel0) document.querySelectorAll('[data-call]').forEach(function (a) { a.setAttribute('href', tel0); });
    var sb = $('#sosBtn'); if (sb) sb.addEventListener('click', sos);
    var mb = $('#mbar'); if (mb) { var onS = function () { mb.classList.toggle('show', window.scrollY > 480); }; window.addEventListener('scroll', onS, { passive: true }); onS(); }
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
