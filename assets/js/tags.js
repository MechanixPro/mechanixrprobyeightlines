/* Ad and analytics tags. Nothing loads until an ID is set in config.js (gaId, googleAdsSendTo, metaPixelId).
   Only page views and the event name "lead" are shared: never a name, number or email. */
(function () {
  'use strict';
  var C = window.MXP || {}, doc = window.document;
  // Keep what the ad click brought, so the booking page can save it with the request.
  try {
    var p = new URLSearchParams(window.location.search), o = JSON.parse(window.sessionStorage.getItem('mxp_utm') || '{}'), any = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) { if (p.get(k)) { o[k] = p.get(k).slice(0, 100); any = true; } });
    if (any) window.sessionStorage.setItem('mxp_utm', JSON.stringify(o));
  } catch (e) {}

  function load(src) { var s = doc.createElement('script'); s.async = true; s.src = src; (doc.head || doc.getElementsByTagName('head')[0]).appendChild(s); }
  var adsId = C.googleAdsId || (C.googleAdsSendTo ? C.googleAdsSendTo.split('/')[0] : '');
  if (C.gaId || adsId) {
    load('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(C.gaId || adsId));
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (C.gaId) window.gtag('config', C.gaId);
    if (adsId) window.gtag('config', adsId);
  }
  if (C.metaPixelId) {
    window.fbq = function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
    window._fbq = window.fbq; window.fbq.loaded = true; window.fbq.version = '2.0'; window.fbq.queue = [];
    load('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', C.metaPixelId); window.fbq('track', 'PageView');
  }

  // One call for every important moment: generate_lead (a request was sent), whatsapp_click, call_click.
  window.mxpTrack = function (name, params) {
    params = params || {};
    try {
      if (window.gtag) {
        window.gtag('event', name, params);
        if (name === 'generate_lead' && C.googleAdsSendTo) window.gtag('event', 'conversion', { send_to: C.googleAdsSendTo, value: params.value || 0, currency: 'INR' });
      }
      if (window.fbq) {
        if (name === 'generate_lead') window.fbq('track', 'Lead', { value: params.value || 0, currency: 'INR' });
        else if (name === 'whatsapp_click' || name === 'call_click') window.fbq('track', 'Contact');
      }
    } catch (e) {}
  };
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    if (t.closest('[data-wa]')) window.mxpTrack('whatsapp_click', { page: window.location.pathname });
    else if (t.closest('[data-call]')) window.mxpTrack('call_click', { page: window.location.pathname });
  });
})();
