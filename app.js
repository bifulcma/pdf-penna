import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const LIB = new URL('./lib/', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const home = $('home'), editor = $('editor'), viewer = $('viewer'), pagesEl = $('pages');

// ---------- Archivio (IndexedDB) ----------
const DB_NAME = 'pdf-penna', STORE = 'docs';
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const dbPut = (rec) => tx('readwrite', (s) => s.put(rec));
const dbGet = (id) => tx('readonly', (s) => s.get(id));
const dbAll = () => tx('readonly', (s) => s.getAll());
const dbDel = (id) => tx('readwrite', (s) => s.delete(id));

// ---------- Stato ----------
const state = {
  rec: null,          // record corrente { id, name, data, strokes, updated }
  pdf: null,          // documento pdf.js
  pages: [],          // [{ wrap, pdfCanvas, drawCanvas, aspect, num, rendered, task }]
  zoom: 1,
  tool: 'pen',
  color: '#1a1a1a',
  size: 3,
  undo: [], redo: [],
};

// ---------- Schermata iniziale ----------
function fmtDate(t) {
  return new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}
async function refreshRecents() {
  const list = $('recent-list');
  const all = (await dbAll()).sort((a, b) => b.updated - a.updated);
  list.textContent = '';
  $('recent-empty').hidden = all.length > 0;
  for (const r of all) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open';
    const n = document.createElement('span'); n.className = 'name'; n.textContent = r.name;
    const d = document.createElement('span'); d.className = 'date'; d.textContent = fmtDate(r.updated);
    open.append(n, d);
    open.onclick = () => openRecord(r.id);
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = 'Elimina';
    del.onclick = async () => {
      if (confirm('Eliminare “' + r.name + '” e le sue annotazioni da questo iPad?')) {
        await dbDel(r.id); refreshRecents();
      }
    };
    li.append(open, del);
    list.append(li);
  }
}

$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await openFile(f);
});

async function openFile(file) {
  const data = await file.arrayBuffer();
  const key = file.name + '|' + data.byteLength;
  const existing = (await dbAll()).find((r) => r.key === key);
  const rec = existing || {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    key, name: file.name, data, strokes: {}, updated: Date.now(),
  };
  if (!existing) await dbPut(rec);
  await showRecord(rec);
}
async function openRecord(id) {
  const rec = await dbGet(id);
  if (rec) await showRecord(rec);
}

// ---------- Visualizzazione PDF ----------
const MAX_PIXELS = 9e6;

async function showRecord(rec) {
  state.rec = rec;
  state.undo = []; state.redo = []; updateUndoButtons();
  state.zoom = 1;
  home.hidden = true; editor.hidden = false;
  pagesEl.textContent = '';
  state.pages = [];
  try {
    state.pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(rec.data.slice(0)),
      standardFontDataUrl: LIB + 'standard_fonts/',
      cMapUrl: LIB + 'cmaps/', cMapPacked: true,
      iccUrl: LIB + 'iccs/', wasmUrl: LIB + 'wasm/',
    }).promise;
  } catch (err) {
    toast('Non riesco ad aprire questo PDF.');
    closeEditor();
    return;
  }
  for (let n = 1; n <= state.pdf.numPages; n++) {
    const page = await state.pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const wrap = document.createElement('div');
    wrap.className = 'page';
    const pdfCanvas = document.createElement('canvas');
    const drawCanvas = document.createElement('canvas');
    drawCanvas.className = 'draw';
    wrap.append(pdfCanvas, drawCanvas);
    pagesEl.append(wrap);
    const p = { num: n, page, wrap, pdfCanvas, drawCanvas, baseW: vp.width, aspect: vp.height / vp.width, rendered: false, task: null, cw: 0, ch: 0 };
    state.pages.push(p);
    attachDrawing(p);
  }
  layout();
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  updatePageIndicator();
}

function fitWidth() {
  return Math.max(200, viewer.clientWidth - 24);
}
function layout() {
  const w = fitWidth() * state.zoom;
  for (const p of state.pages) {
    p.cw = w; p.ch = w * p.aspect;
    p.wrap.style.width = w + 'px';
    p.wrap.style.height = p.ch + 'px';
    p.rendered = false;
    observer.unobserve(p.wrap);
    observer.observe(p.wrap);
  }
}

const observer = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const p = state.pages.find((x) => x.wrap === en.target);
    if (!p) continue;
    if (en.isIntersecting) renderPage(p); else releasePage(p);
  }
}, { root: viewer, rootMargin: '1200px 0px' });

function pixelRatio(p) {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, Math.sqrt(MAX_PIXELS / (p.cw * p.ch)));
}

async function renderPage(p) {
  if (p.rendered) return;
  p.rendered = true;
  if (p.task) { try { p.task.cancel(); } catch {} }
  const r = pixelRatio(p);
  const W = Math.round(p.cw * r), H = Math.round(p.ch * r);
  p.drawCanvas.width = W; p.drawCanvas.height = H;
  redrawPage(p);
  const vp = p.page.getViewport({ scale: (p.cw / p.baseW) * r });
  const off = document.createElement('canvas');
  off.width = Math.round(vp.width); off.height = Math.round(vp.height);
  const task = p.page.render({ canvas: off, canvasContext: off.getContext('2d'), viewport: vp });
  p.task = task;
  try {
    await task.promise;
    if (p.task !== task) return;
    p.pdfCanvas.width = off.width; p.pdfCanvas.height = off.height;
    p.pdfCanvas.getContext('2d').drawImage(off, 0, 0);
    p.wrap.dataset.rendered = '1';
  } catch (e) { /* annullato */ }
}
function releasePage(p) {
  if (!p.rendered) return;
  p.rendered = false;
  if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
  p.pdfCanvas.width = 0; p.drawCanvas.width = 0;
  delete p.wrap.dataset.rendered;
}

function updatePageIndicator() {
  if (!state.pages.length) return;
  const mid = viewer.scrollTop + viewer.clientHeight / 2;
  let cur = 1;
  for (const p of state.pages) { if (p.wrap.offsetTop <= mid) cur = p.num; else break; }
  $('page-ind').textContent = 'Pag. ' + cur + ' / ' + state.pdf.numPages;
}
viewer.addEventListener('scroll', updatePageIndicator, { passive: true });

// Zoom a pizzico con due dita (le dita scorrono, la penna disegna)
let pinch = null;
viewer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    const rect = viewer.getBoundingClientRect();
    const cx = (a.clientX + b.clientX) / 2 - rect.left, cy = (a.clientY + b.clientY) / 2 - rect.top;
    pinch = {
      d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      z0: state.zoom, ratio: 1, cx, cy,
      fx: viewer.scrollLeft + cx - pagesEl.offsetLeft, fy: viewer.scrollTop + cy - pagesEl.offsetTop,
    };
    pagesEl.style.transformOrigin = pinch.fx + 'px ' + pinch.fy + 'px';
  }
}, { passive: true });
viewer.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches;
  const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const nz = Math.min(5, Math.max(0.5, pinch.z0 * d / pinch.d0));
  pinch.ratio = nz / pinch.z0;
  pagesEl.style.transform = 'scale(' + pinch.ratio + ')';
}, { passive: false });
function endPinch() {
  if (!pinch) return;
  const { ratio, fx, fy, cx, cy } = pinch;
  pinch = null;
  pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '0 0';
  if (Math.abs(ratio - 1) < 0.01) return;
  state.zoom = Math.min(5, Math.max(0.5, state.zoom * ratio));
  layout();
  viewer.scrollLeft = fx * ratio - cx + pagesEl.offsetLeft;
  viewer.scrollTop = fy * ratio - cy + pagesEl.offsetTop;
}
viewer.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); }, { passive: true });
viewer.addEventListener('touchcancel', endPinch, { passive: true });
window.addEventListener('resize', () => { if (state.pdf) layout(); });

// ---------- Disegno ----------
const HL_ALPHA = 0.35;
const widthFactor = (stroke) => (stroke.t === 'hl' ? 0.005 : 0.0007);

function strokePx(stroke, p) { return stroke.w * p.drawCanvas.width; }

function drawStroke(ctx, stroke, W, H) {
  const pts = stroke.pts;
  if (!pts.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.c; ctx.fillStyle = stroke.c;
  if (stroke.t === 'hl') {
    ctx.globalAlpha = HL_ALPHA;
    ctx.lineWidth = stroke.w * W;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
    if (pts.length === 1) ctx.lineTo(pts[0][0] * W + 0.01, pts[0][1] * H);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, stroke.w * W * pts[0][2] / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) drawSegment(ctx, stroke, pts[i - 1], pts[i], W, H);
}
function drawSegment(ctx, stroke, a, b, W, H) {
  ctx.strokeStyle = stroke.c;
  ctx.lineCap = 'round';
  ctx.lineWidth = stroke.w * W * (a[2] + b[2]) / 2;
  ctx.beginPath();
  ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(b[0] * W, b[1] * H);
  ctx.stroke();
}
function redrawPage(p, extra) {
  const c = p.drawCanvas;
  if (!c.width) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of (state.rec.strokes[p.num - 1] || [])) drawStroke(ctx, s, c.width, c.height);
  if (extra) drawStroke(ctx, extra, c.width, c.height);
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function hitStroke(s, x, y, rx, aspect) {
  // coordinate in unità di larghezza pagina (y scalata con l'aspect)
  const pts = s.pts;
  const r = rx + (s.w * (s.t === 'hl' ? 1 : 1.2)) / 2;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, (pts[0][1] - y) * aspect) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y * aspect, pts[i - 1][0], pts[i - 1][1] * aspect, pts[i][0], pts[i][1] * aspect) <= r) return true;
  }
  return false;
}

function attachDrawing(p) {
  const c = p.drawCanvas;
  let cur = null;      // tratto in corso
  let erased = null;   // tratti cancellati nel gesto corrente
  let pid = null;

  const norm = (e) => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const allowed = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse';

  // Safari: il pennino non deve far scorrere la pagina
  c.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
  }, { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());

  c.addEventListener('pointerdown', (e) => {
    if (!allowed(e) || pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pid = e.pointerId;
    try { c.setPointerCapture(pid); } catch {}
    const [x, y] = norm(e);
    if (state.tool === 'eraser') { erased = []; eraseAt(p, x, y, erased); return; }
    const f = factor(e);
    cur = { t: state.tool, c: state.color, w: state.size * widthFactor({ t: state.tool }), pts: [[x, y, f]] };
    redrawPage(p, cur);
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    for (const ev of list) {
      const [x, y] = norm(ev);
      if (state.tool === 'eraser') { eraseAt(p, x, y, erased); continue; }
      const last = cur.pts[cur.pts.length - 1];
      if (Math.abs(last[0] - x) * p.cw < 0.4 && Math.abs(last[1] - y) * p.ch < 0.4) continue;
      const pt = [x, y, factor(ev)];
      cur.pts.push(pt);
      if (cur.t === 'pen') drawSegment(c.getContext('2d'), cur, last, pt, c.width, c.height);
    }
    if (cur && cur.t === 'hl') redrawPage(p, cur);
  });
  const finish = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    try { c.releasePointerCapture(e.pointerId); } catch {}
    if (state.tool === 'eraser') {
      if (erased && erased.length) pushAction({ type: 'del', items: erased });
      erased = null;
      return;
    }
    if (!cur) return;
    const s = cur; cur = null;
    if (e.type === 'pointercancel') { redrawPage(p); return; }
    (state.rec.strokes[p.num - 1] ||= []).push(s);
    pushAction({ type: 'add', page: p.num - 1, stroke: s });
    redrawPage(p);
  };
  c.addEventListener('pointerup', finish);
  c.addEventListener('pointercancel', finish);
}

function factor(e) {
  if (e.pointerType !== 'pen' || state.tool === 'hl') return 1;
  const pr = e.pressure > 0 ? e.pressure : 0.5;
  return 0.3 + 1.4 * pr;
}

function eraseAt(p, x, y, erased) {
  const list = state.rec.strokes[p.num - 1];
  if (!list || !list.length) return;
  const rx = state.size * 0.004;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitStroke(list[i], x, y, rx, p.aspect)) {
      erased.push({ page: p.num - 1, stroke: list[i], index: i });
      list.splice(i, 1);
      changed = true;
    }
  }
  if (changed) redrawPage(p);
}

// ---------- Annulla / Ripeti ----------
function pushAction(a) {
  state.undo.push(a); state.redo = [];
  updateUndoButtons(); scheduleSave();
}
function updateUndoButtons() {
  $('btn-undo').disabled = !state.undo.length;
  $('btn-redo').disabled = !state.redo.length;
}
function pageByIndex(i) { return state.pages[i]; }
function applyUndo(a) {
  if (a.type === 'add') {
    const list = state.rec.strokes[a.page];
    const i = list.indexOf(a.stroke); if (i >= 0) list.splice(i, 1);
    redrawPage(pageByIndex(a.page));
  } else {
    for (const it of [...a.items].sort((x, y) => x.index - y.index)) {
      (state.rec.strokes[it.page] ||= []).splice(it.index, 0, it.stroke);
    }
    for (const pg of new Set(a.items.map((it) => it.page))) redrawPage(pageByIndex(pg));
  }
}
function applyRedo(a) {
  if (a.type === 'add') {
    (state.rec.strokes[a.page] ||= []).push(a.stroke);
    redrawPage(pageByIndex(a.page));
  } else {
    for (const it of a.items) {
      const list = state.rec.strokes[it.page];
      const i = list.indexOf(it.stroke); if (i >= 0) list.splice(i, 1);
    }
    for (const pg of new Set(a.items.map((it) => it.page))) redrawPage(pageByIndex(pg));
  }
}
$('btn-undo').onclick = () => {
  const a = state.undo.pop(); if (!a) return;
  applyUndo(a); state.redo.push(a); updateUndoButtons(); scheduleSave();
};
$('btn-redo').onclick = () => {
  const a = state.redo.pop(); if (!a) return;
  applyRedo(a); state.undo.push(a); updateUndoButtons(); scheduleSave();
};

// ---------- Salvataggio automatico ----------
let saveTimer = null, saving = Promise.resolve();
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!state.rec) return saving;
  state.rec.updated = Date.now();
  const copy = { ...state.rec, strokes: JSON.parse(JSON.stringify(state.rec.strokes)) };
  saving = saving.then(() => dbPut(copy)).catch(() => toast('Salvataggio non riuscito'));
  return saving;
}
document.addEventListener('visibilitychange', () => { if (document.hidden && state.rec) saveNow(); });
window.addEventListener('pagehide', () => { if (state.rec) saveNow(); });

// ---------- Strumenti ----------
document.querySelectorAll('.tool').forEach((b) => {
  b.onclick = () => {
    state.tool = b.dataset.tool;
    document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x === b));
  };
});
document.querySelectorAll('.color').forEach((b) => {
  b.onclick = () => {
    state.color = b.dataset.color;
    document.querySelectorAll('.color').forEach((x) => x.classList.toggle('active', x === b));
    if (state.tool === 'eraser') $('tool-pen').click();
  };
});
$('size').oninput = (e) => { state.size = Number(e.target.value); };

async function closeEditor() {
  if (state.rec) await saveNow();
  for (const p of state.pages) { observer.unobserve(p.wrap); if (p.task) { try { p.task.cancel(); } catch {} } }
  if (state.pdf) { try { state.pdf.destroy(); } catch {} }
  state.pdf = null; state.rec = null; state.pages = [];
  pagesEl.textContent = '';
  editor.hidden = true; home.hidden = false;
  refreshRecents();
}
$('btn-back').onclick = closeEditor;

// ---------- Esporta PDF annotato ----------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
// punto normalizzato (u,v sulla pagina mostrata) -> coordinate PDF, tenendo conto della rotazione
function toPdf(u, v, w, h, rot) {
  switch (rot) {
    case 90: return [v * w, u * h];
    case 180: return [w - u * w, v * h];
    case 270: return [w - v * w, h - u * h];
    default: return [u * w, h - v * h];
  }
}

export async function buildAnnotatedPdf(srcBytes, strokesByPage) {
  const { PDFDocument, rgb, LineCapStyle } = window.PDFLib;
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [key, list] of Object.entries(strokesByPage)) {
    const page = pages[Number(key)];
    if (!page || !list.length) continue;
    const { width: w, height: h } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const dispW = rot % 180 ? h : w;
    for (const s of list) {
      const [r, g, b] = hexToRgb(s.c);
      const color = rgb(r, g, b);
      const pts = s.pts.map((q) => toPdf(q[0], q[1], w, h, rot));
      const base = s.w * dispW;
      if (s.t === 'hl') {
        const [x0, y0] = pts[0];
        let d = 'M ' + x0 + ' ' + (-y0);
        for (let i = 1; i < pts.length; i++) d += ' L ' + pts[i][0] + ' ' + (-pts[i][1]);
        if (pts.length === 1) d += ' L ' + (x0 + 0.01) + ' ' + (-y0);
        page.drawSvgPath(d, {
          x: 0, y: 0, borderColor: color, borderWidth: base, borderOpacity: HL_ALPHA,
          borderLineCap: LineCapStyle.Round,
        });
      } else if (pts.length === 1) {
        page.drawCircle({ x: pts[0][0], y: pts[0][1], size: base * s.pts[0][2] / 2, color });
      } else {
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({
            start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] },
            thickness: base * (s.pts[i - 1][2] + s.pts[i][2]) / 2, color,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    }
  }
  return doc.save();
}

$('btn-export').onclick = async () => {
  const btn = $('btn-export');
  btn.disabled = true;
  toast('Preparo il PDF…', 0);
  try {
    await saveNow();
    const bytes = await buildAnnotatedPdf(new Uint8Array(state.rec.data.slice(0)), state.rec.strokes);
    const name = state.rec.name.replace(/\.pdf$/i, '') + ' (annotato).pdf';
    const file = new File([bytes], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); toast('Fatto'); return; }
      catch (err) { if (err && err.name === 'AbortError') { toast(''); return; } }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('PDF scaricato');
  } catch (err) {
    console.error(err);
    toast('Non riesco a creare il PDF.');
  } finally { btn.disabled = false; }
};

let toastTimer;
function toast(msg, ms = 2500) {
  const t = $('toast');
  clearTimeout(toastTimer);
  if (!msg) { t.hidden = true; return; }
  t.textContent = msg; t.hidden = false;
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Avvio ----------
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) openFile(await params.files[0].getFile());
  });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
refreshRecents();

// Appigli per i test automatici
window.__penna = { state, buildAnnotatedPdf, openFile, dbAll };
