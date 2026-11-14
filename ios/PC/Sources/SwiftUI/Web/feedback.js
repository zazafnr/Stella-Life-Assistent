// Stella am PC – Verbesserungen.
// Panel neben dem Handy: Verbesserungen notieren, je eine oder mehrere Screenshots vom Handy anhängen und
// wie im Snipping Tool zuschneiden. Alles landet als Dateien in einem Ordner (Swift-Server, /fb/…):
// verbesserungen.json und bilder/*.png. "Alle teilen" schreibt Verbesserungen.html (eine Datei mit allen
// Bildern) und Verbesserungen.md und zeigt sie im Explorer.
// Gehört nur zum PC-Fenster, nicht zur App: nichts davon geht an die App.
"use strict";
(() => {
  const TOKEN = window.STELLA_TOKEN;
  const HDR = { "X-Stella": TOKEN };
  const DATA = "verbesserungen.json";
  const q = (name) => "t=" + encodeURIComponent(TOKEN) + "&name=" + encodeURIComponent(name);
  const fileUrl = (name) => "/fb/file?" + q(name);
  const appName = document.title || "Stella";

  // ---------- Dateien beim Swift-Server ----------

  async function putFile(name, body, type) {
    const r = await fetch("/fb/file?" + q(name), { method: "POST", headers: { ...HDR, "Content-Type": type || "application/octet-stream" }, body });
    if (!r.ok) throw new Error("Speichern fehlgeschlagen (" + r.status + ")");
  }
  function delFile(name) { return fetch("/fb/delete?" + q(name), { method: "POST", headers: HDR }).catch(() => {}); }

  let data = { version: 1, items: [] };
  let dir = "";
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await putFile(DATA, JSON.stringify(data, null, 2), "application/json"); setStatus("Gespeichert"); }
      catch (e) { setStatus(e.message, true); }
    }, 350);
  }
  async function load() {
    try { const r = await fetch("/fb/info?t=" + encodeURIComponent(TOKEN)); if (r.ok) dir = (await r.json()).dir || ""; } catch (_) {}
    try {
      const r = await fetch(fileUrl(DATA));
      if (r.ok) { const d = await r.json(); if (d && Array.isArray(d.items)) data = d; }
    } catch (_) {}
    render();
  }

  // ---------- Hilfen ----------

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, cls, onClick, title) {
    const b = mk("button", cls, label);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }
  const isEmpty = (it) => !(it.text || "").trim() && !(it.shots || []).length;
  const firstLine = (t) => ((t || "").trim().split(/\r?\n/)[0] || "").trim();
  const fmtDate = (ms) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Eingaben im Panel gehören nicht der App: nicht an die Seite des Handys weiterreichen
  function isolate(root) {
    for (const t of ["keydown", "keyup", "click", "dblclick", "contextmenu", "pointerdown", "pointermove", "pointerup", "input", "change", "wheel", "focusin", "focusout", "paste"]) {
      root.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  // ---------- Panel ----------

  const panel = mk("aside"); panel.id = "fb";
  const rail = mk("button"); rail.id = "fb-rail"; rail.type = "button"; rail.title = "Verbesserungen öffnen";
  const railBadge = mk("span", "fb-badge");
  rail.append(mk("span", "fb-plus", "+"), mk("span", "fb-vert", "Verbesserung"), railBadge);
  rail.addEventListener("click", () => setOpen(true));

  const head = mk("div", "fb-head");
  const headBadge = mk("span", "fb-badge");
  head.append(mk("b", null, "Verbesserungen"), headBadge, mk("span", "fb-grow"), btn("»", "fb-icon", () => setOpen(false), "Einklappen"));
  const body = mk("div", "fb-body");
  const foot = mk("div", "fb-foot");
  const shareBtn = btn("Alle teilen …", "fb-primary", () => share());
  const status = mk("div", "fb-status");
  foot.append(shareBtn, status);
  panel.append(head, body, foot);
  document.body.append(panel, rail);
  isolate(panel); isolate(rail);

  let statusTimer = 0;
  function setStatus(text, err) {
    status.textContent = text || "";
    status.classList.toggle("err", !!err);
    clearTimeout(statusTimer);
    if (text && !err && text === "Gespeichert") statusTimer = setTimeout(() => { if (status.textContent === "Gespeichert") status.textContent = ""; }, 1500);
  }

  let open = true;
  try { open = localStorage.getItem("stellaPC.fb.open") !== "0"; } catch (_) {}
  function layout() {
    // Panel neben dem Handy, wenn Platz ist; sonst als Lasche am Rand, die das Panel über das Handy legt
    const side = window.innerWidth >= 790 && !document.body.classList.contains("full");
    document.body.classList.toggle("fb-side", side);
    document.body.classList.toggle("fb-closed", !open);
  }
  function setOpen(v) {
    open = v;
    try { localStorage.setItem("stellaPC.fb.open", v ? "1" : "0"); } catch (_) {}
    layout();
    window.dispatchEvent(new Event("resize"));
  }
  window.addEventListener("resize", layout);
  new MutationObserver(layout).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  let editing = null; // id der gerade bearbeiteten Verbesserung

  function render() {
    const items = data.items;
    const n = items.filter((it) => !isEmpty(it)).length;
    headBadge.textContent = railBadge.textContent = n ? String(n) : "";
    shareBtn.disabled = !n;
    body.textContent = "";
    const it = editing && items.find((x) => x.id === editing);
    if (it) renderEditor(it); else { editing = null; renderList(); }
  }

  function renderList() {
    body.append(btn("+  Neue Verbesserung", "fb-new", () => {
      const it = { id: newId(), text: "", shots: [], created: Date.now(), updated: Date.now() };
      data.items.push(it);
      editing = it.id;
      render();
      const ta = body.querySelector("textarea");
      if (ta) ta.focus();
    }));
    const items = data.items.filter((it) => !isEmpty(it));
    if (!items.length) {
      body.append(mk("div", "fb-empty", "Noch keine Verbesserungen. Lege eine an, schreib auf, was besser werden soll, und häng Screenshots vom Handy an."));
      return;
    }
    const list = mk("div", "fb-list");
    items.forEach((it, i) => {
      const card = mk("div", "fb-card");
      const title = mk("div", "fb-title");
      title.append(mk("span", "fb-num", (i + 1) + "."), mk("span", null, firstLine(it.text) || "(ohne Text)"));
      card.append(title);
      if (it.shots.length) {
        const mini = mk("div", "fb-mini");
        for (const s of it.shots.slice(0, 5)) { const img = mk("img"); img.src = fileUrl(s); img.alt = ""; mini.append(img); }
        card.append(mini);
      }
      const shots = it.shots.length === 1 ? "1 Screenshot" : it.shots.length + " Screenshots";
      card.append(mk("div", "fb-meta", fmtDate(it.updated || it.created) + " · " + shots));
      card.addEventListener("click", () => { editing = it.id; render(); });
      list.append(card);
    });
    body.append(list);
  }

  function renderEditor(it) {
    const no = data.items.filter((x) => !isEmpty(x) || x === it).indexOf(it) + 1;
    body.append(btn("‹ Alle Verbesserungen", "fb-link", () => leaveEditor()));
    body.append(mk("label", "fb-label", "Verbesserung " + no + ": Was soll besser werden?"));
    const ta = mk("textarea");
    ta.placeholder = "z. B. Der Knopf „Speichern“ ist zu klein und rutscht unter die Tastatur …";
    ta.value = it.text || "";
    ta.addEventListener("input", () => { it.text = ta.value; it.updated = Date.now(); save(); updateBadges(); });
    ta.addEventListener("paste", (e) => pasteImage(e, it));
    body.append(ta);

    body.append(mk("label", "fb-label", "Screenshots"));
    if (it.shots.length) {
      const grid = mk("div", "fb-shots");
      it.shots.forEach((s, i) => {
        const box = mk("div", "fb-shot");
        box.title = "Groß ansehen / neu zuschneiden";
        const img = mk("img"); img.src = fileUrl(s); img.alt = "Screenshot " + (i + 1);
        box.append(img, btn("×", "fb-x", async (e) => {
          e.stopPropagation();
          it.shots.splice(i, 1); it.updated = Date.now();
          save(); render(); delFile(s);
        }, "Screenshot entfernen"));
        box.addEventListener("click", () => recrop(it, i, img));
        grid.append(box);
      });
      body.append(grid);
    }
    const add = mk("div", "fb-addrow");
    const cam = btn("Screenshot vom Handy", "fb-primary", () => shootPhone(it));
    const pick = btn("Bild …", null, () => pickImage(it), "Bild aus einer Datei anhängen");
    add.append(cam, pick);
    body.append(add);
    body.append(mk("div", "fb-hint", "Danach ziehst du einen Rahmen um das, was man sehen soll. Strg+V im Textfeld hängt ein Bild aus der Zwischenablage an."));

    const ef = mk("div", "fb-edit-foot");
    ef.append(btn("Löschen", "fb-danger", () => {
      if (!isEmpty(it) && !confirm("Diese Verbesserung samt Screenshots löschen?")) return;
      data.items = data.items.filter((x) => x !== it);
      for (const s of it.shots) delFile(s);
      editing = null; save(); render();
    }), btn("Fertig", "fb-primary", () => leaveEditor()));
    body.append(ef);
  }

  function updateBadges() {
    const n = data.items.filter((it) => !isEmpty(it)).length;
    headBadge.textContent = railBadge.textContent = n ? String(n) : "";
    shareBtn.disabled = !n;
  }

  function leaveEditor() {
    const it = data.items.find((x) => x.id === editing);
    if (it && isEmpty(it)) { data.items = data.items.filter((x) => x !== it); }
    editing = null;
    save();
    render();
  }

  // ---------- Screenshots ----------

  /** Bild vom Handy-Bildschirm: dieses Fenster aufnehmen (ein Bild) und auf das Handy zuschneiden */
  async function capturePhone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error("Dieser Browser kann keine Screenshots aufnehmen. Nimm „Bild …“ oder Strg+V.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: 30 }, audio: false,
        preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude",
      });
    } catch (e) {
      throw new Error(e && e.name === "NotAllowedError" ? "Screenshot wurde nicht erlaubt." : "Screenshot nicht möglich: " + ((e && e.message) || e));
    }
    try {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      // kurz warten, bis das Fenster nach der Freigabe-Leiste wieder ruhig ist
      await new Promise((r) => setTimeout(r, 400));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const W = v.videoWidth, H = v.videoHeight;
      if (!W || !H) throw new Error("Screenshot war leer.");
      const sx = W / window.innerWidth, sy = H / window.innerHeight;
      const r = document.getElementById("screen").getBoundingClientRect();
      const x = Math.max(0, Math.round(r.left * sx)), y = Math.max(0, Math.round(r.top * sy));
      const w = Math.min(W - x, Math.round(r.width * sx)), h = Math.min(H - y, Math.round(r.height * sy));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, x, y, w, h, 0, 0, w, h);
      return c;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function shootPhone(it) {
    try {
      setStatus("Nehme das Handy auf …");
      let canvas;
      document.body.classList.add("fb-capturing");
      try { canvas = await capturePhone(); } finally { document.body.classList.remove("fb-capturing"); }
      setStatus("");
      const blob = await cropper(canvas);
      if (blob) await addShot(it, blob);
    } catch (e) { setStatus(e.message || String(e), true); }
  }

  function pickImage(it) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.addEventListener("change", async () => {
      for (const f of inp.files || []) {
        try { const blob = await cropper(await blobToCanvas(f)); if (blob) await addShot(it, blob); }
        catch (e) { setStatus("Bild konnte nicht geladen werden: " + (e.message || e), true); }
      }
    });
    inp.click();
  }

  async function pasteImage(e, it) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const x of items) {
      if (x.kind === "file" && x.type.startsWith("image/")) {
        e.preventDefault();
        try { const blob = await cropper(await blobToCanvas(x.getAsFile())); if (blob) await addShot(it, blob); }
        catch (err) { setStatus("Bild konnte nicht eingefügt werden: " + (err.message || err), true); }
        return;
      }
    }
  }

  async function blobToCanvas(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    return c;
  }

  async function addShot(it, blob) {
    const name = "bilder/" + it.id + "-" + Date.now().toString(36) + ".png";
    try {
      await putFile(name, blob, "image/png");
      it.shots.push(name); it.updated = Date.now();
      save();
      if (editing === it.id) render();
    } catch (e) { setStatus(e.message, true); }
  }

  /** Screenshot groß ansehen und bei Bedarf neu zuschneiden (ersetzt das Bild) */
  async function recrop(it, i, img) {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      if (!c.width) return;
      c.getContext("2d").drawImage(img, 0, 0);
      const blob = await cropper(c, { again: true });
      if (!blob) return;
      const old = it.shots[i];
      const name = "bilder/" + it.id + "-" + Date.now().toString(36) + ".png";
      await putFile(name, blob, "image/png");
      it.shots[i] = name; it.updated = Date.now();
      save(); render(); delFile(old);
    } catch (e) { setStatus(e.message || String(e), true); }
  }

  // ---------- Zuschneiden ----------

  const crop = mk("div"); crop.id = "fb-crop";
  const cropHint = mk("div", "fb-crop-hint");
  const stage = mk("div", "fb-stage");
  const sel = mk("div", "fb-sel");
  for (const h of ["nw", "ne", "sw", "se"]) { const d = mk("div", "fb-h"); d.dataset.h = h; sel.append(d); }
  const bar = mk("div", "fb-crop-bar");
  crop.append(cropHint, stage, bar);
  document.body.append(crop);
  isolate(crop);

  /** Zeigt das Bild; man zieht einen Rahmen. Ergebnis: PNG (Ausschnitt oder ganzes Bild) oder null */
  function cropper(src, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      stage.textContent = "";
      stage.classList.remove("has");
      const view = mk("canvas");
      view.width = src.width; view.height = src.height;
      view.getContext("2d").drawImage(src, 0, 0);
      stage.append(view, sel);
      cropHint.textContent = "";
      cropHint.append(opts.again ? "Neuen Rahmen ziehen – oder schließen" : "Zieh einen Rahmen um das, was man sehen soll",
        mk("small", null, "Enter übernimmt · Esc bricht ab · ohne Rahmen wird das ganze Bild genommen"));

      let r = null; // Auswahl in Bildschirm-Pixeln relativ zur Anzeige
      let mode = null, start = null, orig = null;
      const box = () => view.getBoundingClientRect();
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function draw() {
        if (!r || r.w < 4 || r.h < 4) { stage.classList.remove("has"); ok.disabled = true; return; }
        stage.classList.add("has"); ok.disabled = false;
        Object.assign(sel.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
      }
      function onDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const b = box();
        const px = clamp(e.clientX - b.left, 0, b.width), py = clamp(e.clientY - b.top, 0, b.height);
        const h = e.target.dataset && e.target.dataset.h;
        if (h && r) { mode = h; orig = { ...r }; }
        else if (r && e.target === sel) { mode = "move"; orig = { ...r }; }
        else { mode = "new"; r = { x: px, y: py, w: 0, h: 0 }; }
        start = { x: px, y: py };
        stage.setPointerCapture(e.pointerId);
      }
      function onMove(e) {
        if (!mode) return;
        const b = box();
        const px = clamp(e.clientX - b.left, 0, b.width), py = clamp(e.clientY - b.top, 0, b.height);
        if (mode === "new") {
          r = { x: Math.min(start.x, px), y: Math.min(start.y, py), w: Math.abs(px - start.x), h: Math.abs(py - start.y) };
        } else if (mode === "move") {
          r = { ...orig, x: clamp(orig.x + px - start.x, 0, b.width - orig.w), y: clamp(orig.y + py - start.y, 0, b.height - orig.h) };
        } else {
          let x1 = orig.x, y1 = orig.y, x2 = orig.x + orig.w, y2 = orig.y + orig.h;
          if (mode.includes("w")) x1 = px; if (mode.includes("e")) x2 = px;
          if (mode.includes("n")) y1 = py; if (mode.includes("s")) y2 = py;
          r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        }
        draw();
      }
      function onUp(e) { if (mode && e && e.type === "pointerup") onMove(e); mode = null; }
      stage.onpointerdown = onDown; stage.onpointermove = onMove; stage.onpointerup = onUp; stage.onpointercancel = onUp;

      function finish(useSel) {
        const b = box(); // messen, solange die Ansicht noch sichtbar ist
        crop.classList.remove("on");
        document.removeEventListener("keydown", onKey, true);
        stage.onpointerdown = stage.onpointermove = stage.onpointerup = stage.onpointercancel = null;
        if (useSel === null) { resolve(null); return; }
        const k = b.width > 0 ? src.width / b.width : 1;
        let x = 0, y = 0, w = src.width, h = src.height;
        if (useSel && r && r.w >= 4 && r.h >= 4) {
          x = Math.round(r.x * k); y = Math.round(r.y * k);
          w = Math.max(1, Math.min(src.width - x, Math.round(r.w * k))); h = Math.max(1, Math.min(src.height - y, Math.round(r.h * k)));
        }
        const out = document.createElement("canvas");
        out.width = w; out.height = h;
        out.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);
        out.toBlob((bl) => resolve(bl), "image/png");
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
        else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(!!(r && r.w >= 4)); }
      }
      document.addEventListener("keydown", onKey, true);

      bar.textContent = "";
      const ok = btn("Ausschnitt übernehmen", "fb-primary", () => finish(true));
      ok.disabled = true;
      if (opts.again) bar.append(btn("Schließen", null, () => finish(null)), ok);
      else bar.append(btn("Abbrechen", null, () => finish(null)), btn("Ganzes Bild", null, () => finish(false)), ok);
      crop.classList.add("on");
    });
  }

  // ---------- Teilen ----------

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  }

  async function share() {
    const items = data.items.filter((it) => !isEmpty(it));
    if (!items.length) { setStatus("Noch keine Verbesserungen."); return; }
    shareBtn.disabled = true;
    setStatus("Erstelle die Datei …");
    try {
      const now = fmtDate(Date.now());
      let md = "# Verbesserungen für " + appName + " (PC)\n\nStand: " + now + " · " + items.length + " Verbesserung" + (items.length === 1 ? "" : "en") + "\n";
      let html = "";
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const title = firstLine(it.text) || "(ohne Text)";
        md += "\n## " + (i + 1) + ". " + title + "\n\n" + ((it.text || "").trim() || "(ohne Text)") + "\n";
        html += '<section><h2><span>' + (i + 1) + '.</span> ' + esc(title) + '</h2><p class="meta">' + esc(fmtDate(it.updated || it.created)) + '</p><p>' + esc((it.text || "").trim() || "(ohne Text)").replace(/\r?\n/g, "<br>") + "</p>";
        if (it.shots.length) html += '<div class="shots">';
        for (let j = 0; j < it.shots.length; j++) {
          const s = it.shots[j];
          md += "\n![Screenshot " + (j + 1) + "](" + s + ")\n";
          const r = await fetch(fileUrl(s));
          if (r.ok) html += '<a href="' + s + '"><img alt="Screenshot ' + (j + 1) + '" src="' + (await blobToDataUrl(await r.blob())) + '"></a>';
        }
        if (it.shots.length) html += "</div>";
        html += "</section>";
      }
      const page = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        "<title>Verbesserungen – " + esc(appName) + "</title><style>" +
        "body{margin:0;background:#f3f5f8;font:15px/1.5 'Segoe UI',system-ui,sans-serif;color:#1c1c1e}main{max-width:860px;margin:0 auto;padding:28px 18px 60px}" +
        "h1{font-size:24px;margin:0 0 4px}.stand{color:#6b6f78;margin:0 0 22px}section{background:#fff;border:1px solid #dde1e8;border-radius:14px;padding:16px 18px;margin:0 0 14px}" +
        "h2{font-size:17px;margin:0}h2 span{color:#5b4bdb}.meta{color:#6b6f78;font-size:12.5px;margin:2px 0 8px}.shots{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}" +
        ".shots img{max-width:260px;max-height:520px;border:1px solid #dde1e8;border-radius:10px;display:block}</style></head><body><main>" +
        "<h1>Verbesserungen für " + esc(appName) + "</h1><p class=\"stand\">Notiert am PC · Stand " + esc(now) + " · " + items.length + " Verbesserung" + (items.length === 1 ? "" : "en") + "</p>" +
        html + "</main></body></html>";
      await putFile("Verbesserungen.html", page, "text/html");
      await putFile("Verbesserungen.md", md, "text/markdown");
      await fetch("/fb/open?" + q("Verbesserungen.html"), { method: "POST", headers: HDR });
      setStatus("Fertig: " + (dir ? dir + (dir.includes("\\") ? "\\" : "/") : "") + "Verbesserungen.html – im Explorer markiert. Diese eine Datei kannst du verschicken.");
    } catch (e) {
      setStatus("Teilen fehlgeschlagen: " + (e.message || e), true);
    } finally {
      updateBadges();
    }
  }

  layout();
  load();
})();
