(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Kopfzeile: Hintergrund erst nach dem Scrollen
  var nav = $('.nav');
  var onScroll = function () { if (nav) nav.classList.toggle('scrolled', window.scrollY > 24); };
  onScroll(); addEventListener('scroll', onScroll, { passive: true });

  // Einblenden: nur, was beim Laden unterhalb des Bildschirms liegt, wird versteckt
  var vh = window.innerHeight;
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  $$('[data-reveal]').forEach(function (el) {
    if (!io || reduce || el.getBoundingClientRect().top < vh * 0.92) return;
    el.classList.add('pre'); io.observe(el);
  });

  // Lichtkegel unter dem Cursor
  $$('.spot').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  // Text füllt sich beim Scrollen Wort für Wort
  $$('.fill').forEach(function (p) {
    var words = p.textContent.trim().split(/\s+/);
    p.setAttribute('aria-label', p.textContent.trim());
    p.innerHTML = words.map(function (w) { return '<span class="w" aria-hidden="true">' + w + '</span>'; }).join(' ');
    var spans = $$('.w', p);
    var update = function () {
      var r = p.getBoundingClientRect();
      var t = (window.innerHeight * 0.85 - r.top) / (r.height + window.innerHeight * 0.35);
      t = Math.max(0, Math.min(1, t));
      if (reduce) t = 1;
      var n = Math.round(t * spans.length);
      spans.forEach(function (s, i) { s.classList.toggle('on', i < n); });
    };
    update(); addEventListener('scroll', update, { passive: true }); addEventListener('resize', update);
  });

  // Handy neigt sich zum Cursor
  $$('.tilt').forEach(function (el) {
    if (reduce || !matchMedia('(hover: hover)').matches) return;
    var host = el.closest('[data-tilt-host]') || el;
    host.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = 'perspective(1400px) rotateY(' + (x * 14) + 'deg) rotateX(' + (-y * 10) + 'deg)';
    });
    host.addEventListener('pointerleave', function () { el.style.transform = ''; });
  });

  // Hero: feine Linien folgen einem Strömungsfeld, der Cursor lenkt sie ab
  var cv = $('.hero canvas');
  if (cv && cv.getContext) {
    var ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, P = [], t = 0, mx = -999, my = -999, run = true;
    var N = matchMedia('(max-width: 700px)').matches ? 380 : 800;
    var rand = (function (s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })(7);
    var size = function () {
      var r = cv.parentElement.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#09090B'; ctx.fillRect(0, 0, W, H);
      P = []; for (var i = 0; i < N; i++) P.push({ x: rand() * W, y: rand() * H, px: 0, py: 0, life: rand() * 200 });
    };
    var field = function (x, y) {
      return Math.sin(x * 0.0021 + t * 0.35) * Math.cos(y * 0.0026 - t * 0.28) * 3.4 + Math.sin((x + y) * 0.0011 + t * 0.2) * 1.6;
    };
    var step = function () {
      ctx.fillStyle = 'rgba(9,9,11,0.07)'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 0.7;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], a = field(p.x, p.y);
        var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < 22000) { var k = (1 - d2 / 22000) * 2.2; a += Math.atan2(dy, dx) * 0.0 + k; }
        p.px = p.x; p.py = p.y;
        p.x += Math.cos(a) * 1.5; p.y += Math.sin(a) * 1.5; p.life++;
        var edge = p.x < 0 || p.x > W || p.y < 0 || p.y > H;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.14 + 0.26 * Math.abs(Math.sin(p.life * 0.02))) + ')';
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (edge || p.life > 420) { p.x = rand() * W; p.y = rand() * H; p.px = p.x; p.py = p.y; p.life = 0; }
      }
      t += 0.012;
    };
    size();
    for (var s = 0; s < (reduce ? 260 : 170); s++) step();
    if (!reduce) {
      var loop = function () { if (run) step(); requestAnimationFrame(loop); };
      new IntersectionObserver(function (es) { run = es[0].isIntersecting; }).observe(cv);
      cv.parentElement.addEventListener('pointermove', function (e) { var r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
      cv.parentElement.addEventListener('pointerleave', function () { mx = my = -999; });
      requestAnimationFrame(loop);
    }
    var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 200); });
  }
})();
