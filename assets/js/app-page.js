/* /app/: shows the add-to-home-screen control (install.js does the work). No inline script (CSP). */
(function () {
  'use strict';
  function go() { var slot = document.getElementById('appInstall'); if (slot && window.MXP_INSTALL) window.MXP_INSTALL.mount(slot, window); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
