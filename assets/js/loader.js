/* Shows the logo loader only on the first page of a visit. Runs in <head> before first paint. */
(function () {
  try { if (sessionStorage.getItem('mxp_seen')) document.documentElement.className += ' seen'; else sessionStorage.setItem('mxp_seen', '1'); } catch (e) { document.documentElement.className += ' seen'; }
})();
