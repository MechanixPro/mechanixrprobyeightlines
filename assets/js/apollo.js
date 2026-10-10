/* Apollo website tracker. Runs only on the Fleets and Apartments pages, and only when an ID is set in config.js (apolloAppId).
   It helps the sales team see which businesses look at those pages. Disclosed in the privacy policy. Booking pages never load it. */
(function () {
  'use strict';
  var C = window.MXP || {}, id = String(C.apolloAppId || '');
  var p = (window.location && window.location.pathname) || '';
  if (!/^[0-9a-f]{24}$/.test(id)) return;
  if (p.indexOf('/fleet') !== 0 && p.indexOf('/societies') !== 0) return;
  var s = document.createElement('script');
  s.src = 'https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache=' + Math.random().toString(36).substring(7);
  s.async = true; s.defer = true;
  s.onload = function () { if (window.trackingFunctions && window.trackingFunctions.onLoad) window.trackingFunctions.onLoad({ appId: id }); };
  document.head.appendChild(s);
})();
