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
    { u: 'Remind me every Monday to take out the trash.', b: 'Done. Every Monday at 08:00 I will remind you: “Trash”.', w: 'Recurring reminder created' },
    { u: 'I want to run three times a week.', b: 'New goal: Running, 3× a week. I will check in on Sunday evening.', w: 'Goal created · weekly check-in' },
    { u: 'Put milk and eggs on the shopping list.', b: 'Added to the shopping list: milk, eggs.', w: 'Added to shopping list' },
    { u: 'How much did I spend this week?', b: 'This week you spent € 87.99 across 6 payments. Most of it on shopping.', w: 'Spending summary · 6 payments' }
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
