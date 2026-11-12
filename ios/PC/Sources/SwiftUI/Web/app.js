// Stella am PC – Fensterseite.
// Die Swift-App schickt nach jeder Änderung ihren View-Baum (Server-Sent Events). Hier wird daraus
// DOM gebaut, mit dem bisherigen abgeglichen (Fokus, Eingaben, Scrollen bleiben) und jede Eingabe
// geht per POST zurück an die App.
"use strict";

const TOKEN = window.STELLA_TOKEN;
const app = document.getElementById("app");
const overlay = document.getElementById("overlay");
const screenEl = document.getElementById("screen");

// ---------- Verbindung ----------

let queue = [];
let flushing = false;
function post(msg) {
  queue.push(msg);
  if (!flushing) {
    flushing = true;
    queueMicrotask(() => {
      const list = queue;
      queue = [];
      flushing = false;
      fetch("/ev", { method: "POST", headers: { "X-Stella": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(list) }).catch(() => {});
    });
  }
}
const ev = (id, v) => { if (id != null) post({ k: "ev", id, v }); };

let es;
function connect() {
  es = new EventSource("/events?t=" + TOKEN);
  es.onmessage = (e) => { document.body.classList.remove("lost"); onFrame(JSON.parse(e.data)); };
  es.onopen = () => { document.body.classList.remove("lost"); sendScreen(); post({ k: "phase", v: document.hidden ? "background" : "active" }); };
  es.onerror = () => { document.body.classList.add("lost"); };
}

function layoutMode() {
  const full = window.innerWidth < 560 || window.innerHeight < 880;
  document.body.classList.toggle("full", full);
}
function sendScreen() {
  const r = screenEl.getBoundingClientRect();
  post({ k: "screen", w: Math.round(r.width), h: Math.round(r.height) });
}
window.addEventListener("resize", () => { layoutMode(); sendScreen(); });
document.addEventListener("visibilitychange", () => post({ k: "phase", v: document.hidden ? "background" : "active" }));
layoutMode();

// Uhr in der Statusleiste
function tickClock() {
  const d = new Date();
  document.getElementById("clock").textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
}
tickClock();
setInterval(tickClock, 10000);

// ---------- Bild empfangen ----------

let frameAnim = null;
let lastTree = null;

function onFrame(f) {
  frameAnim = f.anim || null;
  if (f.msgs) for (const m of f.msgs) onMessage(m);
  lastTree = f.tree;
  render(f.tree);
}

function render(tree) {
  const kids = tree.c || [];
  const portals = kids.filter((n) => n.t === "sheet" || n.t === "alert" || n.t === "dialog");
  const main = kids.filter((n) => !(n.t === "sheet" || n.t === "alert" || n.t === "dialog"));
  const root = { t: "root", c: [{ t: "page", c: main }] };
  morphInto(app, [build(root)]);
  morphInto(overlay, portals.map(buildPortal));
  afterRender();
}

// ---------- Bauen ----------

const SVGNS = "http://www.w3.org/2000/svg";

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function flags(e, n) {
  if (n.g & 1) e.classList.add("gw");
  if (n.g & 2) e.classList.add("gh");
}

function anim(n) {
  return (n.p && n.p.an) || frameAnim;
}

function transitionFor(a) {
  if (!a) return "";
  const d = a.d || 0.35;
  return `transition: all ${d}s ${a.e || "ease"} ${a.dl || 0}s;`;
}

function applyStyle(e, n, style) {
  const s = style || "";
  e.dataset.s = s;
  const a = n.p && n.p.an;
  if (a && a.rp) {
    e.dataset.rep = JSON.stringify(a);
    e.style.cssText = s;
  } else {
    const t = anim(n);
    e.style.cssText = s + (t ? transitionFor(t) : "");
    if (t) e.dataset.tr = "1";
  }
}

function common(e, n) {
  flags(e, n);
  const p = n.p || {};
  if (p.isa) {
    if (p.isa & 1) e.classList.add("isa-t");
    if (p.isa & 4) e.classList.add("isa-b");
  }
  if (p.bsa && n.s && n.s.includes("background")) e.classList.add("bsa");
  if (p.tap != null && n.t !== "btn") e.dataset.tap = p.tap;
  if (p.dbl != null) e.dataset.dbl = p.dbl;
  if (p.lp != null && typeof p.lp === "number") e.dataset.lp = p.lp;
  if (p.lp === true) e.classList.add("lp");
  if (p.drag != null) { e.dataset.drag = p.drag; e.dataset.dmin = p.dmin || 10; }
  if (p.m != null) e.dataset.m = p.m;
  if (p.sid != null) e.dataset.sid = p.sid;
  if (p.al) e.setAttribute("aria-label", p.al);
  if (p.tid) e.dataset.testid = p.tid;
  if (p.dis) e.classList.add("dis-wrap");
  if (p.tr) e.dataset.transition = p.tr;
  if (p.fc != null) { e.dataset.fc = p.fc; if (p.fo) e.dataset.fo = "1"; }
  if (p.nolabel) e.classList.add("nolabel");
  if (p.an) e.dataset.an = JSON.stringify(p.an);
  else if (frameAnim) e.dataset.an = JSON.stringify(frameAnim);
  if (n.s && n.s.includes("white-space:nowrap")) e.classList.add("nowrap");
  if (n.s && n.s.includes("flex-shrink:0")) e.classList.add("fixed");
}

function kids(e, list) {
  if (list) for (const c of list) e.appendChild(build(c));
  return e;
}

function build(n) {
  const f = B[n.t] || B.unknown;
  const e = f(n);
  e.classList.add("n");
  e.dataset.t = n.t;
  common(e, n);
  return e;
}

/** Bekommt ein Inhalt den sicheren Bereich selbst (Scrollen, Liste, Navigation)? */
function consumes(n) {
  if (!n) return false;
  switch (n.t) {
    case "scroll": return !(n.p && n.p.ax === "h");
    case "list": case "nav": case "tabs": return true;
    case "z": case "css": case "root": case "page": return (n.c || []).some(consumes);
    case "bg": case "ov": case "inset": return consumes((n.c || [])[0]);
    default: return false;
  }
}

function page(list) {
  const e = el("div", "page n");
  e.dataset.t = "page";
  if (!list.some(consumes)) e.classList.add("padded");
  return kids(e, list);
}

const B = {
  root(n) { return kids(el("div", "root"), n.c); },
  page(n) { const e = page(n.c || []); e.classList.remove("n"); return e; },
  z(n) { const e = kids(el("div", "z"), n.c); if (n.s) applyStyle(e, n, n.s); return e; },
  v(n) { const e = kids(el("div", "v"), n.c); applyStyle(e, n, n.s); return e; },
  h(n) {
    const e = kids(el("div", "h"), n.c);
    // kurze Beschriftungen (Kapseln, Knöpfe) werden in SwiftUI nicht gestaucht
    (n.c || []).forEach((c, i) => { if (!(c.g & 1) && isShort(c)) e.children[i].classList.add("short"); });
    applyStyle(e, n, n.s);
    return e;
  },
  css(n) {
    const e = kids(el("div", "css"), n.c);
    applyStyle(e, n, n.s);
    return e;
  },
  sp() { return el("div", "sp"); },
  divider(n) { return el("div", "divider" + (n.p && n.p.vert ? " vert" : "")); },
  fill(n) { const e = el("div", "fill"); applyStyle(e, n, n.s); return e; },
  text(n) {
    const e = el("div", "text");
    const p = n.p || {};
    if (p.r) {
      for (const r of p.r) {
        const s = el("span");
        if (r.c) s.style.cssText = r.c;
        if (r.md) s.innerHTML = md(r.s); else s.textContent = r.s;
        e.appendChild(s);
      }
    } else if (p.md) {
      e.innerHTML = md(p.s || "");
    } else {
      e.textContent = p.s || "";
    }
    applyStyle(e, n, n.s);
    return e;
  },
  sym(n) {
    const e = el("span", "sym");
    if (n.p.rs) e.classList.add("rs");
    e.innerHTML = symbol(n.p.n);
    e.dataset.sym = n.p.n;
    return e;
  },
  img(n) {
    const e = el("img", "img");
    if (n.p.rs) e.classList.add("rs");
    if (n.p.res) e.src = "/res/" + n.p.res;
    else e.alt = "";
    e.draggable = false;
    return e;
  },
  shape(n) {
    const e = el("div", "shape" + (n.p && n.p.circle ? " circle" : ""));
    applyStyle(e, n, n.s);
    return e;
  },
  path(n) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "path");
    const p = n.p;
    if (p.d != null && p.w) {
      svg.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`);
      svg.setAttribute("preserveAspectRatio", "none");
      const defs = document.createElementNS(SVGNS, "defs");
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", p.d);
      const fill = paint(p.fill, defs, "f", p.w, p.h);
      path.setAttribute("fill", p.fill ? fill : "none");
      if (p.stroke) {
        path.setAttribute("stroke", paint(p.stroke, defs, "s", p.w, p.h));
        path.setAttribute("stroke-width", p.lw || 1);
        if (p.cap) path.setAttribute("stroke-linecap", p.cap);
        if (p.join) path.setAttribute("stroke-linejoin", p.join);
        if (p.dash) path.setAttribute("stroke-dasharray", p.dash.join(" "));
      }
      if (p.trim) {
        path.setAttribute("pathLength", "1");
        const len = Math.max(0, p.trim[1] - p.trim[0]);
        const a = anim(n);
        path.setAttribute("style", `stroke-dasharray:${len} 2;stroke-dashoffset:${-p.trim[0]};` + (a ? `transition:stroke-dasharray ${a.d}s ${a.e} ${a.dl || 0}s;` : ""));
      }
      if (defs.childNodes.length) svg.appendChild(defs);
      svg.appendChild(path);
    }
    return svg;
  },
  canvas(n) {
    const c = el("canvas", "canvas");
    c._cmd = n.p.cmd;
    c._w = n.p.w; c._h = n.p.h;
    return c;
  },
  geo(n) { return kids(el("div", "geo"), n.c); },
  grid(n) { const e = kids(el("div", "grid"), n.c); applyStyle(e, n, n.s); return e; },
  flow(n) { const e = kids(el("div", "flow"), n.c); applyStyle(e, n, n.s); return e; },
  fits(n) { return kids(el("div", "fits"), n.c); },
  bg(n) { return deco(n, true); },
  ov(n) { return deco(n, false); },
  deco(n) { const e = kids(el("div", "deco"), n.c); applyStyle(e, n, n.s); return e; },
  inset(n) {
    const e = el("div", "inset" + (n.p.top ? " top" : ""));
    return kids(e, n.c);
  },
  scroll(n) {
    const p = n.p;
    const e = el("div", "scroll ax-" + p.ax);
    const pad = el("div", "pad");
    const inner = build(n.c[0]);
    inner.classList.add("inner");
    pad.appendChild(inner);
    e.appendChild(pad);
    if (p.refresh != null) { e.dataset.refresh = p.refresh; e.appendChild(ptr()); }
    if (p.anchor === "bottom") e.dataset.anchor = "bottom";
    e.dataset.k = p.k;
    return e;
  },
  btn(n) {
    const p = n.p;
    const e = kids(el("div", "btn k-" + (p.kind || "auto")), n.c);
    e.dataset.tap = p.tap;
    e.setAttribute("role", "button");
    e.tabIndex = 0;
    e.classList.add("focus-ring");
    if (p.role) e.classList.add("role-" + p.role);
    if (p.dis) e.classList.add("dis");
    if (p.row) e.classList.add("inrow");
    return e;
  },
  toggle(n) {
    const p = n.p;
    const e = el("div", "toggle" + (p.on ? " on" : "") + (p.dis ? " dis" : ""));
    kids(e, n.c);
    e.appendChild(el("div", "toggle-sw"));
    e.dataset.toggle = p.h;
    e.dataset.on = p.on ? "1" : "0";
    e.setAttribute("role", "switch");
    return e;
  },
  field(n) {
    const p = n.p;
    const multi = p.multi;
    const e = el(multi ? "textarea" : "input", "field" + (p.editor ? " editor" : "") + (p.fs === "rounded" ? " fs-rounded" : ""));
    if (!multi) {
      e.type = p.sec ? "password" : p.kb === "email" ? "email" : p.kb === "url" ? "url" : "text";
      if (p.kb === "numeric" || p.kb === "decimal") e.inputMode = p.kb;
    } else e.rows = 1;
    e.placeholder = p.ph || "";
    e.dataset.input = p.h;
    if (p.sub != null) e.dataset.sub = p.sub;
    if (p.ct) e.autocomplete = p.ct;
    e.spellcheck = !p.sec;
    if (p.dis) e.disabled = true;
    e._val = p.v || "";
    e.value = p.v || "";
    return e;
  },
  picker(n) {
    const p = n.p;
    const [label, ...opts] = n.c || [];
    const style = p.style;
    if (style === "segmented") {
      const e = el("div", "picker seg");
      opts.forEach((o, i) => {
        const s = el("div", "seg-i" + (i === p.sel ? " on" : ""));
        s.dataset.pick = p.h; s.dataset.i = i;
        kids(s, o.c);
        e.appendChild(s);
      });
      return e;
    }
    if (style === "inline") {
      const e = el("div", "picker inl");
      opts.forEach((o, i) => {
        const s = el("div", "opt" + (i === p.sel ? " on" : ""));
        s.dataset.pick = p.h; s.dataset.i = i;
        kids(s, o.c);
        e.appendChild(s);
      });
      return e;
    }
    const e = el("div", "picker" + (p.row ? " inrow" : "") + (p.dis ? " dis" : ""));
    if (p.row) { const l = build(label); l.classList.add("plabel"); e.appendChild(l); }
    const val = el("div", "pval");
    const cur = opts[p.sel];
    if (cur) kids(val, cur.c);
    e.appendChild(val);
    const sel = el("select");
    sel.dataset.pick = p.h;
    opts.forEach((o, i) => {
      const op = el("option");
      op.value = i;
      op.textContent = textOf(o) || "—";
      if (i === p.sel) op.selected = true;
      sel.appendChild(op);
    });
    if (p.sel < 0) { const op = el("option"); op.value = -1; op.textContent = ""; op.selected = true; op.hidden = true; sel.appendChild(op); }
    e.appendChild(sel);
    return e;
  },
  date(n) {
    const p = n.p;
    const e = el("div", "date");
    kids(e, n.c);
    if (p.d != null) { const i = el("input"); i.type = "date"; i.value = p.d; i.dataset.date = p.h; i.dataset.part = "d"; i._val = p.d; e.appendChild(i); }
    if (p.t != null) { const i = el("input"); i.type = "time"; i.value = p.t; i.dataset.date = p.h; i.dataset.part = "t"; i._val = p.t; e.appendChild(i); }
    return e;
  },
  stepper(n) {
    const p = n.p;
    const e = el("div", "stepper");
    kids(e, n.c);
    const ctl = el("div", "ctl");
    const m = el("span", p.dec == null ? "off" : ""); m.textContent = "−"; if (p.dec != null) m.dataset.tap = p.dec;
    const pl = el("span", p.inc == null ? "off" : ""); pl.textContent = "+"; if (p.inc != null) pl.dataset.tap = p.inc;
    ctl.append(m, pl);
    e.appendChild(ctl);
    return e;
  },
  slider(n) {
    const p = n.p;
    const e = el("input", "slider");
    e.type = "range"; e.min = p.lo; e.max = p.hi; e.step = p.step || "any"; e.value = p.v;
    e.dataset.slide = p.h;
    e._val = String(p.v);
    return e;
  },
  progress(n) {
    const e = el("div", "progress");
    const i = el("i"); i.style.width = (n.p.v * 100) + "%";
    e.appendChild(i);
    return e;
  },
  spinner(n) { const e = el("div", "spinner" + (n.c && n.c.length ? " labeled" : "")); return kids(e, n.c); },
  menu(n) {
    const e = el("div", "menu" + (n.p && n.p.plain ? " plain" : ""));
    const l = build(n.c[0]); l.classList.add("mlabel");
    const items = build(n.c[1]); items.classList.add("mitems");
    e.append(l, items);
    e.dataset.menu = "1";
    return e;
  },
  ctx(n) {
    const e = el("div", "css ctxmenu");
    e.appendChild(build(n.c[0]));
    const items = build(n.c[1]); items.classList.add("citems");
    e.appendChild(items);
    e.dataset.ctx = "1";
    return e;
  },
  list(n) {
    const p = n.p;
    const e = el("div", "list s-" + p.style + (p.nobg ? " nobg" : ""));
    const pad = el("div", "pad");
    const inner = el("div", "inner");
    for (const s of n.c || []) {
      const sec = el("div", "section");
      const rows = el("div", "rows");
      for (const r of s.c || []) {
        if (r.t === "sechead" || r.t === "secfoot") sec.appendChild(build(r));
        else rows.appendChild(buildRow(r));
      }
      // Kopf vor die Zeilen, Fuß danach
      const head = sec.querySelector(":scope > .sechead");
      sec.appendChild(rows);
      const foot = sec.querySelector(":scope > .secfoot");
      if (foot) sec.appendChild(foot);
      if (head) sec.prepend(head);
      if (rows.childNodes.length || head || foot) inner.appendChild(sec);
    }
    pad.appendChild(inner);
    e.appendChild(pad);
    if (p.refresh != null) { e.dataset.refresh = p.refresh; e.appendChild(ptr()); }
    e.dataset.k = p.k;
    return e;
  },
  sechead(n) { return kids(el("div", "sechead"), n.c); },
  secfoot(n) { return kids(el("div", "secfoot"), n.c); },
  nav(n) { return buildNav(n); },
  tabs(n) { return buildTabs(n); },
  chart(n) { const e = el("div", "chart"); e._chart = n.p; return e; },
  native(n) {
    const e = el("div", "native");
    const t = el("div"); t.textContent = n.p.s; e.appendChild(t);
    if (n.p.open != null) { const b = el("button"); b.textContent = "Im Browser öffnen"; b.dataset.tap = n.p.open; e.appendChild(b); }
    return e;
  },
  unknown(n) { return kids(el("div", "z"), n.c); },
};

function buildRow(r) {
  const e = el("div", "row");
  for (const c of r.c || []) {
    if (c.t === "swipe") { e.appendChild(kids(el("div", "swipe"), c.c)); e.dataset.swipe = "1"; }
    else e.appendChild(build(c));
  }
  if (r.p && r.p.nosep) e.classList.add("nosep");
  if (r.s) e.style.cssText = r.s;
  return e;
}

function deco(n, behind) {
  const e = el("div", "deco-wrap " + (behind ? "bg" : "ov"));
  const [content, layer] = n.c;
  const c = build(content);
  const d = el("div", "deco");
  if (layer.s) d.style.cssText = layer.s;
  kids(d, layer.c);
  if (behind) e.append(d, c); else e.append(c, d);
  return e;
}

function ptr() {
  const s = el("div", "ptr");
  s.innerHTML = '<div class="spinner"></div>';
  return s;
}

function isShort(n) {
  if (n.t === "sp") return false;
  const t = textOf(n);
  // ein einzelnes Wort (z. B. ein großer Titel) bricht SwiftUI nicht mitten im Wort um
  if (t && t.trim().indexOf(" ") < 0 && t.length <= 24) return true;
  if (n.t === "text") return false;
  return t.length > 0 && t.length <= 16 && !JSON.stringify(n).includes('"t":"v"');
}

function textOf(n) {
  if (!n) return "";
  if (n.t === "text") return n.p.s != null ? n.p.s.replace(/\*\*|__|`/g, "") : (n.p.r || []).map((r) => r.s).join("");
  return (n.c || []).map(textOf).filter(Boolean).join(" ");
}

function buildNav(n) {
  const p = n.p;
  const [body, lead, mid, trail, bottom] = n.c;
  const e = el("div", "nav");
  const inline = p.inline || !p.title;
  e.classList.add(inline ? "inline" : "large");
  if (p.hidden) e.classList.add("nobar");
  e.dataset.k = p.k;
  const content = el("div", "content");
  const barH = p.hidden ? 0 : inline ? 44 : 96;
  content.style.setProperty("--bar-h", barH + "px");
  content.appendChild(page([body]));
  e.appendChild(content);
  if (!p.hidden) {
    const bar = el("div", "bar");
    const row = el("div", "row1");
    const l = el("div", "lead");
    if (p.back != null) {
      const b = el("div", "back");
      b.dataset.tap = p.back;
      b.innerHTML = '<svg viewBox="0 0 13 21"><path d="M11 2L2.5 10.5 11 19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const t = el("span"); t.textContent = p.backTitle && p.backTitle.length < 14 ? p.backTitle : "Zurück";
      b.appendChild(t);
      l.appendChild(b);
    }
    kids(l, lead.c);
    const m = el("div", "mid");
    if (mid.c && mid.c.length) kids(m, mid.c);
    else { const t = el("span", "ttl"); t.textContent = p.title || ""; m.appendChild(t); }
    const tr = kids(el("div", "trail"), trail.c);
    row.append(l, m, tr);
    bar.appendChild(row);
    if (!inline) { const big = el("div", "large"); big.textContent = p.title; bar.appendChild(big); }
    e.appendChild(bar);
  }
  if (bottom.c && bottom.c.length) e.appendChild(kids(el("div", "bottombar"), bottom.c));
  return e;
}

function buildTabs(n) {
  const p = n.p;
  const [pg, ...items] = n.c;
  const e = el("div", "tabs" + (p.hidden ? " nobar" : ""));
  const tp = el("div", "tpage");
  tp.dataset.k = pg.p ? pg.p.k : 0;
  tp.appendChild(page(pg.c || []));
  e.appendChild(tp);
  const bar = el("div", "tabbar");
  items.forEach((t, i) => {
    const b = el("div", "tab" + (t.p.on ? " on" : ""));
    b.dataset.tab = p.h; b.dataset.i = i;
    kids(b, t.c);
    if (t.p.badge) { const s = el("span", "badge"); s.textContent = t.p.badge; b.appendChild(s); }
    bar.appendChild(b);
  });
  e.appendChild(bar);
  return e;
}

function buildPortal(n) {
  const p = n.p || {};
  if (n.t === "sheet") {
    const wrap = el("div", "portal");
    wrap.style.cssText = "position:absolute;inset:0;";
    const scrim = el("div", "scrim");
    if (!p.locked && !p.full) scrim.dataset.tap = p.dismiss;
    const s = el("div", "sheet" + (p.full ? " full" : "") + (isHalf(p.detents) ? " half" : ""));
    s.dataset.k = p.k;
    if (!p.full) s.appendChild(el("div", "grabber"));
    s.appendChild(page(n.c || []));
    if (p.full) wrap.append(s); else wrap.append(scrim, s);
    wrap.dataset.dismiss = p.locked ? "" : p.dismiss;
    return wrap;
  }
  const wrap = el("div", "portal");
  wrap.style.cssText = "position:absolute;inset:0;";
  const scrim = el("div", "scrim");
  wrap.appendChild(scrim);
  const [msg, acts] = n.c;
  if (n.t === "alert") {
    scrim.style.background = "rgba(0,0,0,.2)";
    const box = el("div", "alertbox");
    if (p.title) { const t = el("div", "at"); t.textContent = p.title; box.appendChild(t); }
    const m = kids(el("div", "am"), msg.c);
    box.appendChild(m);
    const a = el("div", "acts");
    let buttons = acts.c || [];
    if (!buttons.length) buttons = [{ t: "btn", p: { tap: p.dismiss, kind: "dialog", role: "cancel" }, c: [{ t: "text", p: { s: "OK" } }] }];
    kids(a, buttons);
    if (buttons.length === 2) a.classList.add("two");
    box.appendChild(a);
    wrap.appendChild(box);
    wrap.dataset.dismiss = p.dismiss;
  } else {
    scrim.dataset.tap = p.dismiss;
    const sheet = el("div", "actionsheet");
    const g = el("div", "grp");
    if (p.title || (msg.c && msg.c.length)) {
      const t = el("div", "ttl");
      if (p.title) { const s = el("div"); s.textContent = p.title; t.appendChild(s); }
      kids(t, msg.c);
      g.appendChild(t);
    }
    const all = acts.c || [];
    const isCancel = (b) => JSON.stringify(b).includes('"role":"cancel"');
    for (const b of all.filter((b) => !isCancel(b))) g.appendChild(build(b));
    sheet.appendChild(g);
    const cancel = all.filter(isCancel);
    const cg = el("div", "grp");
    if (cancel.length) for (const b of cancel) cg.appendChild(build(b));
    else cg.appendChild(build({ t: "btn", p: { tap: p.dismiss, kind: "dialog", role: "cancel" }, c: [{ t: "text", p: { s: "Abbrechen" } }] }));
    sheet.appendChild(cg);
    wrap.appendChild(sheet);
    wrap.dataset.dismiss = p.dismiss;
  }
  return wrap;
}

function isHalf(d) {
  if (!d || !d.length) return false;
  return d.every((x) => x === "0.5" || (x.endsWith("px") && parseFloat(x) < 500));
}

// ---------- Farben für SVG ----------

let gid = 0;
function paint(p, defs, kind, w, h) {
  if (!p) return "none";
  if (typeof p === "string") return p;
  const id = "g" + ++gid;
  const st = p.st || [];
  let g;
  if (p.k === "l") {
    g = document.createElementNS(SVGNS, "linearGradient");
    g.setAttribute("x1", p.a[0]); g.setAttribute("y1", p.a[1]); g.setAttribute("x2", p.a[2]); g.setAttribute("y2", p.a[3]);
  } else {
    g = document.createElementNS(SVGNS, "radialGradient");
    g.setAttribute("gradientUnits", "userSpaceOnUse");
    g.setAttribute("cx", p.a[0] * w); g.setAttribute("cy", p.a[1] * h); g.setAttribute("r", p.a[3]);
  }
  g.id = id;
  for (const [c, o] of st) {
    const s = document.createElementNS(SVGNS, "stop");
    s.setAttribute("offset", o);
    s.setAttribute("stop-color", c);
    g.appendChild(s);
  }
  defs.appendChild(g);
  return `url(#${id})`;
}

// ---------- Symbole ----------

function symbol(name) {
  const icon = resolveIcon(name);
  const base = name.replace(/\.fill$/, "");
  const filled = /\.fill$/.test(name);
  const circleFill = /\.(circle|square)\.fill$/.test(name);
  const sw = 2;
  if (!icon) return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor" opacity=".5"/></svg>`;
  if (circleFill) {
    const shape = /square/.test(name) ? '<rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor"/>' : '<circle cx="12" cy="12" r="11.5" fill="currentColor"/>';
    const inner = ICONS[icon.inner || icon.name] || "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${shape}<g transform="translate(5.4 5.4) scale(.55)" stroke="#fff" stroke-width="3.2">${inner}</g></svg>`;
  }
  const fill = filled && !NOFILL.has(icon.name) ? 'fill="currentColor" fill-opacity="1"' : 'fill="none"';
  return `<svg viewBox="0 0 24 24" ${fill} stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon.name]}</svg>`;
  void base;
}

// diese Formen sehen gefüllt nicht gut aus (offene Linien)
const NOFILL = new Set(["sparkles", "zap", "footprints", "check", "x", "send", "settings", "wrench", "pen-line", "chevron-left", "chevron-right", "plus", "minus", "undo-2", "reply", "arrow-up", "graduation-cap", "brain", "library", "credit-card", "briefcase", "shopping-cart", "navigation", "euro", "newspaper", "sunrise", "scan", "target", "history", "calendar", "inbox", "mic", "camera", "key-round", "server", "layers", "trash-2", "link", "wifi-off", "images", "image", "book", "book-open"]);

function resolveIcon(name) {
  const tries = [name, name.replace(/\.fill$/, ""), name.replace(/\.(circle|square)(\.fill)?$/, ""), name.replace(/\.(badge|and)\..*$/, ""), name.split(".")[0]];
  const circle = /\.(circle|square)\.fill$/.test(name);
  for (const t of tries) {
    const m = SFMAP[t];
    if (m && ICONS[m]) {
      if (circle) {
        // für das Innere den Namen ohne Kreis nehmen (checkmark.circle.fill → check)
        const plain = SFMAP[name.replace(/\.(circle|square)\.fill$/, "")];
        return { name: m, inner: plain && ICONS[plain] ? plain : m };
      }
      return { name: m };
    }
  }
  return null;
}

// ---------- Markdown (nur das, was Stella schreibt) ----------

function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function md(s) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  h = h.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="#" data-open="${u}">${t}</a>`);
  return h;
}

// ---------- Abgleich mit dem bisherigen DOM ----------

function morphInto(parent, next) {
  const old = Array.from(parent.childNodes);
  for (let i = 0; i < next.length; i++) {
    const o = old[i];
    const nn = next[i];
    if (!o) { parent.appendChild(nn); appeared(nn); continue; }
    const r = morph(o, nn);
    if (r !== o) { parent.replaceChild(r, o); appeared(r); }
  }
  for (let i = next.length; i < old.length; i++) parent.removeChild(old[i]);
}

function same(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType !== 1) return true;
  if (a.dataset.t !== b.dataset.t) return false;
  if (a.dataset.k !== b.dataset.k) return false;
  if (a.dataset.sid !== b.dataset.sid) return false;
  if (a.nodeName === "INPUT" && a.type !== b.type) return false;
  return true;
}

/** gibt das Element zurück, das bleibt (das alte, angepasst, oder das neue) */
function morph(o, n) {
  if (!same(o, n)) return n;
  if (o.nodeType === 3) { if (o.data !== n.data) o.data = n.data; return o; }
  if (o.nodeType !== 1) return o;
  // Navigation: neue Stufe → Einschub-Animation
  const tag = o.nodeName;
  // Stil: nur wenn sich der Inhalt geändert hat (laufende Übergänge nicht abbrechen)
  const os = o.dataset.s, ns = n.dataset.s;
  const styleChanged = os !== ns;
  const oldStyle = o.dataset.s;
  // Klassen und Attribute übernehmen (außer style)
  for (const a of Array.from(o.attributes)) {
    if (a.name === "style") continue;
    if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  }
  for (const a of Array.from(n.attributes)) {
    if (a.name === "style") continue;
    if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  }
  if (ns !== undefined || os !== undefined) {
    if (styleChanged) {
      if (n.dataset.rep) repeatAnim(o, oldStyle || "", ns || "", JSON.parse(n.dataset.rep));
      else if (o._rep) { o._rep.cancel(); o._rep = null; }
      o.style.cssText = n.style.cssText;
    }
  } else if (o.style.cssText !== n.style.cssText) {
    o.style.cssText = n.style.cssText;
  }
  // Eingabefelder: Wert nur setzen, wenn die App ihn geändert hat
  if (tag === "INPUT" || tag === "TEXTAREA") {
    const appVal = n._val;
    if (appVal !== undefined && appVal !== o._val) {
      if (o.value !== appVal) o.value = appVal;
      o._val = appVal;
    }
    if (o.placeholder !== n.placeholder) o.placeholder = n.placeholder;
    o.disabled = n.disabled;
    if (tag === "INPUT" && o.type === "checkbox") o.checked = n.checked;
    return o;
  }
  if (tag === "SELECT") {
    o.innerHTML = n.innerHTML;
    const sel = Array.from(n.options).findIndex((x) => x.selected);
    o.selectedIndex = sel;
    return o;
  }
  if (tag === "CANVAS") { o._cmd = n._cmd; o._w = n._w; o._h = n._h; o._dirty = true; return o; }
  if (n._chart) { o._chart = n._chart; o._dirty = true; }
  if (tag === "svg" && o.getAttribute("class") === "path") {
    // Pfade: ganz ersetzen ist billig, Übergang für trim erhalten
    const op = o.querySelector("path"), np = n.querySelector("path");
    if (op && np && o.childNodes.length === n.childNodes.length && !o.querySelector("defs") && !n.querySelector("defs")) {
      for (const a of Array.from(np.attributes)) if (op.getAttribute(a.name) !== a.value) op.setAttribute(a.name, a.value);
      for (const a of Array.from(op.attributes)) if (!np.hasAttribute(a.name)) op.removeAttribute(a.name);
      return o;
    }
    o.innerHTML = n.innerHTML;
    return o;
  }
  if (o.classList.contains("sym")) { if (o.innerHTML !== n.innerHTML) o.innerHTML = n.innerHTML; return o; }
  if (o.classList.contains("text") && !n.firstElementChild && !o.firstElementChild) {
    if (o.textContent !== n.textContent) o.textContent = n.textContent;
    return o;
  }
  morphInto(o, Array.from(n.childNodes));
  return o;
}

/** repeatForever: zwischen altem und neuem Stil hin und her */
function repeatAnim(e, from, to, a) {
  const pf = parseStyle(from), pt = parseStyle(to);
  const keys = ["transform", "opacity", "filter", "background", "width", "height"].filter((k) => (pf[k] || "") !== (pt[k] || ""));
  if (!keys.length) return;
  const k0 = {}, k1 = {};
  for (const k of keys) { k0[k] = pf[k] || (k === "opacity" ? "1" : k === "transform" ? "none" : ""); k1[k] = pt[k] || (k === "opacity" ? "1" : k === "transform" ? "none" : ""); }
  if (e._rep) e._rep.cancel();
  e._rep = e.animate([k0, k1], { duration: (a.d || 0.35) * 1000, delay: (a.dl || 0) * 1000, easing: cssEase(a.e), iterations: a.rp < 0 ? Infinity : a.rp, direction: a.ar ? "alternate" : "normal" });
}

function cssEase(e) { return e && e.startsWith("cubic-bezier") ? clampBezier(e) : e || "ease-in-out"; }
function clampBezier(e) { return e; }

function parseStyle(s) {
  const o = {};
  for (const part of s.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return o;
}

/** neu erschienen: Übergang (transition) abspielen, wenn die App animiert */
function appeared(e) {
  if (e.nodeType !== 1) return;
  const list = e.dataset && e.dataset.transition ? [e] : Array.from(e.querySelectorAll ? e.querySelectorAll("[data-transition]") : []);
  for (const x of list) {
    const a = x.dataset.an ? JSON.parse(x.dataset.an) : null;
    if (!a) continue;
    const t = x.dataset.transition;
    const from = {};
    if (t.includes("opacity") || t.includes("scale") || t.includes("move")) from.opacity = 0;
    if (t.includes("scale")) from.transform = "scale(.6)";
    if (t.includes("move-top")) from.transform = "translateY(-40px)";
    if (t.includes("move-bottom")) from.transform = "translateY(40px)";
    if (t.includes("move-leading")) from.transform = "translateX(-40px)";
    if (t.includes("move-trailing")) from.transform = "translateX(40px)";
    if (!Object.keys(from).length) continue;
    x.animate([from, {}], { duration: (a.d || 0.35) * 1000, easing: cssEase(a.e), delay: (a.dl || 0) * 1000 });
  }
}

// ---------- nach dem Zeichnen ----------

const ro = new ResizeObserver((entries) => {
  const l = [];
  for (const en of entries) {
    const id = en.target.dataset.m;
    if (id == null) continue;
    const r = en.contentRect;
    const w = Math.round(r.width * 2) / 2, h = Math.round(r.height * 2) / 2;
    if (en.target._sz === w + "x" + h) continue;
    en.target._sz = w + "x" + h;
    l.push([Number(id), w, h]);
  }
  if (l.length) post({ k: "size", l });
});
const observed = new WeakSet();

const chartRO = new ResizeObserver((entries) => { for (const en of entries) drawChart(en.target); });

function afterRender() {
  for (const e of document.querySelectorAll("[data-m]")) if (!observed.has(e)) { observed.add(e); ro.observe(e); }
  for (const c of document.querySelectorAll("canvas.canvas")) drawCanvas(c);
  for (const c of document.querySelectorAll(".chart")) {
    if (!c._obs) { c._obs = true; chartRO.observe(c); }
    if (c._dirty !== false) drawChart(c);
  }
  for (const f of document.querySelectorAll(".fits")) pickFit(f);
  // Fokus aus der App übernehmen
  const want = document.querySelector("[data-fo='1'] input, [data-fo='1'] textarea, input[data-fo='1'], textarea[data-fo='1']");
  if (want && document.activeElement !== want) want.focus({ preventScroll: true });
  // Scrollansichten, die unten beginnen (Chat)
  for (const s of document.querySelectorAll(".scroll[data-anchor='bottom']")) {
    const atBottom = s._wasBottom !== false;
    if (atBottom) s.scrollTop = s.scrollHeight;
  }
  // Statusleiste hell über dunklem Hintergrund (Wetter in der Nacht)
  updateNavScrolled();
  growTextareas();
}

function growTextareas() {
  if (CSS.supports("field-sizing", "content")) return;
  for (const t of document.querySelectorAll("textarea.field:not(.editor)")) {
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
  }
}

function pickFit(f) {
  const kids = Array.from(f.children);
  const w = f.clientWidth;
  let chosen = kids[kids.length - 1];
  for (const k of kids) {
    k.classList.remove("pick");
    const prev = k.style.width;
    if (k.scrollWidth <= w + 1) { chosen = k; break; }
    k.style.width = prev;
  }
  if (chosen) chosen.classList.add("pick");
}

function drawCanvas(c) {
  if (!c._cmd) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c._w, h = c._h;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  for (const k of c._cmd) {
    g.save();
    g.globalAlpha = k.a != null ? k.a : 1;
    if (k.b) g.globalCompositeOperation = k.b;
    if (k.fl) g.filter = k.fl;
    if (k.k === "t") {
      g.font = k.f.replace("var(--font)", "InterPC, sans-serif");
      g.fillStyle = k.c;
      g.textAlign = k.ax < 0.33 ? "left" : k.ax > 0.66 ? "right" : "center";
      g.textBaseline = k.ay < 0.33 ? "top" : k.ay > 0.66 ? "bottom" : "middle";
      g.fillText(k.s, k.x, k.y);
      g.restore();
      continue;
    }
    const p = new Path2D(k.d);
    const style = canvasPaint(g, k.p);
    if (k.k === "f") { g.fillStyle = style; g.fill(p); }
    else {
      g.strokeStyle = style;
      g.lineWidth = k.lw || 1;
      if (k.cap) g.lineCap = k.cap;
      if (k.join) g.lineJoin = k.join;
      if (k.dash) g.setLineDash(k.dash);
      g.stroke(p);
    }
    g.restore();
  }
}

function canvasPaint(g, p) {
  if (typeof p === "string") return p.startsWith("var(") ? "#000" : p;
  if (!p) return "#000";
  let gr;
  if (p.k === "L") gr = g.createLinearGradient(p.a[0], p.a[1], p.a[2], p.a[3]);
  else if (p.k === "R") gr = g.createRadialGradient(p.a[0], p.a[1], p.a[2], p.a[0], p.a[1], Math.max(p.a[3], 0.01));
  else return "#000";
  for (const [c, o] of p.st) { try { gr.addColorStop(Math.max(0, Math.min(1, o)), c); } catch (_) {} }
  return gr;
}

// ---------- Diagramme ----------

function drawChart(c) {
  const ch = c._chart;
  if (!ch) return;
  c._dirty = false;
  const W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  const marks = ch.marks || [];
  const bars = marks.filter((m) => m.k === "bar" || m.k === "line" || m.k === "area" || m.k === "point");
  const rules = marks.filter((m) => m.k === "ruleY");
  const xs = [];
  const key = (x) => (x && x.date != null ? "d" + x.date : String(x));
  for (const m of bars) if (!xs.some((x) => key(x) === key(m.x))) xs.push(m.x);
  xs.sort((a, b) => (a && a.date != null && b && b.date != null ? a.date - b.date : 0));
  let max = 0;
  for (const m of bars) max = Math.max(max, Number(m.y) || 0);
  for (const r of rules) max = Math.max(max, Number(r.y) || 0);
  if (ch.yDomain) max = ch.yDomain[1];
  max = niceMax(max || 1);
  const left = ch.yAxis && ch.yAxis.hidden ? 4 : 40, bottom = ch.xAxis && ch.xAxis.hidden ? 4 : 20, top = 18, right = 6;
  const pw = W - left - right, ph = H - top - bottom;
  const bw = xs.length ? pw / xs.length : pw;
  const yOf = (v) => top + ph - (v / max) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  const ticks = 4;
  const gridColor = (ch.yAxis && ch.yAxis.gridColor) || "rgba(60,60,67,.18)";
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = yOf(v);
    s += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="${gridColor}" stroke-width="1"/>`;
    if (!(ch.yAxis && ch.yAxis.hidden)) s += `<text x="${left - 6}" y="${y + 4}" text-anchor="end" fill="#8e8e93">${fmtNum(v)}</text>`;
  }
  const stride = ch.xAxis && ch.xAxis.values && ch.xAxis.values.strideDays ? ch.xAxis.values.strideDays : Math.max(1, Math.ceil(xs.length / 7));
  xs.forEach((x, i) => {
    if (i % stride) return;
    const cx = left + bw * i + bw / 2;
    if (!(ch.xAxis && ch.xAxis.hidden)) s += `<text x="${cx}" y="${H - 4}" text-anchor="middle" fill="#8e8e93">${esc(fmtX(x))}</text>`;
  });
  const linePts = [];
  for (const m of bars) {
    const i = xs.findIndex((x) => key(x) === key(m.x));
    const v = Number(m.y) || 0;
    if (m.k === "bar") {
      const pad = Math.min(bw * 0.22, 8), x = left + bw * i + pad, w = Math.max(2, bw - pad * 2), y = yOf(v), h = top + ph - y;
      const r = Math.min(parseFloat(m.radius) || 0, w / 2, h);
      s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0, h)}" rx="${r}" fill="${m.color || "var(--tint)"}" opacity="${m.opacity != null ? m.opacity : 1}"/>`;
    } else linePts.push([left + bw * i + bw / 2, yOf(v), m]);
  }
  if (linePts.length) {
    const col = linePts[0][2].color || "var(--tint)";
    s += `<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${linePts.map((p) => p[0] + "," + p[1]).join(" ")}"/>`;
  }
  const anns = [];
  for (const r of rules) {
    const y = yOf(Number(r.y) || 0);
    s += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="${r.color || "#ff7eb3"}" stroke-width="${r.lw || 1.5}" ${r.dash ? `stroke-dasharray="${r.dash.join(" ")}"` : ""}/>`;
    if (r.ann) anns.push([W - right, y - 2, r.ann]);
  }
  s += "</svg>";
  c.innerHTML = s;
  for (const [x, y, node] of anns) {
    const a = el("div", "ann");
    a.style.left = x + "px"; a.style.top = y + "px";
    a.appendChild(build(node));
    c.appendChild(a);
  }
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function fmtNum(v) { return v >= 1000 ? (Math.round(v / 100) / 10).toLocaleString("de-AT") + "k" : Math.round(v).toLocaleString("de-AT"); }
function fmtX(x) {
  if (x && x.date != null) { const d = new Date(x.date); return d.getDate() + "." + (d.getMonth() + 1) + "."; }
  return String(x);
}

// ---------- Navigation: Leiste beim Scrollen ----------

function updateNavScrolled() {
  for (const nav of document.querySelectorAll(".nav")) {
    const sc = nav.querySelector(":scope > .content .scroll.ax-v, :scope > .content .list");
    nav.classList.toggle("scrolled", !!sc && sc.scrollTop > 4 && closestNav(sc) === nav);
  }
}
function closestNav(e) { return e.closest(".nav"); }
document.addEventListener("scroll", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("scroll")) t._wasBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 30;
  const nav = t.closest && t.closest(".nav");
  if (nav && (t.classList.contains("scroll") || t.classList.contains("list"))) nav.classList.toggle("scrolled", t.scrollTop > 4);
}, true);

// ---------- Eingaben ----------

let suppressClick = false;

document.addEventListener("click", (e) => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  const t = e.target;
  // offenes Menü schließen
  const pop = document.querySelector(".popup");
  if (pop && !pop.contains(t)) { closePopup(); if (!t.closest("[data-menu]")) return; }
  const a = t.closest("a[data-open]");
  if (a) { e.preventDefault(); openURL(a.dataset.open); return; }
  const sw = document.querySelector(".row.swiped");
  if (sw && !sw.contains(t)) { sw.classList.remove("swiped"); return; }
  const menu = t.closest("[data-menu]");
  if (menu && !t.closest(".popup") && t.closest(".mlabel")) { openPopup(menu.querySelector(".mitems"), menu); return; }
  const tab = t.closest("[data-tab]");
  if (tab) { post({ k: "ev", id: Number(tab.dataset.tab), v: Number(tab.dataset.i) }); return; }
  const seg = t.closest("[data-pick]");
  if (seg && seg.nodeName !== "SELECT" && seg.dataset.i != null) {
    post({ k: "ev", id: Number(seg.dataset.pick), v: Number(seg.dataset.i) });
    if (seg.closest(".popup")) closePopup();
    return;
  }
  const tog = t.closest("[data-toggle]");
  if (tog) { post({ k: "ev", id: Number(tog.dataset.toggle), v: tog.dataset.on !== "1" }); return; }
  const tap = t.closest("[data-tap]");
  if (tap && !tap.classList.contains("dis") && !tap.closest(".dis-wrap")) {
    if (tap.closest(".popup")) closePopup();
    ev(Number(tap.dataset.tap));
    const row = tap.closest(".row.swiped"); if (row) row.classList.remove("swiped");
  }
});

document.addEventListener("dblclick", (e) => {
  const d = e.target.closest("[data-dbl]");
  if (d) ev(Number(d.dataset.dbl));
});

document.addEventListener("contextmenu", (e) => {
  const lp = e.target.closest("[data-lp]");
  const cm = e.target.closest("[data-ctx]");
  const row = e.target.closest(".row[data-swipe]");
  if (cm) { e.preventDefault(); openPopup(cm.querySelector(".citems"), cm, e); return; }
  if (lp) { e.preventDefault(); ev(Number(lp.dataset.lp)); return; }
  if (row) { e.preventDefault(); row.classList.add("swiped"); }
});

document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (e.key === "Enter" && t.dataset && t.dataset.sub != null) {
    if (t.nodeName === "TEXTAREA" && e.shiftKey) return;
    e.preventDefault();
    sendInput(t);
    ev(Number(t.dataset.sub));
    return;
  }
  if (e.key === "Enter" && t.dataset && t.dataset.tap != null) { e.preventDefault(); t.click(); return; }
  if (e.key === "Escape") { escape(); return; }
  if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
    e.preventDefault();
    const r = document.querySelector("[data-refresh]");
    if (r) pullRefresh(r);
  }
});

function escape() {
  if (document.querySelector(".popup")) { closePopup(); return; }
  const portals = overlay.querySelectorAll(".portal");
  const top = portals[portals.length - 1];
  if (top && top.dataset.dismiss) { ev(Number(top.dataset.dismiss)); return; }
  const backs = app.querySelectorAll(".nav > .bar .back");
  if (backs.length) backs[backs.length - 1].click();
}

function sendInput(t) {
  const v = t.value;
  t._val = v;
  post({ k: "ev", id: Number(t.dataset.input), v });
}

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.input != null) sendInput(t);
  if (t.dataset.slide != null) post({ k: "ev", id: Number(t.dataset.slide), v: Number(t.value) });
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.nodeName === "SELECT" && t.dataset.pick != null) post({ k: "ev", id: Number(t.dataset.pick), v: Number(t.value) });
  if (t.dataset.date != null) { t._val = t.value; post({ k: "ev", id: Number(t.dataset.date), v: { [t.dataset.part]: t.value } }); }
});

document.addEventListener("focusin", (e) => {
  const w = e.target.closest("[data-fc]");
  if (w) post({ k: "ev", id: Number(w.dataset.fc), v: true });
});
document.addEventListener("focusout", (e) => {
  const w = e.target.closest("[data-fc]");
  if (w) post({ k: "ev", id: Number(w.dataset.fc), v: false });
});

// Ziehen (DragGesture) und Wischen (Zeilen)
let drag = null;
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const d = e.target.closest("[data-drag]");
  const row = e.target.closest(".row[data-swipe]");
  if (!d && !row) return;
  const r = (d || row).getBoundingClientRect();
  drag = { el: d, row, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, min: Number(d ? d.dataset.dmin : 30), on: false, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vy: 0 };
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  const now = performance.now(), dt = Math.max(1, now - drag.lt);
  drag.vx = ((e.clientX - drag.lx) / dt) * 1000; drag.vy = ((e.clientY - drag.ly) / dt) * 1000;
  drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
  if (!drag.on && Math.hypot(dx, dy) >= Math.max(drag.min, 1)) drag.on = true;
  if (!drag.on) return;
  if (drag.el) {
    if (!drag.raf) drag.raf = requestAnimationFrame(() => {
      if (!drag) return;
      drag.raf = 0;
      post({ k: "ev", id: Number(drag.el.dataset.drag), v: { ph: "move", x: drag.lx - drag.ox, y: drag.ly - drag.oy, sx: drag.sx - drag.ox, sy: drag.sy - drag.oy, vx: drag.vx, vy: drag.vy } });
    });
  }
});
document.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.on) {
    // Halten ohne Bewegung ist ein Tipp: Ziehen mit Mindestweg 0 (z. B. Sprachknopf) bekommt Anfang und Ende
    if (d.el && d.min === 0) {
      post({ k: "ev", id: Number(d.el.dataset.drag), v: { ph: "move", x: d.sx - d.ox, y: d.sy - d.oy, sx: d.sx - d.ox, sy: d.sy - d.oy, vx: 0, vy: 0 } });
      post({ k: "ev", id: Number(d.el.dataset.drag), v: { ph: "end", x: e.clientX - d.ox, y: e.clientY - d.oy, sx: d.sx - d.ox, sy: d.sy - d.oy, vx: 0, vy: 0 } });
    }
    return;
  }
  if (d.el) post({ k: "ev", id: Number(d.el.dataset.drag), v: { ph: "end", x: e.clientX - d.ox, y: e.clientY - d.oy, sx: d.sx - d.ox, sy: d.sy - d.oy, vx: d.vx, vy: d.vy } });
  if (d.row && !d.el) {
    const dx = e.clientX - d.sx;
    if (dx < -40) d.row.classList.add("swiped");
    if (dx > 30) d.row.classList.remove("swiped");
  }
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
});

// Ziehen zum Aktualisieren (Mausrad oben am Anfang)
let wheelPull = 0, wheelTimer = 0;
document.addEventListener("wheel", (e) => {
  const r = e.target.closest("[data-refresh]");
  if (!r) return;
  if (r.scrollTop <= 0 && e.deltaY < 0) {
    wheelPull += -e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelPull = 0; }, 300);
    if (wheelPull > 240) { wheelPull = 0; pullRefresh(r); }
  }
}, { passive: true });

function pullRefresh(r) {
  if (r._refreshing) return;
  r._refreshing = true;
  const s = r.querySelector(":scope > .ptr");
  if (s) s.classList.add("on");
  ev(Number(r.dataset.refresh));
  setTimeout(() => endRefresh(), 8000);
}
function endRefresh() {
  for (const r of document.querySelectorAll("[data-refresh]")) {
    r._refreshing = false;
    const s = r.querySelector(":scope > .ptr");
    if (s) s.classList.remove("on");
  }
}

// ---------- Menüs ----------

function openPopup(items, anchor, mouse) {
  closePopup();
  if (!items) return;
  const p = el("div", "popup");
  p.appendChild(items.cloneNode(true));
  p.firstChild.style.display = "flex";
  p.firstChild.style.flexDirection = "column";
  p._src = items;
  screenEl.appendChild(p);
  const sr = screenEl.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  let x = mouse ? mouse.clientX : ar.right - pw;
  let y = mouse ? mouse.clientY : ar.bottom + 6;
  x = Math.max(sr.left + 8, Math.min(x, sr.right - pw - 8));
  if (y + ph > sr.bottom - 20) y = Math.max(sr.top + 50, (mouse ? mouse.clientY : ar.top) - ph - 6);
  p.style.left = x + "px";
  p.style.top = y + "px";
  p.style.position = "fixed";
}
function closePopup() { for (const p of document.querySelectorAll(".popup")) p.remove(); }

// ---------- Nachrichten der App ----------

const notifyTimers = new Map();

function onMessage(m) {
  switch (m.k) {
    case "open": openURL(m.url); break;
    case "copy": navigator.clipboard && navigator.clipboard.writeText(m.s).then(() => toast("Kopiert"), () => {}); break;
    case "toast": toast(m.s); break;
    case "nav": navAnim(m.dir); break;
    case "refreshed": endRefresh(); break;
    case "scrollTo": {
      requestAnimationFrame(() => {
        const t = document.querySelector(`[data-sid="${m.id}"]`);
        if (t) t.scrollIntoView({ block: m.anchor === "end" ? "end" : m.anchor === "start" ? "start" : m.anchor === "center" ? "center" : "nearest", behavior: m.anim ? "smooth" : "auto" });
      });
      break;
    }
    case "pickPhotos": pickPhotos(m.hook, m.multi); break;
    case "audio": audio(m); break;
    case "notifyPermission": if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); break;
    case "notify": scheduleNotification(m); break;
    case "unnotify": for (const id of m.ids) { clearTimeout(notifyTimers.get(id)); notifyTimers.delete(id); } break;
  }
}

function openURL(url) {
  if (!/^(https?:|mailto:|tel:)/i.test(url)) { toast("Das gibt es am PC nicht."); return; }
  window.open(url, "_blank", "noopener");
}

let toastTimer = 0;
function toast(s) {
  const t = document.getElementById("toast");
  t.textContent = s;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

let pendingNav = null;
function navAnim(dir) {
  pendingNav = dir;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const navs = app.querySelectorAll(".nav");
    const nav = navs[navs.length - 1] || overlay.querySelector(".nav");
    const target = Array.from(document.querySelectorAll(".nav")).pop();
    const c = target && target.querySelector(":scope > .content");
    if (c) {
      c.classList.remove("slide-in", "slide-back");
      void c.offsetWidth;
      c.classList.add(pendingNav === "push" ? "slide-in" : "slide-back");
    }
    void nav;
  }));
}

function pickPhotos(hook, multi) {
  const i = el("input");
  i.type = "file";
  i.accept = "image/*";
  i.multiple = !!multi;
  i.onchange = async () => {
    const files = [];
    for (const f of i.files) {
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
      files.push({ mime: f.type || "image/jpeg", b64 });
    }
    post({ k: hook, files });
  };
  i.click();
}

const players = new Map();
function audio(m) {
  let a = players.get(m.id);
  if (!a) {
    a = new Audio("/res/" + m.id);
    a.onended = () => post({ k: "audioEnded:" + m.id });
    players.set(m.id, a);
  }
  if (m.do === "play") a.play().catch(() => toast("Diese Sprachnachricht kann der Browser nicht abspielen."));
  else if (m.do === "pause") a.pause();
  else { a.pause(); a.currentTime = 0; }
}

function scheduleNotification(m) {
  clearTimeout(notifyTimers.get(m.id));
  const delay = m.at - Date.now();
  if (delay < 0 || delay > 2147483000) return;
  notifyTimers.set(m.id, setTimeout(() => {
    if ("Notification" in window && Notification.permission === "granted") new Notification(m.title || "Stella", { body: m.body });
    else toast((m.title ? m.title + ": " : "") + m.body);
  }, delay));
}

connect();
