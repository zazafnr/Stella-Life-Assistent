(function () {
  'use strict';
  var API = 'https://stella.evolsior.com';
  var KEY = 'ev_session';
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var days = 30;

  var PURPOSE = { verification: 'Sign-up codes', address_verification: 'Address codes', stella_reply: 'Replies from Stella', unknown_sender_notice: 'Notices to unknown senders', system: 'System' };
  var PROVIDER = { groq: 'Groq', openrouter: 'OpenRouter' };
  var OUTCOME = { replied: 'Answered', unknown_sender: 'Sender had no account (notice sent)', unknown_sender_silent: 'Sender had no account (no notice)', ignored_automated: 'Automatic mail ignored', ignored_recipient: 'Other address ignored', rejected_auth: 'Rejected, failed sender check', rate_limited: 'Rate limit', error: 'Error' };

  function token() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function keep(t) { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) { /* ohne Speicher: Anmeldung gilt nur bis zum Neuladen */ } }
  var memory = '';
  function currentToken() { return token() || memory; }

  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function svg(name, attrs, text) { var e = document.createElementNS(NS, name); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };

  function view(v) {
    document.body.setAttribute('data-view', v);
    $('view-login').classList.toggle('hide', v !== 'login');
    document.title = v === 'login' ? 'Sign in | EVOLSIOR' : 'Overview | EVOLSIOR';
  }

  function signOut(message) {
    var t = currentToken();
    if (t) fetch(API + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t } }).catch(function () {});
    keep(''); memory = '';
    $('pw').value = '';
    $('err').textContent = message || '';
    view('login');
  }

  // Anmeldung. Jedes Konto, das nicht der Owner ist, bekommt dieselbe Meldung wie bei falschem Passwort.
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('login-btn'), err = $('err');
    var email = $('email').value.trim(), pw = $('pw').value;
    if (!email || !pw) { err.textContent = 'Email or password is incorrect.'; return; }
    err.textContent = ''; btn.disabled = true;
    fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, password: pw, device: 'Web' }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        if (r.status === 429) { err.textContent = 'Too many attempts. Please try again in a few minutes.'; return; }
        if (r.status !== 200 || !r.body.token) { err.textContent = 'Email or password is incorrect.'; return; }
        if (!r.body.user || r.body.user.role !== 'owner') {
          fetch(API + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + r.body.token } }).catch(function () {});
          err.textContent = 'Email or password is incorrect.';
          return;
        }
        memory = r.body.token; keep(r.body.token);
        $('who-name').textContent = r.body.user.name || '';
        $('pw').value = '';
        view('dash');
        load();
      })
      .catch(function () { err.textContent = 'We could not reach the server. Please try again.'; })
      .then(function () { btn.disabled = false; });
  });

  $('signout').addEventListener('click', function () { signOut(''); });

  var ranges = document.querySelectorAll('.range button');
  ranges.forEach(function (b) {
    b.addEventListener('click', function () {
      days = Number(b.getAttribute('data-d'));
      ranges.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
  });

  function load() {
    var t = currentToken();
    if (!t) { view('login'); return; }
    $('load-err').textContent = '';
    document.body.classList.add('busy');
    fetch(API + '/api/admin/overview?days=' + days, { headers: { authorization: 'Bearer ' + t } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { signOut('Your session has ended. Please sign in again.'); return null; }
        if (!r.ok) throw new Error('bad');
        return r.json();
      })
      .then(function (o) { if (o) render(o); })
      .catch(function () { $('load-err').textContent = 'The numbers could not be loaded. Please try again in a moment.'; })
      .then(function () { document.body.classList.remove('busy'); });
  }

  // ---------- Darstellung ----------

  function tile(label, num, delta) {
    var t = el('div', null, 'tile');
    t.appendChild(el('span', label, 'label'));
    t.appendChild(el('span', num, 'num'));
    var d = el('span', null, 'delta');
    delta.forEach(function (p) { d.appendChild(typeof p === 'string' ? document.createTextNode(p) : el('b', p.text, p.bad ? 'bad' : '')); });
    t.appendChild(d);
    return t;
  }

  function dot(off) { return el('i', null, off ? 'dot off' : 'dot'); }
  function statusItem(ok, text) { var s = el('span'); s.appendChild(dot(!ok)); s.appendChild(document.createTextNode(text)); return s; }

  function render(o) {
    var rangeText = 'Last ' + o.days + ' days';
    $('range-hint').textContent = rangeText; $('range-hint-2').textContent = rangeText;
    $('app-state').textContent = 'Stella · ' + (o.setup.mailConfigured ? 'Live' : 'Setup incomplete');

    var st = $('status'); clear(st);
    st.appendChild(statusItem(true, 'Server reachable'));
    st.appendChild(statusItem(o.setup.mailConfigured, o.setup.mailConfigured ? 'Email sending configured' : 'Email sending not configured'));
    st.appendChild(statusItem(o.setup.inboundConfigured, o.setup.inboundConfigured ? 'Mail to Stella connected' : 'Mail to Stella not connected'));
    var mode = o.setup.registration;
    st.appendChild(statusItem(mode !== 'open', mode === 'invite' ? 'Sign-up by invitation · ' + o.invites.open + ' open invites' : mode === 'closed' ? 'Sign-up closed' : 'Sign-up open to everyone'));

    var sent = o.mail.sent, total = sent.ok + sent.failed, replied = o.mail.inboundByOutcome.replied || 0;
    var tiles = $('tiles'); clear(tiles);
    tiles.appendChild(tile('Accounts', fmt(o.users.total), [{ text: '+' + o.users.new7d }, ' in the last 7 days']));
    tiles.appendChild(tile('Active, 7 days', fmt(o.users.active7d), [o.users.total ? Math.round(o.users.active7d / o.users.total * 100) + ' % of all accounts' : '–']));
    tiles.appendChild(tile('Emails sent', fmt(sent.ok), sent.failed ? [{ text: sent.failed + ' failed', bad: true }, ' · ' + (Math.round(sent.ok / total * 1000) / 10) + ' % delivered'] : [total ? 'All delivered' : 'None yet']));
    tiles.appendChild(tile('Emails to Stella', fmt(o.mail.received), [{ text: String(replied) }, ' answered']));

    drawMail(o.mail.perDay);
    drawReg(o.registrations);

    var host = $('purposes'); clear(host);
    var keys = Object.keys(o.mail.byPurpose), top = 0;
    keys.forEach(function (k) { top = Math.max(top, o.mail.byPurpose[k].ok + o.mail.byPurpose[k].failed); });
    if (!keys.length) host.appendChild(el('p', 'No emails yet.', 'empty'));
    keys.sort(function (a, b) { return (o.mail.byPurpose[b].ok + o.mail.byPurpose[b].failed) - (o.mail.byPurpose[a].ok + o.mail.byPurpose[a].failed); }).forEach(function (k) {
      host.appendChild(barRow(PURPOSE[k] || k, o.mail.byPurpose[k].ok + o.mail.byPurpose[k].failed, top, o.mail.byPurpose[k].failed ? o.mail.byPurpose[k].failed + ' failed' : ''));
    });

    var out = $('outcomes'); clear(out);
    var oks = Object.keys(o.mail.inboundByOutcome).sort(function (a, b) { return o.mail.inboundByOutcome[b] - o.mail.inboundByOutcome[a]; });
    if (!oks.length) { var r0 = el('tr'), c0 = el('td', 'No emails to Stella yet.'); c0.colSpan = 2; r0.appendChild(c0); out.appendChild(r0); }
    oks.forEach(function (k) { var r = el('tr'); r.appendChild(el('td', OUTCOME[k] || k)); r.appendChild(el('td', fmt(o.mail.inboundByOutcome[k]), 'n')); out.appendChild(r); });

    var ai = $('ai'); clear(ai);
    var providers = Object.keys(o.ai.byProvider), aimax = 0;
    providers.forEach(function (p) { aimax = Math.max(aimax, o.ai.byProvider[p]); });
    if (!providers.length) ai.appendChild(el('p', 'No requests yet.', 'empty'));
    providers.sort(function (a, b) { return o.ai.byProvider[b] - o.ai.byProvider[a]; }).forEach(function (p) {
      ai.appendChild(barRow(PROVIDER[p] || p, o.ai.byProvider[p], aimax, ''));
    });

    var fl = $('failures'); clear(fl);
    if (!o.mail.recentFailures.length) { var r1 = el('tr'), c1 = el('td', 'Nothing went wrong recently.'); c1.colSpan = 3; r1.appendChild(c1); fl.appendChild(r1); }
    o.mail.recentFailures.forEach(function (f) {
      var r = el('tr');
      r.appendChild(el('td', new Date(f.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), 'mono'));
      var c = el('td'); c.appendChild(el('span', (f.direction === 'in' ? 'Receiving: ' : '') + (PURPOSE[f.purpose] || OUTCOME[f.purpose] || f.purpose), 'pill bad')); r.appendChild(c);
      r.appendChild(el('td', f.domain || '–', 'n'));
      fl.appendChild(r);
    });
  }

  function barRow(label, value, max, note) {
    var li = el('div', null, 'li'), top = el('div');
    top.appendChild(el('span', label));
    var v = el('span', fmt(value), 'mono');
    if (note) v.appendChild(el('span', ' · ' + note, 'bad-text'));
    top.appendChild(v);
    li.appendChild(top);
    var bar = el('div', null, 'bar'), fill = el('i');
    fill.style.width = (max ? Math.max(2, Math.round(value / max * 100)) : 0) + '%';
    bar.appendChild(fill); li.appendChild(bar);
    return li;
  }

  function niceMax(v) { var steps = [4, 8, 20, 40, 80, 120, 200, 400, 800, 1200, 2000, 4000, 8000]; for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i]; return Math.ceil(v / 1000) * 1000; }
  function dayLabel(iso) { return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function ticks(c, series, L, W, H, n) {
    var idx = n > 2 ? [0, Math.round((n - 1) / 3), Math.round((n - 1) * 2 / 3), n - 1] : [0, n - 1];
    var iw = (W - L) / n;
    idx.forEach(function (i, k) { c.appendChild(svg('text', { x: L + i * iw + (k === idx.length - 1 ? -iw : 0), y: H - 6 }, dayLabel(series[i].day))); });
  }

  function grid(c, L, W, T, bottom, max, steps) {
    for (var s = 0; s <= steps; s++) {
      var v = max * s / steps, y = T + (bottom - T) * (1 - v / max);
      c.appendChild(svg('line', { x1: L, x2: W, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 1 }));
      c.appendChild(svg('text', { x: 0, y: y + 3 }, String(Math.round(v))));
    }
  }

  function drawMail(series) {
    var c = $('mailchart'); clear(c);
    var W = 640, H = 220, L = 30, B = 22, T = 8, n = series.length, peak = 0;
    series.forEach(function (d) { peak = Math.max(peak, d.ok + d.failed, d.received); });
    var max = niceMax(Math.max(peak, 4));
    grid(c, L, W, T, H - B, max, 4);
    var iw = (W - L) / n, bw = iw * 0.76 / 2;
    series.forEach(function (d, i) {
      var x = L + i * iw + iw * 0.12;
      var hs = (H - B - T) * d.ok / max, hr = (H - B - T) * d.received / max, hf = (H - B - T) * d.failed / max;
      if (d.ok) c.appendChild(svg('rect', { x: x, y: H - B - hs, width: Math.max(1, bw - 1), height: hs, fill: 'var(--c1)', rx: 1.5 }));
      if (d.received) c.appendChild(svg('rect', { x: x + bw, y: H - B - hr, width: Math.max(1, bw - 1), height: hr, fill: 'var(--c2)', rx: 1.5 }));
      if (d.failed) c.appendChild(svg('rect', { x: x, y: H - B - hs - hf - 2, width: Math.max(1, bw - 1), height: hf, fill: 'var(--bad)', rx: 1.5 }));
    });
    ticks(c, series, L, W, H, n);
  }

  function drawReg(series) {
    var c = $('regchart'); clear(c);
    var W = 640, H = 160, L = 30, B = 22, T = 8, n = series.length, peak = 0;
    series.forEach(function (d) { peak = Math.max(peak, d.n); });
    var max = niceMax(Math.max(peak, 4));
    grid(c, L, W, T, H - B, max, 2);
    var step = (W - L) / Math.max(1, n - 1);
    var pts = series.map(function (d, i) { return [L + i * step, T + (H - B - T) * (1 - d.n / max)]; });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    c.appendChild(svg('path', { d: path + ' L' + W + ' ' + (H - B) + ' L' + L + ' ' + (H - B) + ' Z', fill: 'var(--c1)', opacity: '0.07' }));
    c.appendChild(svg('path', { d: path, fill: 'none', stroke: 'var(--c1)', 'stroke-width': '1.75', 'stroke-linejoin': 'round' }));
    var last = pts[pts.length - 1]; c.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 4, fill: 'var(--c1)' }));
    ticks(c, series, L, W - step, H, n);
  }

  // Beim Neuladen: gespeicherte Sitzung weiterverwenden, sonst Anmeldung
  if (token()) { view('dash'); load(); } else { view('login'); }
})();
