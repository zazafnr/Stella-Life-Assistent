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

(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Showcase: das Handy wechselt mit dem Abschnitt
  var items = $$('.show-item'), layers = $$('.stack .layer');
  if (items.length && 'IntersectionObserver' in window) {
    var setActive = function (i) {
      items.forEach(function (el, k) { el.classList.toggle('on', k === i); });
      layers.forEach(function (el, k) { el.classList.toggle('on', k === i); });
    };
    setActive(0);
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) setActive(+e.target.getAttribute('data-shot')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    items.forEach(function (el) { so.observe(el); });
  } else { items.forEach(function (el) { el.classList.add('on'); }); }

  // Chat-Demo (auf Englisch gezeigt)
  var body = document.getElementById('demo-body'), tags = $$('#demo-tags button');
  if (!body) return;
  var S = [
    { u: 'Remind me every Monday to take out the bins.', b: 'Done. Every Monday at 08:00 I will remind you: “Take out the bins”.', w: 'Recurring reminder created' },
    { u: 'I want to run three times a week.', b: 'New goal: running, 3× a week. I will check in on Sunday evening.', w: 'Goal created · weekly check-in' },
    { u: 'Quarterly report due Friday.', b: 'Noted. I will remind you on Thursday at 17:00 and find two hours for it in your calendar.', w: 'Deadline added · reminder set' },
    { u: 'Put milk and eggs on the shopping list.', b: 'Added to the shopping list: milk, eggs.', w: 'Added to shopping list' },
    { u: 'Find an Italian place for Friday at eight.', b: 'Three places nearby are open at 20:00, the closest is 450 m away. I put the booking links below. I cannot see free tables, so please check when you book.', w: 'Restaurant search · opening hours checked' }
  ];
  var cur = 0, token = 0, timers = [];
  var later = function (fn, ms) { var id = setTimeout(fn, ms); timers.push(id); };
  var el = function (cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; body.appendChild(d); return d; };
  var showStatic = function (i) {
    body.innerHTML = ''; el('msg user', S[i].u); el('msg bot', S[i].b + '<span class="what">✓ ' + S[i].w + '</span>');
  };
  var play = function (i) {
    token++; var my = token; timers.forEach(clearTimeout); timers = []; cur = i;
    tags.forEach(function (t, k) { t.classList.toggle('on', k === i); });
    if (reduce) return showStatic(i);
    body.innerHTML = '';
    var u = el('msg user', ''), txt = S[i].u, n = 0;
    (function type() {
      if (my !== token) return;
      u.textContent = txt.slice(0, ++n);
      if (n < txt.length) return later(type, 28 + Math.random() * 30);
      later(function () {
        if (my !== token) return;
        var b = el('msg bot', '<span class="typing"><i></i><i></i><i></i></span>');
        later(function () {
          if (my !== token) return;
          b.innerHTML = S[i].b + '<span class="what">✓ ' + S[i].w + '</span>';
          later(function () { if (my === token) play((i + 1) % S.length); }, 4200);
        }, 1000);
      }, 450);
    })();
  };
  tags.forEach(function (t) { t.addEventListener('click', function () { play(+t.getAttribute('data-i')); }); });
  var started = false;
  new IntersectionObserver(function (es) { if (es[0].isIntersecting && !started) { started = true; play(0); } }, { threshold: 0.35 }).observe(document.getElementById('demo'));
  showStatic(0);
})();

// Film: stumme Vorschau im Bild, mit Ton von vorn auf Knopfdruck, eigene Leiste. Ohne JS bleibt der normale Player.
(function () {
  var frame = document.getElementById('film-frame'), v = document.getElementById('film-video');
  if (!frame || !v) return;
  var mq = function (q) { return window.matchMedia && matchMedia(q).matches; };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var save = !!(navigator.connection && navigator.connection.saveData);
  var auto = !reduce && !save && 'IntersectionObserver' in window;
  var q = function (s) { return frame.querySelector(s); };
  var bar = q('.film-bar'), seek = q('.film-seek'), fill = q('.film-fill'), now = q('.film-now'), dur = q('.film-dur');
  var bToggle = q('[data-act="toggle"]'), bMute = q('[data-act="mute"]');
  var state, visible = false, userPaused = false, hideT = 0, raf = 0, dragging = false, lastPointer = 'mouse', uiAtDown = false;

  v.removeAttribute('controls'); v.controls = false;
  v.setAttribute('tabindex', '0');
  frame.classList.add('js');
  Array.prototype.forEach.call(frame.querySelectorAll('[hidden]'), function (el) { el.hidden = false; });

  var D = function () { return isFinite(v.duration) && v.duration > 0 ? v.duration : 29.6; };
  var fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); };
  var setState = function (s) { state = s; frame.setAttribute('data-state', s); };
  var paint = function () {
    var d = D(), t = Math.min(v.currentTime || 0, d);
    fill.style.transform = 'scaleX(' + (t / d) + ')';
    now.textContent = fmt(t); dur.textContent = fmt(d);
    seek.setAttribute('aria-valuemax', String(Math.floor(d)));
    seek.setAttribute('aria-valuenow', String(Math.floor(t)));
    seek.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
  };
  var tick = function () { paint(); raf = v.paused ? 0 : requestAnimationFrame(tick); };
  var sync = function () {
    var playing = !v.paused && !v.ended;
    frame.classList.toggle('playing', playing);
    frame.classList.toggle('sound', !v.muted);
    bToggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    bMute.setAttribute('aria-label', v.muted ? 'Turn sound on' : 'Turn sound off');
    if (playing && !raf) raf = requestAnimationFrame(tick);
    if (!playing) { paint(); show(); }
  };

  // Leiste ein- und ausblenden
  var show = function () {
    frame.classList.add('ui'); clearTimeout(hideT);
    hideT = setTimeout(function () { if (!v.paused && !dragging) frame.classList.remove('ui'); }, 2500);
  };
  var hide = function () { clearTimeout(hideT); if (!v.paused && !dragging) frame.classList.remove('ui'); };

  var play = function () {
    var p = v.play();
    if (p && p.catch) p.catch(function () {
      // z. B. Stromsparmodus auf iOS: kein Autoplay, dann Vorschaubild mit Play-Knopf
      if (state === 'preview') { setState('idle'); frame.classList.remove('ui'); }
      sync();
    });
  };
  var startWithSound = function () {
    userPaused = false; v.loop = false; v.muted = false;
    try { v.currentTime = 0; } catch (e) {}
    setState('sound'); play(); sync(); hide();
  };
  var toggle = function () {
    if (state === 'idle' || state === 'ended') return startWithSound();
    if (v.paused) { userPaused = false; play(); } else { userPaused = true; v.pause(); }
  };

  frame.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'start') { startWithSound(); bToggle.focus({ preventScroll: true }); } // der Knopf blendet aus, der Fokus bleibt in der Leiste
    else if (a === 'toggle') toggle();
    else if (a === 'mute') {
      v.muted = !v.muted;
      if (!v.muted && state === 'preview') { v.loop = false; setState('sound'); }
    }
    show();
  });
  // Zustand der Leiste beim Antippen merken: Das Tippen fokussiert das Video, und focusin blendet die Leiste schon vor dem Klick ein
  v.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || 'mouse'; uiAtDown = frame.classList.contains('ui'); });
  v.addEventListener('click', function () {
    // Auf Touch-Geräten holt das erste Tippen nur die Leiste
    if (lastPointer === 'touch' && !uiAtDown && state !== 'idle') return show();
    toggle(); show();
  });
  frame.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') show(); });
  frame.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hide(); });
  frame.addEventListener('focusin', show);
  frame.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Spacebar') && (e.target === v || e.target === seek)) { e.preventDefault(); toggle(); show(); }
  });

  // Fortschrittsbalken: klicken, ziehen, Pfeiltasten
  var seekTo = function (t) { var d = D(); try { v.currentTime = Math.max(0, Math.min(d - 0.05, t)); } catch (e) {} paint(); };
  var fromX = function (x) { var r = seek.getBoundingClientRect(); return (x - r.left) / r.width * D(); };
  seek.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    dragging = true; seek.classList.add('drag');
    try { seek.setPointerCapture(e.pointerId); } catch (er) {}
    seekTo(fromX(e.clientX)); show();
  });
  seek.addEventListener('pointermove', function (e) { if (dragging) { seekTo(fromX(e.clientX)); show(); } });
  var end = function () { if (!dragging) return; dragging = false; seek.classList.remove('drag'); if (state === 'ended') { setState('sound'); } show(); };
  seek.addEventListener('pointerup', end); seek.addEventListener('pointercancel', end);
  seek.addEventListener('keydown', function (e) {
    var k = e.key, t = v.currentTime || 0;
    if (k === 'ArrowRight' || k === 'ArrowUp') t += 5; else if (k === 'ArrowLeft' || k === 'ArrowDown') t -= 5;
    else if (k === 'Home') t = 0; else if (k === 'End') t = D(); else return;
    e.preventDefault(); if (state === 'ended') setState('sound'); seekTo(t); show();
  });

  ['play', 'pause', 'volumechange', 'loadedmetadata', 'durationchange'].forEach(function (n) { v.addEventListener(n, sync); });
  v.addEventListener('seeked', paint);
  v.addEventListener('ended', function () { if (!v.loop) { setState('ended'); sync(); } });

  // Vorschau: läuft stumm, solange der Rahmen zu mindestens 50 % sichtbar ist
  if (auto) {
    setState('preview');
    new IntersectionObserver(function (es) {
      var e = es[es.length - 1]; visible = e.isIntersecting && e.intersectionRatio >= 0.5;
      if (visible) { if (state === 'preview' && !userPaused && v.paused) play(); }
      else if (!v.paused) v.pause();
    }, { threshold: [0, 0.5] }).observe(frame);
  } else {
    setState('idle');
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) {
      if (!es[es.length - 1].isIntersecting && !v.paused) v.pause();
    }).observe(frame);
  }
  sync(); frame.classList.remove('ui');

  // Beim Hineinscrollen wächst der Rahmen von .94 auf 1 (nur transform)
  if (!reduce) {
    var pending = false;
    var grow = function () {
      pending = false;
      var r = frame.getBoundingClientRect(), vh = window.innerHeight || 800;
      if (r.bottom < 0) return; // oberhalb: bleibt, wie er ist
      var t = Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.65))); // unterhalb: .94
      t = 1 - Math.pow(1 - t, 3);
      frame.style.transform = 'scale(' + (0.94 + 0.06 * t).toFixed(4) + ')';
    };
    var req = function () { if (!pending) { pending = true; requestAnimationFrame(grow); } };
    addEventListener('scroll', req, { passive: true }); addEventListener('resize', req); req();
  }
})();
