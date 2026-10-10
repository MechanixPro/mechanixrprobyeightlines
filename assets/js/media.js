/* Records the first play of a page video through the shared tags. Shares only that a video was played and which page it was on. */
(function () {
  'use strict';
  [].forEach.call(document.querySelectorAll('video'), function (v) {
    var sent = false;
    v.addEventListener('play', function () { if (sent) return; sent = true; try { if (window.mxpTrack) window.mxpTrack('video_play', { page: location.pathname }); } catch (e) {} });
  });
})();
