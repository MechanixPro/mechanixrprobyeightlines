/* Mechanix Pro — booking builder, WhatsApp hand-off, lead capture. No framework, no build step. */
(function () {
  'use strict';
  var C = window.MXP || {};
  var L = window.MXP_LOGIC;
  var KEY = 'mxp_build_v1';
  var DEFAULT_ITEMS = [
    { id: 'basic', kind: 'service', name: 'Basic service', price: 599, description: 'Oil level check, chain lube, brake adjust, wash', includes: ['• 20+ Point Bike Checkup', '• Engine Check', '• Brake Check', '• Tyre Check', '• Battery Check', '• Lights & Indicators Check', '• Horn Check', '• Chain Cleaning & Lubrication', '• Air Filter Check', '• Clutch Check', '• Throttle Check'] },
    { id: 'general', kind: 'service', name: 'General service', price: 1299, description: 'Engine oil change, filter clean, 20-point check', includes: ['• 30+ Point Bike Checkup', '• Engine Oil Replacement (As per your choice)', '• Brake Check & Adjustment', '• Tyre Check', '• Battery Check', '• Chain Cleaning & Lubrication', '• Air Filter Cleaning', '• Spark Plug Check', '• Clutch & Throttle Adjustment', '• Lights & Electrical Check', '• Suspension Check', '• Extra parts (Chargeble)', '• Washing & Cleaning (EXTRA)'] },
    { id: 'full', kind: 'service', name: 'Full service', price: 1999, description: 'General service plus throttle body clean, brake pads check, polish', includes: ['• 40+ Point Complete Bike Checkup', '• Engine Oil Replacement', '• Engine Performance Check', '• Brake Servicing', '• Tyre & Wheel Check', '• Battery & Electrical Check', '• Air Filter Cleaning / Replacement', '• Spark Plug Check / Replacement', '• Chain Servicing', '• Clutch Servicing', '• Suspension Check', '• Complete Bike Cleaning', '• Required Minor Parts Replacement', '• Extra Parts (Chargeble)', '• Final Quality Inspection'] },
    { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 349, description: 'Checkup and quote visit; repair quoted before work starts', includes: ['AT YOUR DOOR STEP', '• Diagnose the bike problem', '• Identify the cause of the issue', '• Complete vehicle inspection', '• Check engine, brakes, battery & electricals', '• Check unusual noise, vibration or starting issues', '• Get a clear repair estimate before work', '• Customer approval required before any repair', '• Genuine parts replacement, if required'] },
    { id: 'sos', kind: 'service', name: 'Roadside emergency', price: 699, description: 'Puncture, battery or breakdown; mechanic dispatched now', includes: ['Mechanic dispatched to your location now', '• Quick roadside assistance', '• Bike breakdown diagnosis', '• Puncture assistance', '• Battery jump-start assistance', '• Starting problem assistance', '• Minor on-the-spot repairs', '• Fuel-related assistance', '• Emergency towing support, if required', '• Repair estimate before major work', '• No major repair without customer approval'] },
    { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 },
    { id: 'chain', kind: 'addon', name: 'Chain clean and lube', price: 149 },
    { id: 'brake', kind: 'addon', name: 'Brake tuning', price: 99 },
    { id: 'tyre', kind: 'addon', name: 'Tyre and puncture check', price: 49 },
    { id: 'battery', kind: 'addon', name: 'Battery health test', price: 0 },
    { id: 'advance', kind: 'fee', name: 'Checkup and quote fee', price: 349 },
    { id: 'newfee', kind: 'fee', name: 'New customer slot fee', price: 99 },
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
  var STEPS = ['Your bike', 'What it needs', 'Your package', 'When & where'];
  var KM = [['new', 'New bike, first service'], ['lt3', 'Under 3,000 km'], ['mid', '3,000 – 6,000 km'], ['gt6', 'Over 6,000 km'], ['unsure', 'Not sure']];
  var ISSUES = [['start', 'Hard to start'], ['pickup', 'Low pickup or mileage'], ['brake', 'Brakes weak or noisy'], ['chain', 'Chain noise or loose chain'], ['clutch', 'Clutch hard or slipping'], ['gear', 'Gear shifting problem'], ['battery', 'Battery or self-start'], ['tyre', 'Puncture or worn tyre'], ['leak', 'Oil leak'], ['heat', 'Engine heating'], ['elec', 'Lights, horn or wiring'], ['susp', 'Suspension noise'], ['rain', 'Pre-monsoon check']];
  var ISSUES_EV = [['range', 'Range dropped or charging problem'], ['brake', 'Brakes weak or noisy'], ['tyre', 'Puncture or worn tyre'], ['elec', 'Lights, horn or wiring'], ['susp', 'Suspension noise'], ['sw', 'Display or app problem'], ['rain', 'Pre-monsoon check']];
  var PLACES = [['home', 'At my home or office'], ['pickup', 'Pick up and drop (our mechanic collects it)'], ['road', 'I am stuck on the road'], ['unsure', 'Not sure, expert will advise']];
  var items = DEFAULT_ITEMS.slice();
  var st = load();
  var errMsg = '';
  var sending = false;
  var cbDone = null;       // set after a call-back request is saved
  var sentFlag = false;    // true once the visitor has sent their request, so we never nag them after that
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
    var d = { reg: '', reminder: false, requestType: 'quote', email: '', emailOffers: false, coupon: '', address: '', lat: null, lng: null, contact: 'whatsapp', step: 0, brand: '', model: '', type: '', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', picked: false, addons: [], place: 'home', area: '', pin: '', areaAuto: false, dateIso: '', hour: null, slot: '', name: '', phone: '', consent: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') for (var k in d) if (k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function todayIso() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  var calY = 0, calM = 0, clockMode = 'am';
  /* Calendar and clock: the visitor picks a real day and a one-hour arrival window. */
  function schedulePicker() {
    var g = L.calendarGrid(calY, calM, todayIso(), 30), h = '';
    h += '<span class="label">Preferred day</span><div class="cal" role="group" aria-label="Choose a day"><div class="cal-head"><button type="button" class="cal-nav" data-act="calPrev" aria-label="Previous month"' + (g.canPrev ? '' : ' disabled') + '>‹</button><b>' + esc(g.title) + '</b><button type="button" class="cal-nav" data-act="calNext" aria-label="Next month"' + (g.canNext ? '' : ' disabled') + '>›</button></div>';
    h += '<div class="cal-dow">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="cal-grid">';
    g.weeks.forEach(function (w) { w.forEach(function (c) {
      if (!c) { h += '<span></span>'; return; }
      h += '<button type="button" class="cal-day' + (c.today ? ' today' : '') + '" data-act="pickDay" data-v="' + c.iso + '" aria-pressed="' + (st.dateIso === c.iso) + '" aria-label="' + esc(L.dayLabelFor(c.iso) + ' ' + g.year) + (c.today ? ', today' : '') + '"' + (c.disabled ? ' disabled' : '') + '>' + c.d + '</button>';
    }); });
    h += '</div></div>';
    var win = st.dateIso ? L.timeWindows(st.dateIso, new Date()) : [], byHour = {}; win.forEach(function (x) { byHour[x.hour] = x; });
    var sel = st.hour != null && byHour[st.hour] ? byHour[st.hour] : null;
    h += '<span class="label">Preferred time</span><div class="clock" role="group" aria-label="Choose an arrival time"><div class="clock-face">';
    if (sel && ((clockMode === 'am') === (st.hour < 12))) h += '<i class="clock-hand" style="--a:' + ((st.hour % 12) * 30) + 'deg"></i>';
    for (var n = 1; n <= 12; n++) {
      var hr = clockMode === 'am' ? n : (n === 12 ? 12 : n + 12), w2 = byHour[hr], off = !w2 || w2.disabled || (clockMode === 'am' && n === 12);
      h += '<button type="button" class="clock-num" data-act="pickHour" data-v="' + hr + '" style="--a:' + ((n % 12) * 30) + 'deg" aria-pressed="' + (st.hour === hr) + '" aria-label="' + (w2 ? esc(w2.label) : n + (clockMode === 'am' ? ' AM' : ' PM')) + '"' + (off ? ' disabled' : '') + '>' + n + '</button>';
    }
    h += '<div class="clock-center"><b>' + (sel ? esc(sel.label) : (st.dateIso ? 'Pick an hour' : 'Pick a day first')) + '</b><small>1-hour arrival window</small></div></div>';
    h += '<div class="seg" role="group" aria-label="AM or PM"><button type="button" data-act="ampm" data-v="am" aria-pressed="' + (clockMode === 'am') + '">AM</button><button type="button" data-act="ampm" data-v="pm" aria-pressed="' + (clockMode === 'pm') + '">PM</button></div>';
    h += '<p class="tiny muted" style="margin:8px 0 0">Our mechanic arrives within your chosen hour. For today, only times at least 2 hours away are shown.</p></div>';
    return h;
  }

  function fee(id, d) { var x = svc(id); return x ? x.price : d; }
  function cfg() { return { bigBikeSurcharge: fee('bigbike', 300), bookingAdvance: fee('advance', 349) }; }
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
  /* The PIN code the visitor typed: say whether we serve it, and which area it is. We serve all of Bengaluru (560001 to 560110). */
  function pinNote() {
    var i = L.pinInfo(st.pin, window.MXP_PINS || {}, window.MXP_PINS_OFF || {});
    if (!i) return st.pin ? 'Type all 6 digits of your PIN code.' : 'We serve all of Bengaluru. Your PIN code fills in your area.';
    if (i.known) return 'Yes, we serve ' + i.name + ' (' + i.pin + ').';
    return i.served ? 'Yes, ' + i.pin + ' is in Bengaluru and we serve it.' : i.pin + ' is outside Bengaluru. Send it anyway and we will tell you when we reach you.';
  }
  /* The visitor's own PIN (or exact spot) drops onto a small map of Bengaluru. Redraws only when it changes, so typing elsewhere does not replay it. */
  var lastPinKey = null;
  function drawPinMap() {
    var el = $('#pinMap'); if (!el || !window.MXP_PINMAP) return;
    var i = L.pinInfo(st.pin, window.MXP_PINS || {}, window.MXP_PINS_OFF || {}), ok = !!(i && i.served && (window.MXP_PIN_GEO || {})[i.pin]);
    var key = (ok ? i.pin : '') + '|' + (st.lat || '') + '|' + (st.lng || '');
    window.MXP_PINMAP.draw(el, { pin: ok ? i.pin : '', lat: st.lat, lng: st.lng, again: key === lastPinKey });
    el.classList.add('pm-still'); if (key === lastPinKey) el.classList.add('pm-again'); lastPinKey = key;
  }
  var lastStep = -1, lastTotal = null;
  var calmMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* The estimate counts to its new value when a choice changes it, so the visitor sees the effect of what they picked. */
  function tickTotal(from, to) {
    var b = document.querySelector('.b-foot .sum b'); if (!b || from === null || from === to || calmMotion) return;
    var small = '<small>from</small> ', t0 = null;
    b.classList.add('tick');
    function step(t) { if (t0 === null) t0 = t; var k = Math.min(1, (t - t0) / 380); b.innerHTML = small + rupee(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); else b.classList.remove('tick'); }
    requestAnimationFrame(step);
  }
  /* Tell Pro (the helper character) what the visitor has built so far. It only reads this and never sends it anywhere. */
  function announce() {
    try {
      var sv = svc(st.service), pi = L.pinInfo(st.pin, window.MXP_PINS || {}, window.MXP_PINS_OFF || {});
      document.dispatchEvent(new CustomEvent('mxp:state', { detail: { step: st.step, nick: String(st.nick || '').trim(), model: st.model, service: st.service, picked: !!st.picked, serviceName: sv ? sv.name : '', price: total(), pin: st.pin, pinServed: !!(pi && pi.served), pinName: pi && pi.name || '' } }));
    } catch (e) {}
  }
  function render() {
    var el = $('#builder'); if (!el) return;
    var s = st.step, h = '';
    h += '<div class="b-top"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b>Step ' + (s + 1) + ' of 4: ' + STEPS[s] + '</b><span class="saved">Saved on this phone</span></div>';
    h += '<div class="progress" aria-hidden="true">' + STEPS.map(function (_, i) { return '<i class="' + (i <= s ? 'on' : '') + '"></i>'; }).join('') + '</div></div><div class="b-body' + (s !== lastStep ? ' fade' : '') + '">';
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
      h += takeawayBox(false);
    }
    if (s === 3) {
      if (st.service === 'sos') st.place = 'road';
      if (cbDone) h += callbackDone();
      h += includedBox(svc(st.service), 'Your package: ' + (svc(st.service) ? svc(st.service).name : ''));
      h += takeawayBox(true);
      h += '<span class="label" id="lb-place">Where will the work happen?</span><div class="chips" role="group" aria-labelledby="lb-place">' + PLACES.map(function (k) { return '<button type="button" class="chip" data-act="place" data-v="' + k[0] + '" aria-pressed="' + (st.place === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>';
      h += '<p class="tiny muted" style="margin:8px 0 0">Most routine services are done at your doorstep. If a job needs workshop tools, we pick up the bike only after you share a one-time code.</p>';
      var hasPin = L.validGeo(st.lat, st.lng);
      h += '<div class="locate"><button type="button" class="btn btn-ghost btn-sm" data-act="locate"' + (locating ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>' + (locating ? 'Finding you…' : hasPin ? 'Update my location' : 'Use my current location') + '</button>' + (hasPin ? '<button type="button" class="btn btn-ghost btn-sm" data-act="clearloc">Remove</button>' : '') + '</div>';
      if (locMsg || hasPin) h += '<p class="small locmsg" role="status">' + esc(locMsg || ('Location saved. Nearest area: ' + (st.area || 'Other area') + '.')) + '</p>';
      if (C.googleMapsKey && C.googleAddressSearch === true && window.MXP_GMAPS) h += '<label class="label" for="f-gsearch">Search your address <span class="muted" style="font-weight:400">(fills your area and PIN)</span></label><div class="gsearch"><input id="f-gsearch" type="search" role="combobox" aria-expanded="false" aria-controls="gs-list" aria-autocomplete="list" autocomplete="off" maxlength="120" placeholder="Society, street or landmark"><ul id="gs-list" class="gs-list" role="listbox" aria-label="Address suggestions" hidden></ul></div><p class="small gsmsg" id="gsMsg" role="status" aria-live="polite"></p>';
      h += '<label class="label" for="f-pin">PIN code</label><input id="f-pin" data-f="pin" inputmode="numeric" maxlength="6" autocomplete="postal-code" placeholder="e.g. 560102" value="' + esc(st.pin) + '"><p class="small pininfo" id="pinInfo" role="status" aria-live="polite" style="margin:6px 0 0">' + esc(pinNote()) + '</p><div class="pm pm-mini" id="pinMap"></div>';
      h += '<label class="label" for="f-area">Area</label><select id="f-area" data-f="area"><option value="">Choose your area</option>' + (st.area && AREAS.indexOf(st.area) < 0 ? '<option selected>' + esc(st.area) + '</option>' : '') + AREAS.map(function (a) { return '<option' + (st.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select>';
      h += '<label class="label" for="f-address">Flat, street or landmark <span class="muted" style="font-weight:400">(helps the mechanic find you)</span></label><input id="f-address" data-f="address" maxlength="200" autocomplete="street-address" placeholder="e.g. Flat 4B, Green Apartments, 27th Main" value="' + esc(st.address) + '">';
      if (st.place !== 'road') h += schedulePicker();
      else h += '<p class="small" style="margin:14px 0 0"><b>Stuck on the road?</b> Send this and share your live location on WhatsApp. We send the nearest mechanic.</p>';
      h += '<label class="label" for="f-name">Your name</label><input id="f-name" data-f="name" autocomplete="name" maxlength="60" value="' + esc(st.name) + '">';
      h += '<label class="label" for="f-phone">Mobile number</label><input id="f-phone" data-f="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="10-digit number" value="' + esc(st.phone) + '">';
      h += '<span class="label" id="lb-contact">How should our expert reach you?</span><div class="chips" role="group" aria-labelledby="lb-contact"><button type="button" class="chip" data-act="contact" data-v="whatsapp" aria-pressed="' + (st.contact !== 'call') + '">WhatsApp chat</button><button type="button" class="chip" data-act="contact" data-v="call" aria-pressed="' + (st.contact === 'call') + '">Phone call</button></div>';
      h += '<label class="label" for="f-email">Email <span class="muted" style="font-weight:400">(optional, for your booking confirmation)</span></label><input id="f-email" data-f="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="you@example.com" value="' + esc(st.email) + '">';
      h += '<label class="check"><input type="checkbox" data-act="emailOffers"' + (st.emailOffers ? ' checked' : '') + '><span>Also email me offers and service reminders. You can unsubscribe any time.</span></label>';
      h += '<label class="label" for="f-reg">Registration number <span class="muted" style="font-weight:400">(optional, helps the mechanic)</span></label><input id="f-reg" data-f="reg" maxlength="14" autocapitalize="characters" autocomplete="off" placeholder="e.g. KA01AB1234" value="' + esc(st.reg) + '">';
      h += '<label class="check"><input type="checkbox" data-act="reminder"' + (st.reminder ? ' checked' : '') + '><span>Remind me when my next service is due.</span></label>';
      h += '<label class="label" for="f-coupon">Coupon code <span class="muted" style="font-weight:400">(optional)</span></label><input id="f-coupon" data-f="coupon" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="e.g. MONSOON10" value="' + esc(st.coupon) + '"><p class="tiny muted" style="margin:6px 0 0">Your expert applies it to your quote on WhatsApp.</p>';
      h += '<label class="check"><input type="checkbox" data-act="consent"' + (st.consent ? ' checked' : '') + '><span>Send me my quote, booking updates and reminders on WhatsApp. Reply STOP anytime. See our <a href="/privacy/">Privacy Policy</a>.</span></label>';
      h += '<p class="note pay-note" style="margin-top:14px"><b>Payment and cancellation:</b> nothing is charged now. After you approve the quote, a slot fee locks your visit: ₹' + fee('newfee', 99) + ' for new customers, ₹' + fee('advance', 349) + ' for returning customers. It is adjusted in your final bill. Cancel more than 2 hours before your slot for a full refund. <a href="/refund-policy/">Read the refund policy</a>.</p>';
      h += '<p class="note" style="margin-top:14px"><b>What happens next:</b> you send this on WhatsApp. Our expert calls or messages you, checks what is needed, and sends your quote. Work starts only after you approve it.</p>';
      if (C.turnstileSiteKey) h += '<div id="ts" style="margin-top:12px"></div>';
    }
    if (errMsg) h += '<p class="err" role="alert">' + esc(errMsg) + '</p>';
    h += '</div><div class="b-foot"><div class="sum"><b><small>from</small> ' + rupee(total()) + '</b><span>Starting estimate, GST included. Final quote on WhatsApp.</span></div>';
    if (s > 0) h += '<button class="btn btn-ghost btn-sm" type="button" data-act="back">Back</button>';
    h += s < 3 ? '<button class="btn btn-primary" type="button" data-act="next">Continue</button>' : '<button class="btn btn-wa" type="button" data-act="send"' + (sending ? ' disabled' : '') + '>' + (sending ? 'Opening…' : 'Send on WhatsApp') + '</button>';
    h += '</div>';
    el.innerHTML = h;
    var nowTotal = total(); tickTotal(lastTotal, nowTotal); lastTotal = nowTotal; lastStep = s; announce();
    if (s === 3) drawPinMap();
    if (s === 3 && C.turnstileSiteKey) mountTurnstile();
    renderSummary();
  }
  /* The IKEA effect: the visitor built something, so they never leave with nothing. */
  function takeawayBox(withCallback) {
    var canCall = withCallback && C.supabaseUrl && C.supabaseAnonKey;
    return '<div class="takeaway"><b>Not ready to send? Take your build with you.</b><div class="chips"><button type="button" class="btn btn-ghost btn-sm" data-act="sendDraft">Send to WhatsApp now</button><button type="button" class="btn btn-ghost btn-sm" data-act="copyBuild">Copy link to my build</button><button type="button" class="btn btn-ghost btn-sm" data-act="shareBuild">Share</button>' + (canCall ? '<button type="button" class="btn btn-ghost btn-sm" data-act="callback"' + (sending ? ' disabled' : '') + '>Save my build and call me back</button>' : '') + '</div>' + (canCall ? '<p class="tiny muted" style="margin:8px 0 0">Call-back needs only your name and number below. No day or time.</p>' : '') + '</div>';
  }
  function callbackDone() {
    return '<div class="confirm-panel" role="status"><b>Saved. We will call you soon.</b><p>' + (cbDone.ref ? 'Your reference is <b>' + esc(cbDone.ref) + '</b>. ' : '') + 'Our expert will call you from ' + esc(C.phoneDisplay || 'our number') + '. You can also chat with us now.</p><div class="chips"><button type="button" class="btn btn-wa btn-sm" data-act="sendDraft">Chat on WhatsApp</button><button type="button" class="btn btn-ghost btn-sm" data-act="copyBuild">Copy link to my build</button></div></div>';
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
      else if (st.place !== 'road' && !st.dateIso) errMsg = 'Pick a day on the calendar.';
      else if (st.place !== 'road' && st.hour == null) errMsg = 'Pick an arrival time on the clock.';
      else if (st.name.trim().length < 2) errMsg = 'Enter your name.';
      else if (!/^[6-9]\d{9}$/.test(st.phone)) errMsg = 'Enter a valid 10-digit mobile number.';
      else if (st.email.trim() && !L.validEmail(st.email)) errMsg = 'That email address does not look right. Fix it or leave it empty.';
      else if (st.reg.trim() && !L.cleanReg(st.reg)) errMsg = 'That registration number does not look right. Fix it or leave it empty.';
    }
    return !errMsg;
  }

  /* ---------- WhatsApp hand-off ---------- */
  function waNumber() { return String(C.whatsapp || '').replace(/\D/g, ''); }
  function waLink(text) { return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(text); }
  function buildMessage(ref) {
    var when = st.dateIso && st.hour != null ? L.whenLabel(st.dateIso, st.hour) : '';
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
    var body = Object.assign(L.leadPayload(st, st.dateIso || todayIso(), todayIso()), { utm: utm(), turnstile_token: tsToken, page: location.pathname });
    var ctrl = 'AbortController' in window ? new AbortController() : null, t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    return fetch(C.supabaseUrl.replace(/\/$/, '') + '/functions/v1/submit-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
      body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { clearTimeout(t); return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || 'Failed'), { status: r.status }); return j; }); });
  }
  function track(name, params) {
    try { if (window.mxpTrack) window.mxpTrack(name, Object.assign({ value: name === 'generate_lead' ? total() : undefined }, params || {})); } catch (e) {}
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
  function buildLink() { return location.origin + '/book/?b=' + L.encodeBuild(st); }
  function sendDraft() {
    if (!/^\d{12}$/.test(waNumber())) return toast('WhatsApp number not set yet.');
    sentFlag = true; track('lead_draft', { service: st.service });
    location.href = waLink(L.buildDraftMessage(st, items, cfg(), buildLink()));
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-999px'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Link copied. Open it any time to continue your build.'); } catch (e) { toast('Could not copy. Long-press the address bar to copy the link.'); }
    ta.remove();
  }
  function copyBuild() {
    var link = buildLink();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { toast('Link copied. Open it any time to continue your build.'); }, function () { fallbackCopy(link); });
    else fallbackCopy(link);
  }
  function shareBuild() {
    var link = buildLink(), text = 'My bike service build for ' + bikeTitle() + ' on Mechanix Pro: ' + link;
    if (navigator.share) navigator.share({ title: 'My bike service build', text: text, url: link }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  /* Referral: the booking reference travels as ?ref=, which the site already saves with the next booking. */
  function shareRef(ref) {
    var link = location.origin + '/' + (ref ? '?ref=' + encodeURIComponent(ref) : ''), text = 'I booked a doorstep bike service with Mechanix Pro in Bengaluru. Quote first, work after your OK: ' + link;
    if (navigator.share) navigator.share({ title: 'Mechanix Pro', text: text, url: link }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; });
  function standalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); }
  function installBox() {
    if (standalone()) return '';
    if (installEvt) return '<button type="button" class="btn btn-ghost btn-sm" data-act="installApp">Add Mechanix Pro to my phone</button>';
    if (isIos()) return '<p class="tiny muted" style="margin:6px 0 0">Keep us one tap away: in Safari tap Share, then Add to Home Screen.</p>';
    return '';
  }
  function installApp(btn) {
    if (!installEvt) return;
    installEvt.prompt(); installEvt.userChoice.then(function () { installEvt = null; if (btn && btn.parentNode) btn.remove(); }, function () {});
  }
  /* "Save my build and call me back": an explicit request, so we only save what the visitor chose to send. */
  function callback() {
    errMsg = '';
    if (st.name.trim().length < 2) errMsg = 'Enter your name so we know who to call.';
    else if (!/^[6-9]\d{9}$/.test(st.phone)) errMsg = 'Enter a valid 10-digit mobile number so we can call you.';
    else if (st.email.trim() && !L.validEmail(st.email)) errMsg = 'That email address does not look right. Fix it or leave it empty.';
    if (errMsg) return render();
    st.requestType = 'callback'; sending = true; render();
    submitLead().then(function (r) {
      st.requestType = 'quote'; sending = false;
      if (!r) { errMsg = 'Call-back is not available right now. Please use Send to WhatsApp now.'; return render(); }
      cbDone = { ref: r.ref || '' }; sentFlag = true; track('lead_callback', { service: st.service }); render();
    }).catch(function () { st.requestType = 'quote'; sending = false; errMsg = 'Could not save right now. Please use Send to WhatsApp now instead.'; render(); });
  }
  /* Leave prompt: shown once per visit, only when the visitor has built something and not sent it. Desktop: pointer leaves through the top. Phone: idle for a while. */
  var EXIT_KEY = 'mxp_exit_prompted', idleTimer = null;
  function hasBuild() { return !!(st.brand && st.model.trim().length > 1); }
  function promptedBefore() { try { return sessionStorage.getItem(EXIT_KEY) === '1'; } catch (e) { return false; } }
  function maybePrompt(trigger) {
    if (!$('#builder') || $('#exitSheet')) return;
    if (!L.shouldPromptExit({ hasBuild: hasBuild(), sent: sentFlag, promptedBefore: promptedBefore(), step: st.step, trigger: trigger })) return;
    try { sessionStorage.setItem(EXIT_KEY, '1'); } catch (e) {}
    showExit();
  }
  function showExit() {
    var d = document.createElement('div'); d.className = 'sheetx'; d.id = 'exitSheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'exitT');
    d.innerHTML = '<div class="sheetx-panel fade"><h3 id="exitT">Keep your build?</h3><p>You have already built a package for ' + esc(bikeTitle()) + '. Take it with you so you do not have to start again.</p><div class="chips"><button type="button" class="btn btn-wa btn-sm" data-act="sendDraft">Send to WhatsApp now</button><button type="button" class="btn btn-ghost btn-sm" data-act="copyBuild">Copy link</button><button type="button" class="btn btn-ghost btn-sm" data-act="closeExit">Keep browsing</button></div></div>';
    document.body.appendChild(d); var first = d.querySelector('button'); if (first) first.focus();
  }
  function closeExit() { var d = $('#exitSheet'); if (d) d.remove(); }
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 0) maybePrompt('exit'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeExit(); });
  document.addEventListener('click', function (e) { if (e.target && e.target.id === 'exitSheet') closeExit(); });
  /* Returning visitors who left a build behind get it handed back, so they can pick up where they stopped. */
  function welcomeBack() {
    if ($('#builder') || !hasBuild()) return;
    try { if (sessionStorage.getItem('mxp_welcome') === '1') return; } catch (e) {}
    var d = document.createElement('aside'); d.className = 'welcome'; d.setAttribute('aria-label', 'Your saved build');
    d.innerHTML = '<button type="button" class="welcome-x" aria-label="Close">&times;</button><b>Welcome back!</b><p>' + esc(bikeTitle()) + ' is waiting. ' + (svc(st.service) ? esc(svc(st.service).name) + ' from ' + rupee(total()) + '.' : '') + '</p><a class="btn btn-primary btn-sm" href="/book/">Continue your build</a>';
    function close() { d.classList.remove('in'); setTimeout(function () { d.remove(); }, 300); try { sessionStorage.setItem('mxp_welcome', '1'); } catch (e) {} }
    d.querySelector('.welcome-x').addEventListener('click', close);
    setTimeout(function () { document.body.appendChild(d); requestAnimationFrame(function () { d.classList.add('in'); }); }, 4200);
  }
  /* The company changed the PIN code list in the admin: refresh the note under the PIN field. */
  document.addEventListener('mxp:pins', function () { var n = $('#pinInfo'); if (n) n.textContent = pinNote(); });
  function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(function () { maybePrompt('idle'); }, 45000); }
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, armIdle, { passive: true }); });
  function finish(ref) {
    sentFlag = true;
    var q = L.leadQuality(st, window.MXP_PINS || {}, window.MXP_PINS_OFF || {});
    track(q.qualified ? 'generate_lead' : 'lead_unqualified', { service: st.service, area: st.area, reason: q.reason, value: total() });
    var url = waLink(buildMessage(ref));
    sending = false; render();
    showDone(ref, url);
  }
  /* After sending: a thank-you popup that names the visitor's own bike, shows what happens next, and offers a calendar entry. WhatsApp opens by itself after a few seconds. */
  function showDone(ref, url) {
    closeExit();
    var old = $('#doneSheet'); if (old) old.remove();
    var name = st.nick ? esc(st.nick) : esc(bikeTitle()), sv = svc(st.service), ics = L.icsFor(st, ref, sv ? sv.name : ''), secs = 9;
    var when = st.place !== 'road' && st.dateIso && st.hour != null ? L.whenLabel(st.dateIso, st.hour) : 'We will contact you soon';
    var bars = L.receiptBars(ref), x = 0, svgBars = bars.map(function (w, i) { var r = i % 2 === 0 ? '<rect x="' + x + '" y="0" width="' + w + '" height="46"/>' : ''; x += w + (i % 2 === 0 ? 0 : 0); return r; }).join('');
    var barW = bars.reduce(function (t, w) { return t + w; }, 0);
    var pieces = ''; for (var k = 0; k < 28; k++) pieces += '<i style="--x:' + (Math.round(Math.random() * 100)) + '%;--d:' + (1.3 + Math.random() * 0.9).toFixed(2) + 's;--s:' + (0.3 + Math.random() * 0.5).toFixed(2) + 's;--r:' + Math.round(Math.random() * 360) + 'deg;--c:' + ['#F2801F', '#14295A', '#34C759', '#FFC38A', '#5AC8FA'][k % 5] + '"></i>';
    var d = document.createElement('div'); d.className = 'sheetx'; d.id = 'doneSheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'doneT');
    d.innerHTML = '<div class="rcpt-wrap"><div class="confetti" aria-hidden="true">' + pieces + '</div>' +
      '<div class="rcpt-slot" aria-hidden="true"><i class="rcpt-led"></i></div>' +
      '<div class="rcpt-paper"><div class="rcpt-head"><span class="rcpt-ico" aria-hidden="true"><img src="/assets/img/logo-mark.webp" alt="" width="34" height="35"></span><h3 id="doneT">Thank you!</h3><p>' + name + ' is in the queue.</p></div>' +
      '<div class="rcpt-perf" aria-hidden="true"><i></i><i></i></div>' + (st.pin || st.lat ? '<div class="pm pm-mini rcpt-map" id="rcptMap"></div>' : '') +
      '<dl class="rcpt-rows"><div><dt>Reference</dt><dd>' + (ref ? esc(ref) : 'Pending') + '</dd></div><div><dt>Estimate</dt><dd>from ' + rupee(total()) + '</dd></div><div><dt>Bike</dt><dd>' + esc(bikeTitle()) + '</dd></div><div><dt>Service</dt><dd>' + esc(sv ? sv.name : '') + '</dd></div><div><dt>When</dt><dd>' + esc(when) + '</dd></div><div><dt>Status</dt><dd><span class="rcpt-chip">Request received</span></dd></div></dl>' +
      '<div class="rcpt-barcode" aria-hidden="true"><svg viewBox="0 0 ' + barW + ' 46" preserveAspectRatio="none">' + svgBars + '</svg><small>' + (ref ? esc(ref) : 'MECHANIX PRO') + '</small></div>' +
      '<p class="rcpt-foot">Your quote arrives on WhatsApp. Nothing starts until you approve it.</p>' +
      '<a class="btn btn-wa" id="doneWa" href="' + esc(url) + '">Open WhatsApp now</a>' +
      '<div class="done-more">' + (ics ? '<a class="btn btn-ghost btn-sm" download="mechanix-pro-service.ics" href="data:text/calendar;charset=utf-8,' + encodeURIComponent(ics) + '">Add to calendar</a>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-act="copyBuild">Copy my build link</button>' + (ref ? '<a class="btn btn-ghost btn-sm" href="/track/?ref=' + encodeURIComponent(ref) + '">Track this booking</a>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-act="shareRef" data-ref="' + (ref ? esc(ref) : '') + '">Tell a friend</button>' + installBox() + '</div>' +
      '<p class="tiny muted" id="doneCount" role="status">Opening WhatsApp in ' + secs + '…</p></div></div>';
    document.body.appendChild(d);
    var rm = d.querySelector('#rcptMap'); if (rm && window.MXP_PINMAP) { var ri = L.pinInfo(st.pin, window.MXP_PINS || {}, window.MXP_PINS_OFF || {}); window.MXP_PINMAP.draw(rm, { pin: ri && ri.served ? ri.pin : '', lat: st.lat, lng: st.lng }); }
    var go = d.querySelector('#doneWa'); if (go) go.focus({ preventScroll: true });
    var cnt = d.querySelector('#doneCount'), t = setInterval(function () { secs--; if (!document.body.contains(d)) return clearInterval(t); if (secs <= 0) { clearInterval(t); location.href = url; } else cnt.textContent = 'Opening WhatsApp in ' + secs + '…'; }, 1000);
    d.addEventListener('click', function (e) { if (e.target === d || (e.target.closest && e.target.closest('.done-more'))) { clearInterval(t); cnt.textContent = ''; } });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b && (b.closest('#builder') || b.closest('#exitSheet') || b.closest('#doneSheet'))) {
      var a = b.getAttribute('data-act'), v = b.getAttribute('data-v');
      if (a === 'brand') { if (st.brand !== v) { st.brand = v; st.model = ''; st.type = ''; } }
      else if (a === 'cc') st.cc = v;
      else if (a === 'service') { st.service = v; st.picked = true; }
      else if (a === 'km') { st.km = v; }
      else if (a === 'model') { st.model = v; applyModel(); }
      else if (a === 'contact') { st.contact = v; }
      else if (a === 'locate') { locate(); return; }
      else if (a === 'gpick') { gsPick(+b.getAttribute('data-i')); return; }
      else if (a === 'sendDraft') { sendDraft(); return; }
      else if (a === 'copyBuild') { copyBuild(); return; }
      else if (a === 'shareBuild') { shareBuild(); return; }
      else if (a === 'shareRef') { shareRef(b.getAttribute('data-ref')); return; }
      else if (a === 'installApp') { installApp(b); return; }
      else if (a === 'callback') { callback(); return; }
      else if (a === 'closeExit') { closeExit(); return; }
      else if (a === 'clearloc') { st.lat = null; st.lng = null; locMsg = ''; }
      else if (a === 'place') { st.place = v; }
      else if (a === 'issue') { var ix = st.issues.indexOf(v); if (ix > -1) st.issues.splice(ix, 1); else st.issues.push(v); }
      else if (a === 'pickDay') { st.dateIso = v; calY = +v.slice(0, 4); calM = +v.slice(5, 7) - 1; var ok = L.timeWindows(v, new Date()).filter(function (x) { return x.hour === st.hour && !x.disabled; }).length; if (!ok) { st.hour = null; st.slot = ''; } }
      else if (a === 'calPrev' || a === 'calNext') { var g0 = L.calendarGrid(calY, calM, todayIso(), 30), dir = a === 'calPrev' ? -1 : 1; if (dir < 0 ? g0.canPrev : g0.canNext) { calM += dir; if (calM < 0) { calM = 11; calY--; } if (calM > 11) { calM = 0; calY++; } } }
      else if (a === 'pickHour') { st.hour = +v; st.slot = L.hourGroup(+v); }
      else if (a === 'ampm') { clockMode = v; }
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
    if (a === 'reminder') { st.reminder = t.checked; save(); }
    if (t.getAttribute('data-f') === 'area') { st.area = t.value; save(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'mfilter') { var q = t.value.trim().toLowerCase(); document.querySelectorAll('.model-tile').forEach(function (b) { b.hidden = q !== '' && b.getAttribute('data-name').indexOf(q) === -1; }); return; }
    if (t.id === 'f-gsearch') { gsSearch(t.value); return; }
    var f = t.getAttribute && t.getAttribute('data-f');
    if (!f || !t.closest('#builder')) return;
    st[f] = f === 'phone' ? t.value.replace(/\D/g, '').slice(0, 10) : f === 'pin' ? t.value.replace(/\D/g, '').slice(0, 6) : f === 'coupon' ? L.cleanCoupon(t.value) : t.value;
    if (f === 'phone' && t.value !== st.phone) t.value = st.phone;
    if (f === 'coupon' && t.value !== st.coupon) t.value = st.coupon;
    if (f === 'nick' || f === 'model') renderSummary();
    if (f === 'pin') {
      if (t.value !== st.pin) t.value = st.pin;
      var pi = L.pinInfo(st.pin, window.MXP_PINS || {}, window.MXP_PINS_OFF || {}), note = $('#pinInfo'); if (note) note.textContent = pinNote(); drawPinMap();
      if (pi && pi.known && (!st.area || st.areaAuto)) { st.area = pi.name; st.areaAuto = true; var sel = $('#f-area'); if (sel) { if (![].some.call(sel.options, function (o) { return o.value === pi.name || o.text === pi.name; })) { var op = document.createElement('option'); op.textContent = pi.name; sel.insertBefore(op, sel.options[1] || null); } sel.value = pi.name; } }
    }
    if (f === 'area') st.areaAuto = false;
    if (f === 'model') { applyModel(); var mi = $('#modelInfo'), cs = $('#ccSeg'); if (mi) mi.textContent = modelNote(); if (cs) cs.innerHTML = ccSeg(); }
    save(); if (f === 'nick' || f === 'pin' || f === 'model') announce();
  });
  function scrollToBuilder() { var b = $('#build'); if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: 'smooth' }); }

  /* Use the phone's location: pick the nearest service area and attach a map pin. No third-party lookup, so nothing leaves the site. */
  /* Address search (Google Places): the picked place fills the address, PIN, area and map pin. */
  var gsItems = [], gsTimer = 0, gsSeq = 0;
  function gsClose() { var u = $('#gs-list'), i = $('#f-gsearch'); if (u) { u.hidden = true; u.innerHTML = ''; } if (i) i.setAttribute('aria-expanded', 'false'); }
  function gsSearch(text) {
    clearTimeout(gsTimer);
    if (text.trim().length < 3) { gsClose(); return; }
    gsTimer = setTimeout(function () {
      var seq = ++gsSeq;
      window.MXP_GMAPS.suggest(text.trim()).then(function (list) {
        if (seq !== gsSeq) return; gsItems = list;
        var u = $('#gs-list'), i = $('#f-gsearch'); if (!u) return;
        u.innerHTML = list.map(function (x, n) { return '<li role="option"><button type="button" data-act="gpick" data-i="' + n + '"><b>' + esc(x.main) + '</b><span>' + esc(x.secondary) + '</span></button></li>'; }).join('');
        u.hidden = !list.length; if (i) i.setAttribute('aria-expanded', String(!!list.length));
        var m = $('#gsMsg'); if (m) m.textContent = list.length ? '' : 'No match. Type your address in the box below.';
      }).catch(function () { var m = $('#gsMsg'); if (m) m.textContent = 'Address search is not available right now. Type your address below.'; });
    }, 300);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') gsClose(); });
  function gsPick(n) {
    var item = gsItems[n]; if (!item) return;
    gsClose();
    window.MXP_GMAPS.details(item).then(function (pl) {
      var f = L.placeToFields(pl);
      if (!f) { locMsg = 'Could not read that address. Type it below.'; return render(); }
      st.lat = f.lat; st.lng = f.lng; st.address = f.address;
      if (!f.inBengaluru) { locMsg = 'That address is outside Bengaluru. Send it anyway and we will tell you when we reach you.'; save(); return render(); }
      var place = L.nearestPlace(f.lat, f.lng);
      st.pin = f.pin || L.pinFromLocation(f.lat, f.lng, window.MXP_PIN_GEO) || st.pin;
      if (place) { st.area = place.name === 'Other area' ? st.area : place.name; st.areaAuto = true; }
      locMsg = 'Address saved' + (st.pin ? ', PIN code ' + st.pin + ' (please check it)' : '') + '. We serve all of Bengaluru.';
      save(); render();
    }).catch(function () { locMsg = 'Address search is not available right now. Type your address below.'; render(); });
  }
  function locate() {
    if (!navigator.geolocation) { locMsg = 'Your browser cannot share location. Type your address below.'; return render(); }
    locating = true; locMsg = ''; render();
    navigator.geolocation.getCurrentPosition(function (p) {
      locating = false;
      st.lat = Math.round(p.coords.latitude * 1e5) / 1e5; st.lng = Math.round(p.coords.longitude * 1e5) / 1e5;
      var place = L.nearestPlace(st.lat, st.lng);
      if (!place) { st.lat = null; st.lng = null; locMsg = 'That location looks wrong. Choose your area below.'; }
      else {
        st.area = place.name;
        var gotPin = place.served ? L.pinFromLocation(st.lat, st.lng, window.MXP_PIN_GEO) : '';
        if (gotPin) st.pin = gotPin;
        if (!st.address || /^Near /.test(st.address)) st.address = place.name === 'Other area' ? '' : 'Near ' + place.name;
        locMsg = place.served ? 'Location saved. You are in ' + place.name + (gotPin ? ', PIN code ' + gotPin + ' (please check it)' : '') + ', and we serve all of Bengaluru.' : 'You are outside Bengaluru. Send it anyway and we will tell you when we reach you.';
      }
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
    function go(extra) { track('lead_sos', { service: 'sos' }); location.href = waLink(base + (extra ? '\nMy location: ' + extra : '\nMy area: ')); }
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
    el.innerHTML = '<div class="card"><small>Your package for</small><h3>' + esc(bikeTitle().replace(/^./, function (c) { return c.toUpperCase(); })) + '</h3><dl>' + rows + '</dl>' + includedBox(sv, 'Included') + '<div class="tot tear"><span>Starting estimate, GST included</span><b>' + rupee(total()) + '</b></div><p>' + 'New customers pay only ₹' + fee('newfee', 99) + ' (returning customers ₹' + fee('advance', 349) + ') to confirm the booking, adjusted in your final bill if you go ahead. Final quote comes on WhatsApp.</p></div>';
  }
  function loadPrices() {
    if (!C.supabaseUrl || !C.supabaseAnonKey) return;
    fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/services?select=id,kind,name,price,description,includes&active=eq.true&order=sort.asc', { headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { if (Array.isArray(rows) && rows.length) { items = rows; if (!svc(st.service)) st.service = services()[0].id; st.addons = st.addons.filter(svc); render(); renderPrices(); applyLivePrices(); } })
      .catch(function () {});
  }

  function init() {
    utm();
    var attr = L.captureAttribution(location.search, (function () { try { return sessionStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })());
    st.ref_code = attr.ref_code; st.campaign = attr.campaign;
    var p = new URLSearchParams(location.search), area = p.get('area'), service = p.get('service');
    if (area && AREAS.indexOf(area) > -1) st.area = area;
    var shared = p.get('b');
    if (shared) {
      var sb2 = L.decodeBuild(shared, BIKES, items);
      if (sb2) { st.brand = sb2.brand; st.model = sb2.model; st.cc = sb2.cc; st.nick = sb2.nick; st.km = sb2.km; st.issues = sb2.issues; st.addons = sb2.addons; if (sb2.service) { st.service = sb2.service; st.picked = true; } st.step = sb2.service ? 2 : (sb2.model ? 1 : 0); setTimeout(function () { toast('Your build is back. Pick up where you left off.'); }, 600); }
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }
    var pre = L.prefillFromQuery(location.search, BIKES);
    if (pre.brand) { if (st.brand !== pre.brand) { st.brand = pre.brand; st.model = ''; } if (pre.model) st.model = pre.model; st.step = 0; }
    var ex = L.prefillExtras(location.search, items.map(function (x) { return x.id; }));
    if (ex.nick) st.nick = ex.nick;
    if (ex.pin) { st.pin = ex.pin; var pi0 = L.pinInfo(ex.pin, window.MXP_PINS || {}); if (pi0 && pi0.known && !st.area) { st.area = pi0.name; st.areaAuto = true; } }
    if (ex.service && svc(ex.service) && !service) { st.service = ex.service; st.picked = true; }
    if (service && svc(service)) st.service = service;
    if (ex.nick || pre.brand || ex.service || ex.pin) save();
    if (st.step > 3) st.step = 0;
    var t0 = todayIso(); calY = +t0.slice(0, 4); calM = +t0.slice(5, 7) - 1;
    if (st.dateIso && st.dateIso < t0) { st.dateIso = ''; st.hour = null; st.slot = ''; }
    if (st.dateIso) { calY = +st.dateIso.slice(0, 4); calM = +st.dateIso.slice(5, 7) - 1; }
    if (st.hour != null && st.hour >= 12) clockMode = 'pm';
    applyModel();
    render(); renderPrices(); loadPrices(); armIdle(); welcomeBack();
    var phoneEls = document.querySelectorAll('[data-phone]'); for (var i = 0; i < phoneEls.length; i++) if (C.phoneDisplay) phoneEls[i].textContent = C.phoneDisplay;
    var tel0 = L.callLink(C.callNumber) || L.callLink(C.whatsapp); if (tel0) document.querySelectorAll('[data-call]').forEach(function (a) { a.setAttribute('href', tel0); });
    var sb = $('#sosBtn'); if (sb) sb.addEventListener('click', sos);
    var mb = $('#mbar'); if (mb) { var onS = function () { mb.classList.toggle('show', window.scrollY > 480); }; window.addEventListener('scroll', onS, { passive: true }); onS(); }
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
