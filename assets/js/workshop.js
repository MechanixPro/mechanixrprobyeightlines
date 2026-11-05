// Workshop gallery lightbox. Without JavaScript each photo link opens the large image on its own.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('a[data-lb]'));
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;
  var dlg, img, cap, i = 0;
  function show(n) {
    i = (n + links.length) % links.length;
    var a = links[i], im = a.querySelector('img'), fc = a.parentNode.querySelector('figcaption');
    img.src = a.getAttribute('href');
    img.alt = im ? im.alt : '';
    cap.textContent = fc ? fc.textContent : '';
  }
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'ws-dlg';
    dlg.setAttribute('aria-label', 'Workshop photo');
    dlg.innerHTML = '<div class="ws-dlg-in"><button type="button" class="ws-dlg-x" aria-label="Close photo">Close</button><p></p><div class="ws-dlg-nav"><button type="button" data-d="-1" aria-label="Previous photo">Previous</button><button type="button" data-d="1" aria-label="Next photo">Next</button></div></div>';
    document.body.appendChild(dlg);
    img = document.createElement('img');
    dlg.querySelector('.ws-dlg-in').insertBefore(img, dlg.querySelector('p'));
    cap = dlg.querySelector('p');
    if (links.length < 2) dlg.querySelector('.ws-dlg-nav').hidden = true;
    dlg.addEventListener('click', function (e) {
      var d = e.target.getAttribute && e.target.getAttribute('data-d');
      if (d) show(i + parseInt(d, 10));
      else if (e.target === dlg || e.target.classList.contains('ws-dlg-x') || e.target.classList.contains('ws-dlg-in')) dlg.close();
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(i - 1);
      else if (e.key === 'ArrowRight') show(i + 1);
    });
  }
  links.forEach(function (a, n) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!dlg) build();
      show(n);
      dlg.showModal();
    });
  });
})();
