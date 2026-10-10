/* "Pro", the Mechanix Pro helper character. Original SVG, scripted (see pro-script.js): no AI, no tracking of names or numbers.
   Shows once per visit on a few pages, reacts to the booking form, and can be closed or hidden. */
(function () {
  'use strict';
  var S = window.MXP_PRO, C = window.MXP || {};
  if (!S) return;
  var path = location.pathname, isBook = path.indexOf('/book') === 0;
  var greeting = isBook ? null : S.greet(path);
  if (!isBook && !greeting) return;
  var KEY = 'mxp_pro_off', SEEN = 'mxp_pro_seen';
  try { var off = +localStorage.getItem(KEY) || 0; if (off && Date.now() - off < 30 * 86400000) return; } catch (e) {}
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var variant = 'pro';
  function track(n, p) { try { if (window.mxpTrack) { p = p || {}; p.variant = variant; window.mxpTrack(n, p); } } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function build(def) {
  // The character. Brand colours; the badge is the real logo mark. Poses are CSS classes on the svg.
  var ART = '<svg class="pro-svg s-idle" viewBox="0 0 100 120" aria-hidden="true" focusable="false">' +
    '<g class="pro-bob">' +
    '<g class="pro-arm-l"><path d="M20 94 L11 112" stroke="#14295A" stroke-width="11" stroke-linecap="round"/><circle cx="10" cy="115" r="6" fill="#E8B58C"/>' +
    '<g transform="translate(5 98) rotate(18)"><rect x="-2" y="0" width="4" height="24" rx="2" fill="#9AA3B5"/><circle cx="0" cy="-1" r="5.5" fill="#F2801F"/></g></g>' +
    '<path d="M14 120 C14 92 30 82 50 82 C70 82 86 92 86 120 Z" fill="#14295A"/>' +
    '<path d="M38 83 L50 99 L62 83 Z" fill="#E8B58C"/><path d="M35 83 L50 102 L65 83" fill="none" stroke="#F2801F" stroke-width="3" stroke-linejoin="round"/>' +
    '<image href="/assets/img/logo-mark.webp" x="62" y="97" width="15" height="16"/>' +
    '<g class="pro-arm"><path d="M80 94 L90 112" stroke="#14295A" stroke-width="11" stroke-linecap="round"/><circle cx="91" cy="115" r="6" fill="#E8B58C"/></g>' +
    '<g class="pro-head"><circle cx="24" cy="55" r="5" fill="#E8B58C"/><circle cx="76" cy="55" r="5" fill="#E8B58C"/>' +
    '<circle cx="50" cy="53" r="26" fill="#E8B58C"/>' +
    '<path d="M23 49 C23 12 77 12 77 49 Z" fill="#14295A"/><rect x="17" y="45" width="66" height="7" rx="3.5" fill="#14295A"/><path d="M24 41 H76" stroke="#F2801F" stroke-width="3.5"/><circle cx="50" cy="31" r="3.5" fill="#F2801F"/>' +
    '<g class="pro-eyes"><ellipse cx="41" cy="58" rx="3" ry="3.6" fill="#1D1D1F"/><ellipse cx="59" cy="58" rx="3" ry="3.6" fill="#1D1D1F"/></g>' +
    '<path class="pro-brow-l" d="M36 53 Q41 50 46 53" fill="none" stroke="#5A3A22" stroke-width="2" stroke-linecap="round"/><path class="pro-brow-r" d="M54 53 Q59 50 64 53" fill="none" stroke="#5A3A22" stroke-width="2" stroke-linecap="round"/>' +
    '<ellipse cx="35" cy="66" rx="4" ry="2.6" fill="#F2801F" opacity=".25"/><ellipse cx="65" cy="66" rx="4" ry="2.6" fill="#F2801F" opacity=".25"/>' +
    '<path class="pro-smile" d="M42 68 Q50 74 58 68" fill="none" stroke="#7A3B1E" stroke-width="2.6" stroke-linecap="round"/><path class="pro-grin" d="M41 67 Q50 80 59 67 Z" fill="#7A3B1E"/>' +
    '</g></g></svg>';

  var root = el('aside', 'pro'); root.id = 'pro'; root.setAttribute('aria-label', 'Pro, the Mechanix Pro helper');
  var launch = el('button', 'pro-launch'); launch.type = 'button'; launch.setAttribute('aria-expanded', 'false'); launch.setAttribute('aria-controls', 'pro-card'); launch.setAttribute('aria-label', 'Open Pro, the Mechanix Pro helper');
  var sph = null;
  if (variant === 'sphere' && def && window.MXP_SPHERE) { var host = el('span', 'sphere-host'); launch.appendChild(host); launch.classList.add('is-sphere'); sph = window.MXP_SPHERE.create(host, def, { reduce: reduce }); sph.play('idle'); }
  else launch.innerHTML = ART; // fixed artwork only, never visitor text
  var dot = el('i', 'pro-dot'); dot.hidden = true; launch.appendChild(dot);
  var card = el('div', 'pro-card'); card.id = 'pro-card';
  var say = el('p', 'pro-say'); say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  var chips = el('div', 'pro-chips');
  var foot = el('div', 'pro-foot');
  var close = el('button', 'pro-x', 'Close'); close.type = 'button';
  var hide = el('button', 'pro-x', 'Hide Pro'); hide.type = 'button';
  foot.appendChild(close); foot.appendChild(hide);
  card.appendChild(say); card.appendChild(chips); card.appendChild(foot);
  root.appendChild(card); root.appendChild(launch); document.body.appendChild(root);

  var svg = launch.querySelector('.pro-svg'), poseTimer = 0, quiet = false, opened = false;
  var SPHERE_ANIM = { wave: 'happy', think: 'listening', nod: 'curious', cheer: 'celebrate', idle: 'idle' };
  function pose(name) {
    if (sph) { sph.play(SPHERE_ANIM[name] || 'idle'); clearTimeout(poseTimer); if (name !== 'idle') poseTimer = setTimeout(function () { sph.play('idle'); }, reduce ? 4000 : 5200); return; }
    svg.setAttribute('class', 'pro-svg s-' + name); void svg.getBoundingClientRect();
    clearTimeout(poseTimer); if (name !== 'idle') poseTimer = setTimeout(function () { svg.setAttribute('class', 'pro-svg s-idle'); }, reduce ? 4000 : 3400);
  }
  function waLink(text) { var n = String(C.whatsapp || '').replace(/\D/g, ''); return /^\d{12}$/.test(n) ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(text) : null; }
  function setOpen(v) { root.classList.toggle('open', v); launch.setAttribute('aria-expanded', String(v)); if (v) dot.hidden = true; }
  var teaserTimer = 0;
  function setTeaser(v) { root.classList.toggle('teaser', v); clearTimeout(teaserTimer); if (v) teaserTimer = setTimeout(function () { if (root.classList.contains('teaser')) { setOpen(false); root.classList.remove('teaser'); } }, 10000); }
  function show(msg, auto, teaser) {
    if (!msg) return;
    say.textContent = msg.text; chips.textContent = '';
    (msg.chips || []).forEach(function (c) {
      var href = c.wa ? waLink(c.text || 'Hi Mechanix Pro') : c.href; if (!href) return;
      var a = el('a', 'pro-chip', c.label); a.href = href; if (c.wa) { a.rel = 'noopener'; }
      a.addEventListener('click', function () { track('avatar_chip', { label: c.label, page: path }); }); chips.appendChild(a);
    });
    pose(msg.state || 'idle');
    if (quiet && auto) { dot.hidden = false; return; }
    setOpen(true); setTeaser(!!teaser);
  }
  card.addEventListener('click', function (e) { if (root.classList.contains('teaser') && !e.target.closest('a')) { setTeaser(false); } });
  launch.addEventListener('click', function () {
    if (root.classList.contains('teaser')) { setTeaser(false); return; }
    var v = !root.classList.contains('open'); setOpen(v);
    if (v) { quiet = false; if (!opened) { opened = true; track('avatar_open', { page: path }); } if (!say.textContent) show(greeting || S.react('idle')); else pose('wave'); }
  });
  close.addEventListener('click', function () { setOpen(false); quiet = true; launch.focus(); });
  hide.addEventListener('click', function () { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} root.remove(); track('avatar_hide', { page: path }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('open')) { setOpen(false); quiet = true; launch.focus(); } });

  // Pages with a greeting: say hello once per visit after a short pause.
  if (greeting) {
    var seen = false; try { seen = sessionStorage.getItem(SEEN) === '1'; } catch (e) {}
    if (!seen) setTimeout(function () { try { sessionStorage.setItem(SEEN, '1'); } catch (e) {} if (!root.classList.contains('open')) { opened = true; track('avatar_shown', { page: path }); show(greeting, false, true); } }, 6000);
  }

  // The booking form: Pro reacts to what the visitor builds (events come from app.js).
  if (isBook) {
    var last = null, bikeTimer = 0, idleTimer = 0, idleSent = {};
    var armIdle = function (step) { clearTimeout(idleTimer); if (step >= 1 && !idleSent[step]) idleTimer = setTimeout(function () { idleSent[step] = true; show(S.react('idle'), true); }, 30000); };
    document.addEventListener('mxp:state', function (e) {
      var d = e.detail || {}, p = last; last = d; if (!p) return;
      armIdle(d.step);
      if (d.step !== p.step) { if (d.step === 3) show(S.react('final', {}), true, true); return; }
      if (d.nick !== p.nick && d.nick && d.nick.length >= 2) { clearTimeout(bikeTimer); bikeTimer = setTimeout(function () { show(S.react('bike', { nick: d.nick }), true, true); }, 900); return; }
      if (d.model !== p.model && d.model && !d.nick) { show(S.react('bike', { model: d.model }), true, true); return; }
      if (d.service !== p.service && d.picked) { show(S.react('service', { name: d.serviceName, price: d.price }), true, true); return; }
      if (d.pin !== p.pin && /^\d{6}$/.test(d.pin || '')) show(S.react('pin', { served: d.pinServed, name: d.pinName }), true, true);
    });
  }
  }

  // Which helper? config.js helperStyle: 'pro' (the mechanic), 'sphere', or 'ab' (each visitor gets one, the same one every visit, so the two can be compared).
  var style = C.helperStyle || 'pro';
  if (style === 'ab') { try { style = localStorage.getItem('mxp_pro_variant'); if (style !== 'pro' && style !== 'sphere') { style = Math.random() < 0.5 ? 'pro' : 'sphere'; localStorage.setItem('mxp_pro_variant', style); } } catch (e) { style = 'pro'; } }
  if (style !== 'sphere') { build(null); return; }
  var done = false, fallback = setTimeout(function () { if (!done) { done = true; variant = 'pro'; build(null); } }, 4000); // never leave the visitor without a helper
  var sc = document.createElement('script'); sc.src = '/assets/js/sphere.js';
  sc.onload = function () {
    fetch('/assets/data/sphere.json').then(function (r) { return r.json(); }).then(function (def) { if (done) return; done = true; clearTimeout(fallback); variant = 'sphere'; build(def); })
      .catch(function () { if (!done) { done = true; clearTimeout(fallback); variant = 'pro'; build(null); } });
  };
  sc.onerror = function () { if (!done) { done = true; clearTimeout(fallback); variant = 'pro'; build(null); } };
  document.head.appendChild(sc);
})();
