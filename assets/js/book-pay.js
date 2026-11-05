/* /book/: book a doorstep service and pay a small confirmation fee (Rs 49 to Rs 99 by engine size). No inline script (CSP).
   1) the form is sent to our server (book-start), which saves the booking, works out the fee itself and opens one Razorpay order,
   2) Razorpay's payment window opens, 3) the result goes to verify-payment. The booking is confirmed only when the payment is verified.
   The amount shown here is a preview with the same rule; the server's amount is the one charged, and if it differs we ask before charging. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_BOOK = api; if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', function () { api.init(root); }); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FEE_MIN = 49, FEE_MAX = 99, UNKNOWN = 69, DEFAULTS = { confirm_std: 49, confirm_mid: 69, confirm_big: 99, confirm_car: 99 };
  var clamp = function (n) { n = Math.round(Number(n)); return !isFinite(n) || n <= 0 ? UNKNOWN : Math.min(FEE_MAX, Math.max(FEE_MIN, n)); };
  var RANK = { std: 0, mid: 1, big: 2 };
  /* Same rule as supabase/functions/_shared/confirm-fee.ts: a cc number in the model name wins, and a picked size can only raise it. */
  function engineFromModel(model) {
    var nums = (String(model || '').match(/\d{2,4}/g) || []).map(Number).filter(function (n) { return n >= 50 && n <= 2500; });
    if (!nums.length) return null; var cc = Math.max.apply(null, nums); return cc >= 251 ? 'big' : cc >= 150 ? 'mid' : 'std';
  }
  function engineFor(model, sent) {
    var a = engineFromModel(model), b = RANK.hasOwnProperty(sent) ? sent : null;
    if (a && b) return RANK[a] >= RANK[b] ? a : b; return a || b;
  }
  function feeFor(o, rows) {
    var price = function (id) { return clamp(rows && rows[id] != null ? rows[id] : DEFAULTS[id]); };
    if (o.vehicle === 'car') return { amount: price('confirm_car'), unknown: false };
    var e = engineFor(o.model, o.engine);
    return e ? { amount: price('confirm_' + e), unknown: false } : { amount: UNKNOWN, unknown: true };
  }
  function feeLine(vehicle, amount) { return 'Confirmation fee for your ' + (vehicle === 'car' ? 'car' : 'bike size') + ': ₹' + amount + '. Adjusted in your final bill.'; }

  var ERR = { phone: 'Enter a valid 10-digit mobile number.', email: 'Enter a valid email address. We send your confirmation and code there.', name: 'Enter your name.', house: 'Enter your house or flat number.', street: 'Enter your street or a landmark.', area: 'Enter your area.',
    pincode: 'Enter a Bengaluru PIN code (6 digits, like 560102).', model: 'Choose or type your model.', service_id: 'Choose what your bike needs.', car_model: 'Enter your car make and model.', preferred_date: 'Pick a day.', preferred_slot: 'Pick a time slot.' };
  /* Returns { field: message } for what is wrong. Step 1, 2 or 3 limits the check to that step; no step checks everything. */
  function problems(v, step) {
    var e = {}, car = v.vehicle === 'car';
    if (!step || step === 1) {
      if (car) { if (String(v.car_model || '').trim().length < 2) e.car_model = ERR.car_model; }
      else { if (String(v.model || '').trim().length < 2) e.model = ERR.model; if (['basic', 'general', 'full', 'repair'].indexOf(v.service_id) < 0) e.service_id = ERR.service_id; }
    }
    if (!step || step === 2) {
      if (String(v.house || '').trim().length < 2) e.house = ERR.house;
      if (String(v.street || '').trim().length < 3) e.street = ERR.street;
      if (String(v.area || '').trim().length < 2) e.area = ERR.area;
      if (!/^56[0-2]\d{3}$/.test(String(v.pincode || '').replace(/\s/g, ''))) e.pincode = ERR.pincode;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.preferred_date || '')) e.preferred_date = ERR.preferred_date;
      if (['morning', 'afternoon', 'evening', 'asap'].indexOf(v.preferred_slot) < 0) e.preferred_slot = ERR.preferred_slot;
    }
    if (!step || step === 3) {
      if (String(v.name || '').trim().length < 2) e.name = ERR.name;
      if (!/^[6-9]\d{9}$/.test(String(v.phone || '').replace(/\D/g, '').slice(-10))) e.phone = ERR.phone;
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v.email || '').trim())) e.email = ERR.email;
    }
    return e;
  }
  /* The body sent to book-start. The fee is not in it: the server works it out. */
  function payload(v, key, utm) {
    var car = v.vehicle === 'car';
    return { client_key: key, vehicle: car ? 'car' : 'bike', brand: car ? '' : v.brand || '', model: car ? v.car_model : v.model, engine_class: car ? null : v.engine_class || null, service_id: car ? '' : v.service_id, car_need: car ? v.car_need : undefined, need_text: v.need_text || '',
      house: v.house, street: v.street, area: v.area, pincode: String(v.pincode || '').replace(/\s/g, ''), lat: v.lat || null, lng: v.lng || null, preferred_date: v.preferred_date, preferred_slot: v.preferred_slot,
      name: v.name, phone: String(v.phone || '').replace(/\D/g, '').slice(-10), email: String(v.email || '').trim(), consent_whatsapp: !!v.consent_whatsapp, utm: utm || {} };
  }
  var uuid = function () { try { return crypto.randomUUID(); } catch (e) { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } };

  function init(win) {
    var doc = win.document, C = win.MXP || {}, form = doc.getElementById('bkForm'); if (!form) return;
    var $ = function (s) { return form.querySelector(s); }, all = function (s) { return Array.prototype.slice.call(form.querySelectorAll(s)); };
    var KEY = 'mxp_book_v1', rows = {}, step = 1, busy = false, draft = {}, started = false;
    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var store = { get: function () { try { return JSON.parse(win.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }, set: function (o) { try { win.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }, clear: function () { try { win.localStorage.removeItem(KEY); } catch (e) {} } };
    var val = function (n) { var el = form.elements[n]; if (!el) return ''; if (el.length && el[0] && el[0].type === 'radio') { var c = all('[name="' + n + '"]:checked')[0]; return c ? c.value : ''; } return el.type === 'checkbox' ? el.checked : el.value; };
    var values = function () { var o = {}; ['vehicle', 'brand', 'model', 'engine_class', 'service_id', 'car_model', 'car_need', 'need_text', 'house', 'street', 'area', 'pincode', 'lat', 'lng', 'preferred_date', 'preferred_slot', 'name', 'phone', 'email', 'consent_whatsapp'].forEach(function (n) { o[n] = val(n); }); return o; };
    var SAVE = ['vehicle', 'brand', 'model', 'engine_class', 'service_id', 'car_model', 'car_need', 'need_text', 'house', 'street', 'area', 'pincode', 'preferred_date', 'preferred_slot', 'name', 'phone', 'email'];
    var save = function () { var o = store.get(); SAVE.forEach(function (n) { o[n] = val(n); }); o.step = step; o.key = o.key || uuid(); store.set(o); draft = o; };

    /* brands, models */
    var BIKES = win.MXP_BIKES || {}, brandSel = $('#bk-brand'), dl = $('#bk-models');
    Object.keys(BIKES).forEach(function (b) { var o = doc.createElement('option'); o.value = b; o.textContent = b; brandSel.appendChild(o); });
    var fillModels = function () { dl.innerHTML = ''; (BIKES[brandSel.value] || []).forEach(function (m) { var o = doc.createElement('option'); o.value = m[0]; dl.appendChild(o); }); };
    var guessEngine = function () {
      var m = $('#bk-model').value, list = BIKES[brandSel.value] || [], hit = list.filter(function (x) { return x[0].toLowerCase() === m.trim().toLowerCase(); })[0];
      var L = win.MXP_LOGIC, g = engineFromModel(m) || (hit ? (L && L.engineGuess ? L.engineGuess(hit[0], hit[2]) : (hit[2] ? 'big' : 'std')) : null);
      if (g && hit || g && engineFromModel(m)) $('#bk-engine').value = g;
    };

    /* days */
    var days = $('#bk-days'), two = function (n) { return (n < 10 ? '0' : '') + n; };
    for (var i = 0; i < 7; i++) {
      var d = new Date(); d.setDate(d.getDate() + i); var iso = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
      var lab = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }), sub = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      days.insertAdjacentHTML('beforeend', '<label class="bk-pick"><input type="radio" name="preferred_date" value="' + iso + '"><span>' + esc(lab) + '<small>' + esc(sub) + '</small></span></label>');
    }

    /* fee preview */
    var showFee = function () {
      var v = values(), car = v.vehicle === 'car', f = feeFor({ vehicle: v.vehicle, model: car ? '' : v.model, engine: v.engine_class }, rows);
      $('#bk-fee-amt').textContent = 'Pay ₹' + f.amount + ' to confirm'; $('#bk-fee-line').textContent = feeLine(v.vehicle, f.amount) + (f.unknown ? ' Your engine size is not clear, so our team will check it.' : '');
      $('#bk-pay').textContent = 'Pay ₹' + f.amount + ' to confirm'; return f;
    };
    var trust = $('#bk-trust'), setVehicle = function () {
      var car = val('vehicle') === 'car'; form.setAttribute('data-veh', car ? 'car' : 'bike');
      all('[data-only]').forEach(function (el) { el.hidden = el.getAttribute('data-only') !== (car ? 'car' : 'bike'); });
      var extra = trust.querySelector('[data-bike-proof]'); if (extra) extra.remove();
      /* The two owner-confirmed claims are for bikes only. */
      if (!car) trust.insertAdjacentHTML('beforeend', '<li data-bike-proof>10,000+ services done. 1,300+ gated communities trust us.</li>');
      showFee();
    };

    /* steps */
    var show = function (n) {
      step = n; all('[data-step]').forEach(function (f) { f.hidden = Number(f.getAttribute('data-step')) !== n; });
      all('.bk-steps li').forEach(function (li) { var s = Number(li.getAttribute('data-s')); li.className = s === n ? 'on' : s < n ? 'done' : ''; });
      var f = $('[data-step="' + n + '"]'); if (f) { var first = f.querySelector('input:not([type=hidden]):not([type=radio]),select'); if (first && n > 1) first.focus({ preventScroll: true }); if (started) f.scrollIntoView({ block: 'start', behavior: 'auto' }); } save();
    };
    var markErrors = function (e) {
      all('[data-err]').forEach(function (p) { p.textContent = e[p.getAttribute('data-err')] || ''; });
      all('.bad').forEach(function (x) { x.classList.remove('bad'); });
      var firstBad = null; Object.keys(e).forEach(function (k) { var el = form.elements[k === 'car_model' ? 'car_model' : k]; if (el && el.classList) { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); if (!firstBad) firstBad = el; } });
      if (firstBad && firstBad.focus) firstBad.focus();
    };
    form.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-next]'); if (!b) return; var to = Number(b.getAttribute('data-next'));
      if (to > step) { var e = problems(values(), step); markErrors(e); if (Object.keys(e).length) return; } show(to);
    });
    form.addEventListener('input', function (ev) { if (ev.target.name === 'model' || ev.target.name === 'brand') guessEngine(); save(); showFee(); });
    form.addEventListener('change', function (ev) { if (ev.target.name === 'vehicle') setVehicle(); if (ev.target.name === 'brand') { fillModels(); } save(); showFee(); });

    /* location (optional, only when the customer taps) */
    $('#bk-geo').addEventListener('click', function () {
      var m = $('#bk-geomsg'); if (!win.navigator.geolocation) { m.textContent = 'Your phone does not share its location here. Type the address instead.'; return; }
      m.textContent = 'Getting your location…';
      win.navigator.geolocation.getCurrentPosition(function (p) { $('#bk-lat').value = p.coords.latitude.toFixed(5); $('#bk-lng').value = p.coords.longitude.toFixed(5); m.textContent = 'Location added. Please still check the address above.'; }, function () { m.textContent = 'Could not get your location. Type the address instead.'; }, { enableHighAccuracy: false, timeout: 10000 });
    });

    /* restore saved progress and the link's prefill */
    var q = new URLSearchParams(win.location.search), saved = store.get(); draft = saved;
    var set = function (n, v) { var el = form.elements[n]; if (!el || v == null || v === '') return; if (el.length && el[0] && el[0].type === 'radio') { all('[name="' + n + '"]').forEach(function (r) { r.checked = r.value === v; }); } else el.value = v; };
    SAVE.forEach(function (n) { set(n, saved[n]); });
    if (q.get('vehicle') === 'car') set('vehicle', 'car');
    if (q.get('brand') && BIKES[q.get('brand')]) set('brand', q.get('brand')); fillModels();
    if (q.get('model')) set('model', q.get('model')); if (['basic', 'general', 'full', 'repair'].indexOf(q.get('service')) > -1) set('service_id', q.get('service')); if (q.get('area')) set('area', q.get('area'));
    if (!saved.model && q.get('model')) guessEngine();
    setVehicle(); show(saved.step && saved.step < 3 ? saved.step : 1); started = true;

    /* live fee rows (public, active prices); the defaults above are used if this fails */
    if (C.supabaseUrl && C.supabaseAnonKey && win.fetch) {
      win.fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/services?select=id,price&active=eq.true&id=in.(confirm_std,confirm_mid,confirm_big,confirm_car)', { headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey } })
        .then(function (r) { return r.ok ? r.json() : []; }).then(function (list) { (list || []).forEach(function (x) { rows[x.id] = x.price; }); showFee(); }).catch(function () {});
    }

    /* pay */
    var call = function (fn, body) {
      return win.fetch(C.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, d: d }; }); });
    };
    var loadCheckout = function () { return new Promise(function (resolve, reject) { if (win.Razorpay) return resolve(); var s = doc.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = resolve; s.onerror = function () { reject(new Error('load')); }; doc.head.appendChild(s); }); };
    var msg = $('#bk-msg'), payBtn = $('#bk-pay');
    var free = function () { busy = false; payBtn.disabled = false; showFee(); };
    var done = function (d, email) {
      store.clear(); form.hidden = true; $('.bk-steps').hidden = true;
      var link = d.track_token ? '<a class="btn btn-primary wide" href="/track/?t=' + esc(d.track_token) + '">Track your booking</a>' : '';
      doc.getElementById('bkDone').innerHTML = '<div class="card bk-card bk-done"><h2>Your slot is confirmed.</h2><p>' + (d.booking_id ? 'Booking ID <b>' + esc(d.booking_id) + '</b>. ' : '') + 'We sent your confirmation and your one-time code to <b>' + esc(email) + '</b>' + ' and on WhatsApp. Give the code to the mechanic when they arrive. Do not share it before.</p>' + link + '<p class="tiny muted">The fee is adjusted in your final bill. You get an itemised quote before any work, and nothing starts without your OK.</p></div>';
      doc.getElementById('bkDone').scrollIntoView({ block: 'start' });
    };
    var verify = function (resp, email) {
      msg.textContent = 'Confirming your payment…';
      call('verify-payment', { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(function (x) {
        if (x.ok && x.d.status === 'paid') done(x.d, email);
        else if (x.status === 202) { msg.textContent = x.d.message || 'Your payment is being confirmed. We will email you.'; }
        else { free(); msg.textContent = (x.d && x.d.error) || 'We could not confirm the payment. If money was taken, message us on WhatsApp.'; }
      }).catch(function () { free(); msg.textContent = 'No connection while confirming. If money was taken, we will still confirm your booking and email you. You can also message us on WhatsApp.'; });
    };
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); if (busy) return;
      var v = values(), e = problems(v); markErrors(e);
      if (Object.keys(e).length) { var bad = Object.keys(e)[0], s = /^(model|service_id|car_model)$/.test(bad) ? 1 : /^(name|phone|email)$/.test(bad) ? 3 : 2; msg.textContent = 'Please check the highlighted details.'; if (s !== step) show(s); return; }
      if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Online booking is not available right now. Message us on WhatsApp.'; return; }
      busy = true; payBtn.disabled = true; msg.textContent = 'Starting your payment…'; var shown = showFee(), s0 = store.get();
      call('book-start', payload(v, s0.key || (save(), store.get().key), {})).then(function (x) {
        if (!x.ok) { free(); if (x.d && x.d.field) markErrors((function (o) { o[x.d.field] = x.d.error; return o; })({})); msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; return; }
        if (x.d.status === 'paid') { done(x.d, v.email); return; }
        if (Number(x.d.fee) !== shown.amount) { free(); $('#bk-fee-amt').textContent = 'Pay ₹' + x.d.fee + ' to confirm'; $('#bk-fee-line').textContent = x.d.fee_line || ''; msg.textContent = 'The confirmation fee for your vehicle is ₹' + x.d.fee + '. Tap pay again to continue.'; payBtn.textContent = 'Pay ₹' + x.d.fee + ' to confirm'; return; }
        return loadCheckout().then(function () {
          var o = x.d, rzp = new win.Razorpay({ key: o.key_id, amount: o.amount, currency: o.currency, order_id: o.order_id, name: 'Mechanix Pro', description: 'Confirmation fee, adjusted in your final bill',
            prefill: { name: v.name, email: v.email, contact: '+91' + String(v.phone).replace(/\D/g, '').slice(-10) }, theme: { color: '#F2801F' },
            handler: function (resp) { verify(resp, v.email); }, modal: { ondismiss: function () { free(); msg.textContent = 'Payment cancelled. Nothing was charged. Tap pay to try again.'; } } });
          rzp.on('payment.failed', function (r) { free(); msg.textContent = 'Payment failed' + (r && r.error && r.error.description ? ': ' + r.error.description : '') + '. You can try again.'; });
          msg.textContent = ''; rzp.open();
        }).catch(function () { free(); msg.textContent = 'Could not load the payment window. Check your connection and try again.'; });
      }).catch(function () { free(); msg.textContent = 'No connection. Your details are saved on this phone. Please try again.'; });
    });
  }
  return { init: init, feeFor: feeFor, feeLine: feeLine, engineFromModel: engineFromModel, problems: problems, payload: payload, clamp: clamp, FEE_MIN: FEE_MIN, FEE_MAX: FEE_MAX };
});
