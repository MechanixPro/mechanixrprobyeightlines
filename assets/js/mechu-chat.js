/* Mechu, the Mechanix Pro virtual assistant: the chat. A guided script with fixed answers. It is NOT an AI model, calls no outside service
   and is not a person. Facts (prices, fee sizes, areas, FAQ wording) come from mechu-data.js, which scripts/build_pages.py writes from src/.
   What a customer types stays in this page's memory only. The one thing that leaves is the booking prefill (vehicle, brand, model, service, area)
   in the /book/ link, and a tracking lookup (booking ID and phone), which goes only to the existing track-booking function, as /track/ does.
   No inline script (CSP). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_MECHU_CHAT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var COPY = {
    greet: "Hi, I'm Mechu, the Mechanix Pro virtual assistant. I can help you book a service.",
    note: 'Automated helper, not a person',
    sub: 'Mechanix Pro virtual assistant',
    ph: 'Type a question',
    vehicle: 'Is it a bike or a car?',
    brand: 'Which brand is your bike? Pick one, or type the brand and model, like Honda Activa.',
    model: 'Which model? Pick one, or type it.',
    modelType: 'Type your bike model.',
    service: 'What does your bike need? These are starting prices for bikes up to 149cc, excluding GST.',
    carModel: 'Type your car make and model, like Maruti Swift.',
    carNeed: 'What does your car need?',
    area: 'Which area are you in? Pick one, or type your area or PIN code.',
    pay: 'You pay on the normal secure booking page. I never take payment or personal details here.',
    fee: 'A small confirmation fee is paid there to confirm your booking, and it is adjusted in your final bill.',
    carPrice: 'The price depends on your car and what it needs, so it is confirmed before any work starts. Send your car make, model and area and you will be told the price first.',
    carArea: 'We take car requests in Bengaluru. Send your car make, model and area, and we confirm the work, the price and the time.',
    pinAsk: 'Type your PIN code and I will check it against our list.',
    trackAsk: 'Enter your booking ID and the mobile number you booked with. They are sent only to our booking system to look up your status.',
    trackNo: 'Tracking is not available right now. Please message us on WhatsApp.',
    trackBad: 'Enter your booking ID and your mobile number.',
    trackWait: 'Checking your booking',
    trackFail: 'No connection. Please try again.',
    human: 'A person from our team can help you directly.',
    fallback: "I'm an automated helper and I don't have an answer to that. A person can help you.",
    refund: 'For cancellations and refunds, please read our refund policy.',
    pinHit: 'We cover PIN code {pin}, {name}.',
    pinMiss: 'I could not find PIN code {pin} on our list. Check the areas page, or ask a person.',
    pinBad: 'That does not look like a Bengaluru PIN code.',
    wa: 'Hi Mechanix Pro, I need help with my bike or car.'
  };
  var LINKS = { book: '/book/', rate: '/rate-card/', services: '/services/', areas: '/areas/', refund: '/refund-policy/', track: '/track/', help: '/help/' };
  var BIKE_SERVICES = ['basic', 'general', 'full', 'repair'];
  var STOP = 'a an the is are was do does did you your i my me we our can could to of in on for at it its and or with how what which who when there this that be have has get will would about please tell if any'.split(' ');
  var SYN = { scooty: 'scooter', scooters: 'scooter', bikes: 'bike', mechanics: 'mechanic', garages: 'garage', parts: 'part', prices: 'price' };

  function inr(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function slug(s) { return norm(s).replace(/ /g, '-'); }
  function stem(t) { t = SYN[t] || t; return t.length > 4 && /s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t; }
  function tokens(s) { return norm(s).split(' ').filter(function (t) { return t && STOP.indexOf(t) < 0; }).map(stem); }
  /* what goes into the /book/ link must never carry a phone number or an email, even if the customer typed one into a model or area */
  function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\S*@\S*/g, ' ').replace(/\+?\d[\d\s\-]{8,}\d/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

  /* the /book/ link, prefilled with the query parameters /book/ already reads (assets/js/book-pay.js): vehicle, brand, model, service, area */
  function bookUrl(S) {
    var q = new URLSearchParams(), car = S.vehicle === 'car';
    q.set('vehicle', car ? 'car' : 'bike');
    if (!car && S.brand) q.set('brand', clean(S.brand, 40));
    if (S.model) q.set('model', clean(S.model, car ? 60 : 40));
    if (S.service) q.set('service', S.service);
    if (S.area) q.set('area', clean(S.area, 40));
    return LINKS.book + '?' + q.toString();
  }

  /* the same request /track/ sends (assets/js/track.js, post('track-booking', { ref, phone })) */
  function trackRequest(C, ref, phone) {
    return { url: C.supabaseUrl + '/functions/v1/track-booking', init: { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify({ ref: ref, phone: phone }) } };
  }
  /* the answer of track-booking in plain words: the same headline and note as /track/ shows */
  function statusWords(v) {
    var tl = v.visit, closed = tl ? tl.closed : v.closed, note = tl ? tl.note : v.note, head;
    if (closed) head = 'Closed';
    else if (tl) head = ((tl.steps || []).filter(function (s) { return s.state === 'current'; })[0] || (tl.steps || [])[0] || {}).label;
    else head = (v.stages || [])[v.stage];
    var rows = [['Booking ID', v.booking_id], ['Service', v.service], [v.vehicle === 'car' ? 'Car' : 'Bike', v.bike], ['When', v.when], ['Estimated delivery', tl && tl.eta]].filter(function (r) { return r[1]; });
    return { head: head || 'Received', note: note || '', rows: rows, next: tl && tl.next || '' };
  }

  /* ---- facts and the keyword matcher ---- */
  function isCar(D, S, path, doc) {
    if (S && S.vehicle) return S.vehicle === 'car';
    if (/^\/car-service-bangalore/.test(path || '')) return true;
    var c = doc && doc.getElementById && doc.getElementById('veh-car'); return !!(c && c.checked);
  }
  function faqList(D, car) { return (car ? D.carFaq : D.faq) || []; }
  function faqById(D, id) { return (D.faq || []).filter(function (f) { return f.id === id; })[0]; }
  function prep(list) {
    if (list._p) return list._p;
    var N = list.length, df = {};
    var rows = list.map(function (f) { var q = {}, a = {}; tokens(f.q).forEach(function (t) { q[t] = 1; }); tokens(f.a).forEach(function (t) { a[t] = 1; }); Object.keys(q).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); return { f: f, q: q, a: a }; });
    var p = { rows: rows, w: function (t) { return 1 + Math.log(N / (df[t] || 1)); } };
    try { Object.defineProperty(list, '_p', { value: p, enumerable: false }); } catch (e) {}
    return p;
  }
  function score(list, text) {
    var p = prep(list), qt = {}; tokens(text).forEach(function (t) { qt[t] = 1; });
    var out = p.rows.map(function (r) { var s = 0; Object.keys(qt).forEach(function (t) { if (r.q[t]) s += 3 * p.w(t); else if (r.a[t]) s += 1 * p.w(t); }); return { f: r.f, s: s }; });
    out.sort(function (a, b) { return b.s - a.s; }); return out;
  }
  var INTENTS = [
    ['refund', /\b(refund|refunds|cancel|cancellation|cancelling|money back)\b/],
    ['track', /\b(track|tracking|status|booking id|booking reference)\b|where is my (booking|bike|car|mechanic)/],
    ['human', /\b(whatsapp|call|talk|speak|human|person|agent|someone|phone|contact)\b/],
    ['book', /\b(book|booking|appointment|schedule)\b/],
    ['prices', /\b(price|prices|pricing|cost|costs|charge|charges|rate|rates|fee|fees|rupees|cheap)\b|how much/],
    ['areas', /\b(area|areas|cover|coverage|pin|pincode|locality)\b/],
    ['hello', /^(hi|hello|hey|namaste)\b/]
  ];
  /* what a typed line means: { type: 'pin'|'intent'|'faq'|'fallback', ... } */
  function route(text, D, car) {
    var t = norm(text), m = String(text).match(/\b(\d{6})\b/);
    if (m) return { type: 'pin', pin: m[1] };
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i][1].test(t)) return { type: 'intent', id: INTENTS[i][0] };
    var s = score(faqList(D, car), text);
    if (s.length && s[0].s >= 3 && (s.length < 2 || s[0].s > s[1].s)) return { type: 'faq', id: s[0].f.id, f: s[0].f };
    return { type: 'fallback' };
  }
  function pinReply(pin, D) {
    if (!/^56[0-2]\d{3}$/.test(pin)) return COPY.pinBad;
    return (D.pins || {})[pin] ? COPY.pinHit.replace('{pin}', pin).replace('{name}', D.pins[pin]) : COPY.pinMiss.replace('{pin}', pin);
  }
  function parseBike(text, D) {
    var t = clean(text, 60), low = t.toLowerCase(), hit = null;
    (D.brands || []).forEach(function (b) {
      var n = b.b.toLowerCase(), first = n.split(/[ \/]+/)[0];
      if (!hit && (low === n || low.indexOf(n + ' ') === 0)) hit = { b: b.b, len: n.length };
      else if (!hit && n !== first && (low === first || low.indexOf(first + ' ') === 0)) hit = { b: b.b, len: first.length };
    });
    if (!hit) return { brand: '', model: t.slice(0, 40) };
    return { brand: hit.b, model: t.slice(hit.len).trim().slice(0, 40) };
  }
  function resolveArea(text, D) {
    var t = clean(text, 40), low = t.toLowerCase(), pin = (t.match(/\b(56[0-2]\d{3})\b/) || [])[1];
    if (pin && (D.pins || {})[pin]) return D.pins[pin];
    var hit = (D.areas || []).filter(function (a) { return a.n.toLowerCase() === low; })[0];
    return hit ? hit.n : t;
  }

  /* ---- the panel ---- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var UI = null;

  function open(btn, win) {
    win = win || window;
    var D = win.MXP_MECHU, C = win.MXP || {}, doc = win.document, S = {}, hist = [], awaiting = '', entry = null;
    D.pins = D.pins || win.MXP_PINS || {};   // PIN code names: pincodes.js, written from src/pincodes.json and loaded on every page that has Mechu
    var shade = el('div', 'mechu-shade'), panel = el('div', 'mechu-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'mechu-title');
    var head = el('div', 'mechu-head'), av = el('img'); av.src = '/assets/img/mechu-avatar.svg'; av.alt = ''; av.width = 40; av.height = 40;
    var who = el('div'), h = el('h2', '', 'Mechu'); h.id = 'mechu-title'; who.appendChild(h); who.appendChild(el('p', '', COPY.sub));
    var bBack = el('button', 'mechu-ic', '←'), bRe = el('button', 'mechu-ic', '↺'), bX = el('button', 'mechu-ic', '✕');
    [[bBack, 'Back one step'], [bRe, 'Start over'], [bX, 'Close chat']].forEach(function (x) { x[0].type = 'button'; x[0].setAttribute('aria-label', x[1]); });
    [av, who, bBack, bRe, bX].forEach(function (n) { head.appendChild(n); });
    var note = el('p', 'mechu-note', COPY.note);
    var log = el('div', 'mechu-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-relevant', 'additions');
    var chips = el('div', 'mechu-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Quick replies');
    var form = el('form', 'mechu-form'), input = el('input', 'mechu-in'), send = el('button', 'mechu-send', 'Send');
    input.type = 'text'; input.maxLength = 120; input.placeholder = COPY.ph; input.setAttribute('aria-label', COPY.ph); input.autocomplete = 'off'; input.setAttribute('autocapitalize', 'sentences'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    [head, note, log, chips, form].forEach(function (n) { panel.appendChild(n); });
    doc.body.appendChild(shade); doc.body.appendChild(panel);

    function bubble(who2) { var m = el('div', 'mechu-m ' + (who2 === 'me' ? 'mechu-me' : 'mechu-bot')); log.appendChild(m); return m; }
    /* parts: strings are paragraphs; {ul:[...]} a list; {links:[{t,href,go,wa,call}]} buttons that are links */
    function bot(parts) {
      var m = bubble('bot'); (Array.isArray(parts) ? parts : [parts]).forEach(function (p) {
        if (typeof p === 'string') m.appendChild(el('p', '', p));
        else if (p.ul) { var u = el('ul'); p.ul.forEach(function (x) { u.appendChild(el('li', '', x)); }); m.appendChild(u); }
        else if (p.links) { var w = el('div', 'mechu-links'); p.links.forEach(function (l) { w.appendChild(link(l)); }); m.appendChild(w); }
        else if (p.node) m.appendChild(p.node);
      });
      log.scrollTop = m.offsetHeight + 24 > log.clientHeight ? Math.max(0, m.offsetTop - log.offsetTop - 8) : log.scrollHeight;   // a long answer is read from its top
      return m;
    }
    function link(l) {
      var a = el('a', 'mechu-link' + (l.go ? ' go' : ''), l.t);
      if (l.wa) { var n = String(C.whatsapp || '').replace(/\D/g, ''), txt = l.wa; a.href = /^\d{12}$/.test(n) ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(txt) : '#'; a.setAttribute('data-wa', 'Contact'); a.setAttribute('data-wa-text', txt); }
      else if (l.call) { a.href = '#'; a.setAttribute('data-call', ''); var d = String(C.callNumber || C.whatsapp || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; if (/^91[6-9]\d{9}$/.test(d)) a.href = 'tel:+' + d; }
      else a.href = l.href;
      return a;
    }
    function setChips(list) {
      chips.textContent = '';
      list.forEach(function (c) { var b = el('button', 'mechu-chip', c.t); b.type = 'button'; b.setAttribute('data-n', c.n); if (c.a != null) b.setAttribute('data-a', c.a); chips.appendChild(b); });
    }
    function personLinks(extra) {
      var wa = COPY.wa + (S.model || S.area ? ' ' + [S.vehicle === 'car' ? 'Car' : 'Bike', S.brand, S.model].filter(Boolean).join(' ') + (S.area ? ', ' + S.area : '') + '.' : ''), ls = [{ t: 'WhatsApp us', wa: wa, go: true }];
      if (!C.callViaWhatsApp) ls.push({ t: 'Call us', call: true });
      return { links: ls.concat(extra || []) };
    }
    var HOME = [{ t: 'Book a service', n: 'book' }, { t: 'Prices', n: 'prices' }, { t: 'Areas we cover', n: 'areas' }, { t: 'Track my booking', n: 'track' }, { t: 'Talk to a person', n: 'human' }];
    var car = function () { return isCar(D, S, win.location.pathname, doc); };

    var SCREENS = {
      home: function () { awaiting = ''; var g = el('img', 'mechu-hero'); g.src = '/assets/img/mechu.svg'; g.alt = ''; g.width = 56; g.height = 70; bot([{ node: g }, COPY.greet]); setChips(HOME); },
      human: function () { awaiting = ''; bot([COPY.human, personLinks()]); setChips(HOME); },
      fallback: function () { awaiting = ''; bot([COPY.fallback, personLinks()]); setChips(HOME); },
      refund: function () { awaiting = ''; bot([COPY.refund, { links: [{ t: 'Read the refund policy', href: LINKS.refund, go: true }] }]); setChips(HOME); },
      faq: function (a) { awaiting = ''; var f = a && a.f; bot(f ? f.a : COPY.fallback); setChips(HOME); },
      prices: function () {
        awaiting = '';
        if (car()) { bot([COPY.carPrice, 'Confirmation fee for a car: ' + inr(D.tiers.car) + ', adjusted in your final bill.']); setChips([{ t: 'Book a service', n: 'book' }, { t: 'Talk to a person', n: 'human' }]); return; }
        var P = D.prices, pr = function (k) { return P[k].n + ' from ' + inr(P[k].p); };
        bot(['Starting prices for bikes up to 149cc, excluding GST:', { ul: BIKE_SERVICES.concat(['puncture', 'sos']).filter(function (k) { return P[k]; }).map(pr) }, 'Bikes of 150 to 250cc and 251 to 500cc have their own prices. Your exact quote comes before any work, and nothing starts without your OK.',
          'Confirmation fee on the booking page: ' + inr(D.tiers.std) + ' for bikes up to 149cc, ' + inr(D.tiers.mid) + ' for 150 to 250cc, ' + inr(D.tiers.big) + ' for 251cc and above, and ' + inr(D.tiers.car) + ' for cars. It is adjusted in your final bill.',
          { links: [{ t: 'See every price', href: LINKS.rate }] }]);
        setChips([{ t: 'Book a service', n: 'book' }, { t: 'Areas we cover', n: 'areas' }, { t: 'Talk to a person', n: 'human' }]);
      },
      areas: function () {
        awaiting = '';
        if (car()) { bot(COPY.carArea); setChips([{ t: 'Check a PIN code', n: 'pin' }, { t: 'Book a service', n: 'book' }, { t: 'Talk to a person', n: 'human' }]); return; }
        var f = faqById(D, 'which-areas-do-you-cover');
        bot([f ? f.a : '', { links: (D.areas || []).slice(0, 8).map(function (a) { return { t: a.n, href: a.u }; }).concat([{ t: 'All areas', href: LINKS.areas, go: true }]) }]);
        setChips([{ t: 'Check a PIN code', n: 'pin' }, { t: 'Book a service', n: 'book' }, { t: 'Talk to a person', n: 'human' }]);
      },
      pin: function (a) { awaiting = a && a.pin ? '' : 'pin'; bot(a && a.pin ? pinReply(a.pin, D) : COPY.pinAsk); setChips([{ t: 'Book a service', n: 'book' }, { t: 'Talk to a person', n: 'human' }]); input.focus(); },
      /* booking */
      book: function () { awaiting = ''; S = {}; bot(COPY.vehicle); setChips([{ t: 'Bike or scooter', n: 'veh', a: 'bike' }, { t: 'Car', n: 'veh', a: 'car' }]); },
      veh: function (a) { S.vehicle = a; if (a === 'car') SCREENS.carmodel(); else SCREENS.brand(); },
      brand: function () { awaiting = 'brand'; bot(COPY.brand); setChips((D.brands || []).slice(0, 8).map(function (b) { return { t: b.b, n: 'pickbrand', a: b.b }; }).concat([{ t: 'Another brand', n: 'typebike' }])); },
      typebike: function () { awaiting = 'brand'; bot('Type your bike brand and model.'); setChips([]); input.focus(); },
      pickbrand: function (a) {
        S.brand = a; awaiting = 'model'; var b = (D.brands || []).filter(function (x) { return x.b === a; })[0];
        bot(COPY.model); setChips(((b && b.m) || []).map(function (m) { return { t: m, n: 'pickmodel', a: m }; }).concat([{ t: 'Not listed', n: 'typemodel' }]));
      },
      typemodel: function () { awaiting = 'model'; bot(COPY.modelType); setChips([]); input.focus(); },
      pickmodel: function (a) { S.model = a; SCREENS.service(); },
      service: function () {
        awaiting = ''; bot(COPY.service);
        setChips(BIKE_SERVICES.filter(function (k) { return D.prices[k]; }).map(function (k) { return { t: D.prices[k].n + ' (from ' + inr(D.prices[k].p) + ')', n: 'pickservice', a: k }; }));
      },
      pickservice: function (a) { S.service = a; SCREENS.area(); },
      carmodel: function () { awaiting = 'carmodel'; bot(COPY.carModel); setChips([]); input.focus(); },
      carneed: function () { awaiting = ''; bot(COPY.carNeed); setChips([{ t: 'Service', n: 'pickcarneed', a: 'service' }, { t: 'Problem check', n: 'pickcarneed', a: 'problem' }]); },
      pickcarneed: function (a) { S.service = a; SCREENS.area(); },
      area: function () { awaiting = 'area'; bot(COPY.area); setChips((D.areas || []).slice(0, 8).map(function (x) { return { t: x.n, n: 'pickarea', a: x.n }; })); },
      pickarea: function (a) { S.area = a; SCREENS.summary(); },
      summary: function () {
        awaiting = ''; var sv = S.vehicle === 'car' ? (S.service === 'problem' ? 'Problem check' : 'Service') : (D.prices[S.service] || {}).n;
        var rows = [(S.vehicle === 'car' ? 'Car: ' : 'Bike: ') + [S.brand, S.model].filter(Boolean).join(' '), 'Needs: ' + sv, 'Area: ' + S.area];
        bot(['Here is what I have.', { ul: rows }, COPY.pay + ' ' + COPY.fee, { links: [{ t: 'Continue to the booking page', href: bookUrl(S), go: true }] }]);
        setChips([{ t: 'Change my answers', n: 'book' }, { t: 'Talk to a person', n: 'human' }]);
      },
      track: function () {
        awaiting = ''; setChips([{ t: 'Talk to a person', n: 'human' }]);
        if (!C.supabaseUrl || !C.supabaseAnonKey) { bot([COPY.trackNo, personLinks()]); return; }
        var f = el('form', 'mechu-card'), l1 = el('label', '', 'Booking ID'), i1 = el('input'), l2 = el('label', '', 'Mobile number'), i2 = el('input'), go = el('button', 'mechu-send', 'Check status'), er = el('p', 'mechu-err');
        l1.setAttribute('for', 'mechu-ref'); i1.id = 'mechu-ref'; i1.maxLength = 13; i1.autocomplete = 'off'; i1.setAttribute('autocapitalize', 'characters'); i1.placeholder = 'Booking ID';
        l2.setAttribute('for', 'mechu-ph'); i2.id = 'mechu-ph'; i2.type = 'tel'; i2.inputMode = 'numeric'; i2.maxLength = 14; i2.autocomplete = 'off'; go.type = 'submit'; er.setAttribute('role', 'alert');
        [l1, i1, l2, i2, go, er].forEach(function (n) { f.appendChild(n); });
        bot([COPY.trackAsk, { node: f }]);
        f.addEventListener('submit', function (e) {
          e.preventDefault(); er.textContent = '';
          var ref = i1.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, ''), ph = i2.value.replace(/\D/g, '').slice(-10);
          if (!ref || !/^[6-9]\d{9}$/.test(ph)) { er.textContent = COPY.trackBad; return; }
          go.disabled = true; er.textContent = COPY.trackWait + '…';
          var rq = trackRequest(C, ref, ph);
          win.fetch(rq.url, rq.init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (x) {
            go.disabled = false; i2.value = '';
            if (!x.ok) { er.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; return; }
            er.textContent = ''; var w = statusWords(x.d);
            bot([w.head + '. ' + w.note, { ul: w.rows.map(function (r) { return r[0] + ': ' + r[1]; }) }, w.next ? 'What happens next. ' + w.next : '', { links: [{ t: 'Open full tracking', href: LINKS.track + '?ref=' + encodeURIComponent(ref), go: true }] }].filter(Boolean));
          }).catch(function () { go.disabled = false; er.textContent = COPY.trackFail; });
        });
        setTimeout(function () { i1.focus(); }, 0);
      }
    };

    function run(name, arg, echo, fresh) {
      if (fresh !== false) hist.push({ n: name, a: arg, e: echo, len: log.children.length, S: JSON.parse(JSON.stringify(S)) });
      if (echo) { bubble('me').appendChild(el('p', '', echo)); }
      (SCREENS[name] || SCREENS.home)(arg);
      var first = chips.querySelector('button'); if (first && !awaiting) first.focus();
      bBack.disabled = hist.length < 2;
    }
    function back() {
      if (hist.length < 2) return; hist.pop(); var p = hist[hist.length - 1];
      while (log.children.length > p.len) log.removeChild(log.lastChild);
      S = JSON.parse(JSON.stringify(p.S)); run(p.n, p.a, p.e, false);
    }
    function restart() { log.textContent = ''; hist = []; S = {}; run('home'); }

    chips.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) run(b.getAttribute('data-n'), b.getAttribute('data-a'), b.textContent); });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var t = input.value.trim().slice(0, 120); if (!t) return; input.value = '';
      var a = awaiting;
      if (a === 'pin') { var m = t.match(/\b(\d{6})\b/); return run('pin', { pin: m ? m[1] : t.replace(/\D/g, '') }, t); }
      if (a === 'brand') { var pb = parseBike(t, D); S.brand = pb.brand; S.model = pb.model; return run(pb.model ? 'service' : 'pickbrand', pb.model ? undefined : pb.brand, t); }
      if (a === 'model') { S.model = clean(t, 40); return run('service', undefined, t); }
      if (a === 'carmodel') { S.model = clean(t, 60); return run('carneed', undefined, t); }
      if (a === 'area') { S.area = resolveArea(t, D); return run('summary', undefined, t); }
      var r = route(t, D, car());
      if (r.type === 'pin') run('pin', r, t);
      else if (r.type === 'intent') run(r.id === 'hello' ? 'home' : r.id, undefined, t);
      else if (r.type === 'faq') run('faq', r, t);
      else run('fallback', undefined, t);
    });
    bBack.addEventListener('click', back); bRe.addEventListener('click', restart); bX.addEventListener('click', close); shade.addEventListener('click', close);
    function focusables() { return Array.prototype.filter.call(panel.querySelectorAll('button, a[href], input, select, textarea'), function (n) { return !n.disabled && n.offsetParent !== null; }); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(); if (!f.length) return; var i = f.indexOf(doc.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
    doc.addEventListener('keydown', onKey);
    function close() {
      doc.removeEventListener('keydown', onKey); panel.remove(); shade.remove(); UI = null;
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    }
    if (btn) btn.setAttribute('aria-expanded', 'true');
    UI = { close: close };
    run('home');
    if (!chips.querySelector('button')) input.focus();
    return UI;
  }
  function toggle(btn) { if (UI) UI.close(); else open(btn); }

  return { COPY: COPY, LINKS: LINKS, bookUrl: bookUrl, trackRequest: trackRequest, statusWords: statusWords, route: route, score: score, pinReply: pinReply, parseBike: parseBike, resolveArea: resolveArea, isCar: isCar, tokens: tokens, clean: clean, faqList: faqList, faqById: faqById, inr: inr, open: open, toggle: toggle };
});
