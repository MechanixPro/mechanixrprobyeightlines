// Width switch for the private gallery: resizes the iframe so ds.css media queries run at 390 or 1280.
const f = document.getElementById('f');
const setW = (w) => { f.setAttribute('width', w); f.style.width = w + 'px'; for (const o of document.querySelectorAll('[data-w]')) { const on = o.dataset.w === String(w); o.setAttribute('aria-pressed', String(on)); o.classList.toggle('primary', on); } };
for (const b of document.querySelectorAll('[data-w]')) b.addEventListener('click', () => setW(b.dataset.w));
if (/^#(390|1280)$/.test(location.hash)) setW(location.hash.slice(1));   // /ds-gallery/#390 opens the phone width
