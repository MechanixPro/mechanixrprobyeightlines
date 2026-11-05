/* Live location for the mechanic's job page. Nothing starts until the mechanic taps "Share my live location". Then:
   - the phone's position is watched (navigator.geolocation.watchPosition), but a point is sent at most every 15 seconds, and only if the mechanic moved at least 20 metres (or 60 seconds passed, so the customer is not left guessing);
   - sharing stops by itself when the server says the job is no longer On the way or Arrived (code verified, completed), when the page is closed, or when the mechanic taps Stop.
   No inline script (CSP). The server checks the link, the job and the stage again for every point. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_JOBGEO = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN_GAP_MS = 15000, MIN_MOVE_M = 20, KEEPALIVE_MS = 60000;
  function distanceM(a, b) {
    var R = 6371000, rad = function (d) { return d * Math.PI / 180; }, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* last = { lat, lng, t } of the last point sent (or null). Send the first one at once; later ones after 15 s and 20 m, or after 60 s anyway. */
  function shouldSend(last, pos, now) {
    if (!last) return true;
    var gap = now - last.t; if (gap < MIN_GAP_MS) return false;
    return distanceM(last, pos) >= MIN_MOVE_M || gap >= KEEPALIVE_MS;
  }
  /* send(pos) returns a promise of { ok, stopped }. hooks: onStart, onSent(pos, at), onStop(reason), onError(message). */
  function createSharer(win, send, hooks) {
    hooks = hooks || {}; var id = null, last = null, busy = false, bound = false;
    function stop(reason) {
      if (id != null) { try { win.navigator.geolocation.clearWatch(id); } catch (e) {} id = null; last = null; if (hooks.onStop) hooks.onStop(reason || 'stopped'); }
    }
    function onPos(p) {
      var c = p && p.coords; if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return;
      var pos = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, heading: c.heading }, now = Date.now();
      if (busy || !shouldSend(last, pos, now)) return;
      busy = true; last = { lat: pos.lat, lng: pos.lng, t: now };
      Promise.resolve(send(pos)).then(function (r) { busy = false; if (r && r.stopped) stop('stage'); else if (r && r.ok && hooks.onSent) hooks.onSent(pos, Date.now()); }, function () { busy = false; });
    }
    function start() {
      if (id != null) return true;
      if (!win.navigator || !win.navigator.geolocation) { if (hooks.onError) hooks.onError('This phone or browser cannot share its location here.'); return false; }
      if (!bound) { bound = true; win.addEventListener('pagehide', function () { stop('closed'); }); }
      id = win.navigator.geolocation.watchPosition(onPos, function (err) {
        var denied = err && err.code === 1; if (denied) stop('denied');
        if (hooks.onError) hooks.onError(denied ? 'Location is blocked for this page. Allow it in your browser settings, then try again.' : 'Could not get your location yet. Make sure location is on.');
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
      if (hooks.onStart) hooks.onStart(); return true;
    }
    return { start: start, stop: stop, active: function () { return id != null; } };
  }
  return { distanceM: distanceM, shouldSend: shouldSend, createSharer: createSharer, MIN_GAP_MS: MIN_GAP_MS, MIN_MOVE_M: MIN_MOVE_M, KEEPALIVE_MS: KEEPALIVE_MS };
});
