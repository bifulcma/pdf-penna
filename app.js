import * as D from './db.js';
import * as Sync from './sync.js';
import { buildNotebookPdf, LAYOUT, HL_ALPHA } from './pdfexport.js';

const APP_VERSION = 'v5';
const $ = (id) => document.getElementById(id);
const library = $('library'), notebook = $('notebook'), viewer = $('viewer'), pagesEl = $('pages');
const TYPE_LABEL = { blank: 'Foglio bianco', lined: 'Righe', grid: 'Quadretti', pdf: 'PDF' };
// iPad/iPhone (anche iPadOS che si presenta come Mac): poca memoria per i canvas, quindi pagine a risoluzione più contenuta
const IOS = /iP(ad|hone|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// ---------- Errori sempre visibili (Marco può fotografarli) ----------
let errText = '';
function showError(where, err) {
  const name = err && err.name && err.name !== 'Error' ? ' (' + err.name + ')' : '';
  const msg = (err && err.message) ? err.message + name : String(err);
  errText = where + ': ' + msg.slice(0, 400) + '\nApp ' + APP_VERSION + ' · ' + navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120);
  $('err-msg').textContent = errText;
  $('errbox').hidden = false;
}
const benign = (e) => !e || /ResizeObserver loop|RenderingCancelled|AbortError/.test((e.name || '') + ' ' + (e.message || e));
window.addEventListener('error', (e) => { if (!benign(e.error || e.message)) showError('Errore', e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!benign(e.reason)) showError('Errore', e.reason); });
$('err-close').onclick = () => { $('errbox').hidden = true; };
$('err-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(errText); toast('Copiato'); } catch { toast('Non riesco a copiare: fai uno screenshot'); }
};

// ---------- pdf.js: caricato solo quando serve, con un solo worker condiviso ----------
const LIB = new URL('./lib/', import.meta.url).href;
const pdfOpts = { standardFontDataUrl: LIB + 'standard_fonts/', cMapUrl: LIB + 'cmaps/', cMapPacked: true, iccUrl: LIB + 'iccs/', wasmUrl: LIB + 'wasm/' };
let pdfjsP = null, pdfWorker = null;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = import('./lib/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('./pdfworker.js', import.meta.url).href;
      return m;
    }).catch((e) => {
      pdfjsP = null;
      throw new Error('il lettore PDF non parte su questo dispositivo (serve iPadOS/iOS 16.4 o più recente). Dettaglio: ' + ((e && e.message) || e));
    });
  }
  return pdfjsP;
}
async function loadPdf(bytes) {
  const m = await pdfjs();
  if (!pdfWorker) pdfWorker = new m.PDFWorker({ name: 'penna-pdf' });
  const task = m.getDocument({ data: bytes, worker: pdfWorker, ...pdfOpts });
  const doc = await task.promise;
  doc.penTask = task;
  return doc;
}
// chiude un documento (il worker condiviso resta acceso)
const closePdf = (doc) => { try { (doc.penTask || doc).destroy(); } catch {} };
// legge un file scelto dall'utente (iOS: arrayBuffer() c'è da iOS 14, FileReader come riserva)
function readFile(f) {
  if (f.arrayBuffer) return f.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(f); });
}

// ---------- Utilità ----------
let toastTimer;
function toast(msg, ms = 2500) {
  const t = $('toast');
  clearTimeout(toastTimer);
  if (!msg) { t.hidden = true; return; }
  t.textContent = msg; t.hidden = false;
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const icon = (n, cls = 'ic') => {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + n); s.append(u); return s;
};
function fmtDate(t) {
  const d = new Date(t), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return time;
  if (diff === 1) return 'Ieri';
  return d.toLocaleDateString('it-IT', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// Finestra di dialogo: ritorna { value, text, file? } oppure null se annullata.
// options: { label, value, icon?, accent?, danger? } | { paper:'lined'|'grid'|'blank', ... } | { color } | { file:'mime' }
function modal({ title, text = '', input = null, options = [] }) {
  return new Promise((resolve) => {
    const dlg = $('dlg'), inp = $('dlg-input'), opts = $('dlg-options');
    $('dlg-title').textContent = title; $('dlg-text').textContent = text;
    inp.hidden = input === null; inp.value = input ?? '';
    opts.textContent = '';
    let done = false;
    const close = (v) => { if (done) return; done = true; dlg.onclose = null; dlg.oncancel = null; if (dlg.open) dlg.close(); resolve(v); };
    let row = null, group = null;
    const holder = (cls) => {
      if (cls === 'group' ? !group : !row || row.className !== cls) {
        const h = el('div', cls); opts.append(h);
        if (cls === 'group') { group = h; row = null; } else { row = h; group = null; }
      }
      return cls === 'group' ? group : row;
    };
    for (const o of options) {
      let b;
      if (o.paper) {
        b = el('button', 'paper-opt'); b.type = 'button';
        b.append(el('span', 'paper ' + o.paper), el('span', 'lbl', o.label));
        b.onclick = () => close({ value: o.value, text: inp.value });
        holder('paper-row').append(b); continue;
      }
      if (o.color) {
        b = el('button', 'sw' + (o.current ? ' active' : '')); b.type = 'button'; b.style.background = o.color; b.setAttribute('aria-label', o.label);
        b.onclick = () => close({ value: o.value, text: inp.value });
        holder('sw-row').append(b); continue;
      }
      if (o.accent) {
        b = el('button', 'opt accent', o.label); b.type = 'button';
        b.onclick = () => close({ value: o.value, text: inp.value });
        opts.append(b); row = null; group = null; continue;
      }
      b = el(o.file ? 'label' : 'button', 'opt' + (o.danger ? ' danger' : '') + (o.file ? ' filebtn' : ''));
      if (!o.file) b.type = 'button';
      if (o.icon) b.append(icon(o.icon));
      b.append(el('span', 'lbl', o.label));
      if (o.file) {
        const fi = el('input', 'file-over'); fi.type = 'file'; fi.accept = o.file;
        fi.onchange = () => { const f = fi.files[0]; if (f) close({ value: o.value, file: f, text: inp.value }); };
        b.append(fi);
      } else b.onclick = () => close({ value: o.value, text: inp.value });
      holder('group').append(b);
    }
    $('dlg-form').onsubmit = (e) => { e.preventDefault(); const first = options.find((o) => !o.file && !o.color); if (first) close({ value: first.value, text: inp.value }); };
    $('dlg-cancel').onclick = () => close(null);
    dlg.oncancel = (e) => { e.preventDefault(); close(null); };
    dlg.onclose = () => { if (!dlg.open) close(null); };
    dlg.showModal();
    if (!inp.hidden) { inp.focus(); inp.select(); } else dlg.focus();
  });
}
const confirmDlg = async (title, text, label = 'Elimina') =>
  !!(await modal({ title, text, options: [{ label, value: 'ok', danger: true, icon: label === 'Elimina' ? 'trash' : 'logout' }] }));
// tocco sullo sfondo scuro = chiudi
for (const d of [$('dlg'), $('settings')]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

// ---------- Migrazione dalla versione 1 (singoli PDF) ----------
async function migrateLegacy() {
  if (await D.getMeta('legacy-migrated')) return;
  const d = await D.db();
  if (!d.objectStoreNames.contains('docs')) { await D.setMeta('legacy-migrated', 1); return; }
  const docs = await D.all('docs');
  for (const rec of docs) {
    try {
      const nb = await D.newNode('notebook', rec.name.replace(/\.pdf$/i, ''), null);
      const blob = await D.addBlob(rec.data, 'application/pdf', rec.name);
      const asp = await pdfAspects(rec.data);
      for (let i = 0; i < asp.length; i++) {
        const p = D.blankPage(nb.id, i, 'pdf', { blob: blob.id, pdfPage: i, aspect: asp[i] });
        p.strokes = (rec.strokes && rec.strokes[i]) || [];
        await D.put('pages', p);
      }
      await D.del('docs', rec.id);
    } catch (e) { console.warn('migrazione', e); }
  }
  await D.setMeta('legacy-migrated', 1);
}

// ---------- PDF ----------
async function pdfAspects(buf) {
  // copia: il worker si prende (e svuota) il buffer che riceve, su iOS l'originale resterebbe vuoto
  const doc = await loadPdf(new Uint8Array(buf.slice(0)));
  try {
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
      out.push(vp.height / vp.width);
    }
    return out;
  } finally { closePdf(doc); }
}
const pdfDocs = new Map();
function getPdf(blobId) {
  if (!pdfDocs.has(blobId)) {
    const pr = (async () => {
      const b = await D.get('blobs', blobId);
      if (!b) { const e = new Error('PDF non ancora scaricato'); e.name = 'NoData'; throw e; }
      return loadPdf(new Uint8Array(b.data)); // b è una copia fresca letta da IndexedDB: il worker può prenderla
    })();
    pr.catch(() => pdfDocs.delete(blobId));
    pdfDocs.set(blobId, pr);
  }
  return pdfDocs.get(blobId);
}
// libera i documenti aperti (memoria: su iPad conta)
function releasePdfs() {
  for (const pr of pdfDocs.values()) pr.then(closePdf, () => {});
  pdfDocs.clear();
}
const urlCache = new Map();
async function blobUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await D.get('blobs', id);
  if (!b) return null;
  const u = URL.createObjectURL(new Blob([b.data], { type: b.mime }));
  urlCache.set(id, u);
  return u;
}

// ---------- Disegno di sfondo, testi, immagini e tratti su un canvas ----------
function paintPattern(ctx, type, W, H, lw) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#cfd6de'; ctx.lineWidth = lw;
  ctx.beginPath();
  if (type === 'lined') {
    const step = W * LAYOUT.lined;
    for (let y = W * LAYOUT.margin + step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  } else if (type === 'grid') {
    const step = W * LAYOUT.grid;
    for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  }
  ctx.stroke();
}
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur);
  }
  return out;
}
// stessa impaginazione dell'export (pdfexport.js) e, a grandi linee, dello schermo
function paintBlocks(ctx, blocks, W, H) {
  if (!blocks || !blocks.length) return;
  const fs = W * LAYOUT.font, m = W * LAYOUT.margin;
  let y = m;
  for (const b of blocks) {
    const isH = b.type === 'h', size = isH ? fs * 1.5 : fs, lh = size * LAYOUT.lh;
    ctx.font = (isH ? '700 ' : '400 ') + size + 'px -apple-system, system-ui, sans-serif';
    const rows = isH || b.type === 'p' ? [{ t: b.text || '' }] : (b.items || []);
    const ind = b.type === 'ul' || b.type === 'todo' ? fs * 1.4 : 0;
    for (const row of rows) {
      wrapText(ctx, row.t || '', W - 2 * m - ind).forEach((ln, i) => {
        y += lh; if (y > H) return;
        const base = y - lh * 0.25;
        ctx.fillStyle = ctx.strokeStyle = row.done ? '#8c8580' : '#2B2623';
        if (i === 0 && b.type === 'ul') ctx.fillText('•', m + fs * 0.3, base);
        if (i === 0 && b.type === 'todo') {
          const s = fs * 0.8; ctx.lineWidth = Math.max(1, fs * 0.07);
          ctx.strokeRect(m + fs * 0.1, base - s * 0.9, s, s);
          if (row.done) ctx.fillRect(m + fs * 0.1, base - s * 0.9, s, s);
        }
        ctx.fillText(ln, m + ind, base);
      });
    }
    y += fs * LAYOUT.gap;
  }
}
async function paintImages(ctx, images, W) {
  for (const im of images || []) {
    try {
      const b = await D.get('blobs', im.blob); if (!b) continue;
      const bmp = await createImageBitmap(new Blob([b.data], { type: b.mime }));
      const w = im.w * W;
      ctx.drawImage(bmp, im.x * W, im.y * W, w, w * im.ar);
      if (bmp.close) bmp.close();
    } catch { /* immagine illeggibile */ }
  }
}

// ---------- Miniature (copertine e barra pagine): salvate in IndexedDB, rifatte solo se la pagina cambia ----------
const TW = 320;
const thumbMem = new Map(); // id pagina -> { u: updated, url }
async function renderThumb(rec) {
  const w = TW, h = Math.round(w * (rec.aspect || LAYOUT.a4));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  try {
    if (rec.type === 'pdf') {
      const pdf = await getPdf(rec.blob);
      const page = await pdf.getPage(rec.pdfPage + 1);
      const vp = page.getViewport({ scale: w / page.getViewport({ scale: 1 }).width });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
    } else paintPattern(ctx, rec.type, w, h, 1);
    await paintImages(ctx, rec.images, w);
    paintBlocks(ctx, rec.blocks, w, h);
    for (const st of rec.strokes || []) drawStroke(ctx, st, w, h);
    return cv.toDataURL('image/jpeg', 0.84);
  } catch (e) {
    if (e && e.name !== 'NoData') console.warn('miniatura', e);
    return null;
  } finally { cv.width = 0; cv.height = 0; }
}
async function thumbUrl(rec) {
  const m = thumbMem.get(rec.id);
  if (m && m.u === rec.updated) return m.url;
  const saved = await D.getMeta('th:' + rec.id).catch(() => null);
  if (saved && saved.u === rec.updated) { thumbMem.set(rec.id, saved); return saved.url; }
  const url = await renderThumb(rec);
  if (!url) return null;
  const v = { u: rec.updated, url };
  thumbMem.set(rec.id, v);
  D.setMeta('th:' + rec.id, v).catch(() => {});
  return url;
}
const thumbQueue = []; let thumbBusy = false;
function thumbLater(rec, img) {
  thumbQueue.push({ rec, img });
  if (thumbBusy) return;
  thumbBusy = true;
  setTimeout(async () => { // dopo: l'immagine deve essere già nella pagina
    while (thumbQueue.length) {
      const t = thumbQueue.shift();
      if (!t.img.isConnected) continue;
      const url = await thumbUrl(t.rec);
      if (url && t.img.isConnected) { t.img.src = url; t.img.classList.add('ok'); }
    }
    thumbBusy = false;
    if (notebook.hidden) releasePdfs();
  }, 0);
}

// ---------- Libreria ----------
const lib = { cwd: null };
const newNbCard = $('btn-new-nb');
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
async function refreshLibrary() {
  const nodes = (await D.all('nodes')).filter((n) => !n.deleted);
  const pages = (await D.all('pages')).filter((p) => !p.deleted);
  if (lib.cwd && !nodes.find((n) => n.id === lib.cwd)) lib.cwd = null;
  const count = {}, firstPage = {}, lastMod = {};
  for (const p of pages) {
    count[p.nb] = (count[p.nb] || 0) + 1;
    if (!firstPage[p.nb] || p.order < firstPage[p.nb].order) firstPage[p.nb] = p;
    lastMod[p.nb] = Math.max(lastMod[p.nb] || 0, p.updated || 0);
  }
  const kids = {};
  for (const n of nodes) if (n.parent) kids[n.parent] = (kids[n.parent] || 0) + 1;

  // titolo e percorso (solo dentro una cartella)
  const crumbs = $('crumbs'); crumbs.textContent = '';
  const path = [];
  for (let c = lib.cwd; c;) { const n = nodes.find((x) => x.id === c); if (!n) break; path.unshift(n); c = n.parent; }
  crumbs.hidden = !path.length;
  if (path.length) {
    const root = el('button', 'crumb'); root.type = 'button'; root.append(icon('back'), el('span', '', 'Quaderni'));
    root.onclick = () => { lib.cwd = null; refreshLibrary(); };
    crumbs.append(root);
    for (const n of path.slice(0, -1)) {
      crumbs.append(el('span', 'crumb-sep', '/'));
      const b = el('button', 'crumb', n.name); b.type = 'button'; b.onclick = () => { lib.cwd = n.id; refreshLibrary(); }; crumbs.append(b);
    }
  }
  $('lib-title').textContent = path.length ? path[path.length - 1].name : 'I miei quaderni';

  const items = nodes.filter((n) => (n.parent || null) === lib.cwd).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const folders = items.filter((n) => n.kind === 'folder'), nbs = items.filter((n) => n.kind !== 'folder');
  const fgrid = $('folder-grid'); fgrid.textContent = '';
  $('sec-folders').hidden = !folders.length;
  $('nbs-title').hidden = !folders.length;
  for (const n of folders) {
    const card = el('div', 'card folder'); card.dataset.id = n.id;
    const cover = el('button', 'cover'); cover.type = 'button'; cover.setAttribute('aria-label', 'Apri ' + n.name);
    cover.style.background = alpha(n.color, 0.16); cover.style.color = n.color;
    cover.append(icon('folder'));
    const open = () => { lib.cwd = n.id; refreshLibrary(); };
    cover.onclick = open;
    const info = el('div', 'info'), tx = el('div', 'txt');
    tx.append(el('b', '', n.name), el('span', 'meta', plural(kids[n.id] || 0, 'elemento', 'elementi')));
    tx.onclick = open;
    const more = el('button', 'more'); more.type = 'button'; more.append(icon('more')); more.setAttribute('aria-label', 'Opzioni di ' + n.name);
    more.onclick = () => nodeMenu(n, nodes);
    info.append(tx, more); card.append(cover, info); fgrid.append(card);
  }
  const grid = $('lib-grid'); grid.textContent = '';
  grid.append(newNbCard);
  $('lib-empty').hidden = items.length > 0;
  for (const n of nbs) {
    const card = el('div', 'card'); card.dataset.id = n.id;
    const cover = el('button', 'cover'); cover.type = 'button'; cover.setAttribute('aria-label', 'Apri ' + n.name);
    cover.style.background = n.color;
    const sheet = el('span', 'sheet'), img = el('img'); img.alt = ''; img.draggable = false;
    sheet.append(img); cover.append(sheet);
    if (firstPage[n.id]) thumbLater(firstPage[n.id], img);
    cover.onclick = () => openNotebook(n.id);
    const info = el('div', 'info'), tx = el('div', 'txt');
    tx.append(el('b', '', n.name), el('span', 'meta', plural(count[n.id] || 0, 'pagina', 'pagine') + ' · ' + fmtDate(Math.max(n.updated, lastMod[n.id] || 0))));
    tx.onclick = () => openNotebook(n.id);
    const more = el('button', 'more'); more.type = 'button'; more.append(icon('more')); more.setAttribute('aria-label', 'Opzioni di ' + n.name);
    more.onclick = () => nodeMenu(n, nodes);
    info.append(tx, more); card.append(cover, info); grid.append(card);
  }
  if ($('search').value.trim()) runSearch();
}

async function nodeMenu(n, nodes) {
  const r = await modal({ title: n.name, options: [
    { label: 'Apri', value: 'open', icon: 'open' }, { label: 'Rinomina', value: 'rename', icon: 'edit' },
    { label: 'Cambia colore', value: 'color', icon: 'palette' }, { label: 'Sposta in…', value: 'move', icon: 'move' },
    { label: 'Elimina', value: 'del', danger: true, icon: 'trash' }] });
  if (!r) return;
  if (r.value === 'open') return n.kind === 'folder' ? (lib.cwd = n.id, refreshLibrary()) : openNotebook(n.id);
  if (r.value === 'rename') {
    const q = await modal({ title: 'Rinomina', input: n.name, options: [{ label: 'Salva', value: 'ok', accent: true }] });
    if (q && q.text.trim()) { n.name = q.text.trim(); await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'color') {
    const q = await modal({ title: 'Colore della copertina', options: D.COLORS.map((c) => ({ color: c, label: c, value: c, current: c === n.color })) });
    if (q) { n.color = q.value; await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'move') {
    const bad = new Set([n.id]);
    for (let grow = true; grow;) { grow = false; for (const x of nodes) if (x.parent && bad.has(x.parent) && !bad.has(x.id)) { bad.add(x.id); grow = true; } }
    const folders = nodes.filter((x) => x.kind === 'folder' && !bad.has(x.id));
    const q = await modal({ title: 'Sposta “' + n.name + '” in…', options: [{ label: 'I miei quaderni (principale)', value: '', icon: 'book' }, ...folders.map((f) => ({ label: f.name, value: f.id, icon: 'folder' }))] });
    if (q) { n.parent = q.value || null; await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'del') {
    if (await confirmDlg('Eliminare “' + n.name + '”?', n.kind === 'folder' ? 'Verrà eliminato anche tutto quello che contiene.' : 'Il quaderno e le sue pagine verranno eliminati (anche da OneDrive).')) {
      await D.deleteNode(n); Sync.requestSync(); refreshLibrary();
    }
  }
}

const PAPERS = [{ paper: 'lined', label: 'Righe', value: 'lined' }, { paper: 'grid', label: 'Quadretti', value: 'grid' }, { paper: 'blank', label: 'Foglio bianco', value: 'blank' }];
$('btn-new-nb').onclick = async () => {
  const r = await modal({ title: 'Nuovo quaderno', text: 'Dai un nome e scegli il tipo di pagina.', input: 'Nuovo quaderno', options: PAPERS });
  if (!r) return;
  const n = await D.newNode('notebook', r.text.trim() || 'Nuovo quaderno', lib.cwd);
  await D.put('pages', D.blankPage(n.id, 0, r.value));
  Sync.requestSync();
  openNotebook(n.id);
};
$('btn-new-folder').onclick = async () => {
  const r = await modal({ title: 'Nuova cartella', input: 'Nuova cartella', options: [{ label: 'Crea', value: 'ok', accent: true }] });
  if (!r) return;
  await D.newNode('folder', r.text.trim() || 'Nuova cartella', lib.cwd);
  Sync.requestSync(); refreshLibrary();
};
$('pdf-input').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  toast('Apro “' + f.name + '”…', 0);
  try {
    const buf = await readFile(f);
    const n = await D.newNode('notebook', f.name.replace(/\.pdf$/i, ''), lib.cwd);
    try { await addPdfPages(n.id, buf, f.name, (i) => i); } catch (err) { await D.deleteNode(n); throw err; }
    Sync.requestSync(); toast('');
    await openNotebook(n.id);
  } catch (err) { toast(''); showError('Il PDF non si apre', err); refreshLibrary(); }
};
// crea una pagina per ogni pagina del PDF; order(i, n) decide la posizione
async function addPdfPages(nbId, buf, name, order) {
  const asp = await pdfAspects(buf);
  const blob = await D.addBlob(buf, 'application/pdf', name);
  const recs = [];
  for (let i = 0; i < asp.length; i++) {
    const p = D.blankPage(nbId, order(i, asp.length), 'pdf', { blob: blob.id, pdfPage: i, aspect: asp[i] });
    await D.put('pages', p); recs.push(p);
  }
  return recs;
}

// ---------- Ricerca ----------
function highlight(text, q) {
  const f = document.createDocumentFragment();
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) { f.append(text); return f; }
  f.append(text.slice(0, i)); f.append(el('mark', '', text.slice(i, i + q.length))); f.append(text.slice(i + q.length));
  return f;
}
const blockText = (b) => (b.type === 'ul' || b.type === 'todo' ? (b.items || []).map((i) => i.t).join(' · ') : b.text || '');
async function runSearch() {
  const q = $('search').value.trim();
  const res = $('results');
  const on = q.length > 0;
  res.hidden = !on; $('lib-content').hidden = on;
  if (!on) { refreshLibrary(); return; }
  const nodes = (await D.all('nodes')).filter((n) => !n.deleted);
  const pages = (await D.all('pages')).filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
  const low = q.toLowerCase();
  res.textContent = '';
  const hit = (ic, title, sub, fn) => {
    const li = el('li'), b = el('button', 'hit'); b.type = 'button';
    const t = el('span', 't'); t.append(title);
    const tx = el('span', 'tx'); tx.append(t, el('span', 's', sub));
    b.append(icon(ic), tx, icon('chev', 'ic go')); b.onclick = fn;
    li.append(b); res.append(li);
  };
  let n = 0;
  for (const nd of nodes) {
    if (!nd.name.toLowerCase().includes(low)) continue;
    n++;
    hit(nd.kind === 'folder' ? 'folder' : 'book', highlight(nd.name, q), nd.kind === 'folder' ? 'Cartella' : 'Quaderno',
      () => (nd.kind === 'folder' ? (lib.cwd = nd.id, $('search').value = '', runSearch()) : openNotebook(nd.id)));
  }
  for (const p of pages) {
    const nd = nodes.find((x) => x.id === p.nb);
    if (!nd) continue;
    const idx = pages.filter((x) => x.nb === p.nb).indexOf(p) + 1;
    for (const bl of p.blocks || []) {
      const tx = blockText(bl);
      if (!tx.toLowerCase().includes(low)) continue;
      n++;
      hit('para', highlight(tx.length > 90 ? tx.slice(0, 90) + '…' : tx, q), nd.name + ' · pagina ' + idx, () => openNotebook(nd.id, p.id));
      break;
    }
  }
  if (!n) res.append(el('li', 'none', 'Nessun risultato. La scrittura a mano non si può cercare.'));
}
let searchTimer;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });

// ---------- Quaderno aperto ----------
const PALETTE = {
  pen: [['#1a1a1a', 'Nero'], ['#5f6368', 'Grafite'], ['#1f5fd1', 'Blu'], ['#0f7b8a', 'Petrolio'], ['#2a9d4a', 'Verde'], ['#d62828', 'Rosso'], ['#C2664A', 'Terracotta'], ['#7b3fb0', 'Viola']],
  hl: [['#f5c400', 'Giallo'], ['#7fd35b', 'Verde'], ['#4fc3f7', 'Azzurro'], ['#ff7eb6', 'Rosa'], ['#ff9f43', 'Arancio'], ['#b388ff', 'Lilla'], ['#ff5252', 'Rosso'], ['#a0a0a0', 'Grigio']],
};
const S = { tool: 'pen', pen: { color: '#1a1a1a', size: 3 }, hl: { color: '#f5c400', size: 3, alpha: HL_ALPHA } };
try { const saved = JSON.parse(localStorage.getItem('penna.tools') || 'null'); if (saved) { Object.assign(S.pen, saved.pen); Object.assign(S.hl, saved.hl); } } catch {}
const saveTools = () => { try { localStorage.setItem('penna.tools', JSON.stringify({ pen: S.pen, hl: S.hl })); } catch {} };
const cfg = () => S[S.tool === 'hl' ? 'hl' : 'pen'];
const nb = { node: null, pages: [], zoom: 1, undo: [], redo: [], drawing: 0 };

async function openNotebook(id, focusPageId) {
  const node = await D.get('nodes', id);
  if (!node || node.deleted) return;
  if (nb.node) await flush();
  nb.node = node; nb.zoom = 1; nb.undo = []; nb.redo = []; updateUndoButtons();
  closePop();
  library.hidden = true; notebook.hidden = false;
  setSide(wide() && localStorage.getItem('penna.side') === '1', false);
  await buildPages();
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  if (focusPageId) { const p = nb.pages.find((x) => x.rec.id === focusPageId); if (p) viewer.scrollTop = p.wrap.offsetTop - topGap(); }
  updatePageIndicator();
}
const topGap = () => parseFloat(getComputedStyle(pagesEl).paddingTop) - 8;

function teardownPages() {
  for (const p of nb.pages) { observer.unobserve(p.wrap); if (p.task) { try { p.task.cancel(); } catch {} } freeCanvas(p.bg); freeCanvas(p.draw); }
  nb.pages = []; pagesEl.textContent = '';
}
async function buildPages() {
  teardownPages();
  const recs = await D.pagesOf(nb.node.id);
  for (const rec of recs) {
    const wrap = el('div', 'page'); wrap.dataset.id = rec.id;
    const bg = el('canvas', 'bg'), imgs = el('div', 'imgs'), txt = el('div', 'txt'), draw = el('canvas', 'draw');
    bg.width = bg.height = draw.width = draw.height = 0;
    wrap.append(bg, imgs, txt, draw);
    pagesEl.append(wrap);
    const p = { rec, wrap, bg, imgs, txt, draw, aspect: rec.aspect || LAYOUT.a4, rendered: false, task: null, cw: 0, ch: 0, W: 0, H: 0 };
    nb.pages.push(p);
    wrap.classList.toggle('textmode', S.tool === 'text');
    renderText(p); renderImages(p); attachDrawing(p);
  }
  layout();
  renderSidebar();
}
function fitWidth() {
  const cs = getComputedStyle(pagesEl);
  return Math.max(200, Math.min(1100, viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
}
function layout() {
  const w = fitWidth() * nb.zoom;
  for (const p of nb.pages) {
    p.cw = w; p.ch = w * p.aspect;
    p.wrap.style.width = w + 'px'; p.wrap.style.height = p.ch + 'px';
    p.wrap.style.fontSize = (w * LAYOUT.font) + 'px';
    p.rendered = false;
    observer.unobserve(p.wrap); observer.observe(p.wrap);
    growAll(p);
  }
}
const observer = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const p = nb.pages.find((x) => x.wrap === en.target);
    if (!p) continue;
    if (en.isIntersecting) renderPage(p); else releasePage(p);
  }
}, { root: viewer, rootMargin: (IOS ? 700 : 1200) + 'px 0px' });

// limite di pixel per canvas: iPad/iPhone hanno poca memoria per i canvas (oltre, le pagine restano bianche)
const MAX_PIXELS = IOS ? 5e6 : 9e6;
function pixelRatio(p) { return Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (p.cw * p.ch))); }
function freeCanvas(c) { if (c && c.width) { c.width = 0; c.height = 0; } }
// il canvas dei tratti esiste solo se serve (pagine senza scrittura = metà memoria)
function ensureDraw(p) {
  if (p.draw.width || !p.W) return;
  p.draw.width = p.W; p.draw.height = p.H;
}

async function renderPage(p) {
  if (p.rendered) return;
  p.rendered = true;
  if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
  const r = pixelRatio(p);
  p.W = Math.round(p.cw * r); p.H = Math.round(p.ch * r);
  freeCanvas(p.draw);
  if (p.rec.strokes.length) { ensureDraw(p); redrawPage(p); }
  if (p.rec.type !== 'pdf') {
    p.bg.width = p.W; p.bg.height = p.H;
    paintPattern(p.bg.getContext('2d'), p.rec.type, p.W, p.H, Math.max(1, r * 0.8));
    p.wrap.dataset.rendered = '1';
    return;
  }
  let off = null;
  try {
    const pdf = await getPdf(p.rec.blob);
    const page = await pdf.getPage(p.rec.pdfPage + 1);
    if (!p.rendered) return;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (p.cw / base.width) * r });
    off = document.createElement('canvas'); off.className = 'bg';
    off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('memoria grafica esaurita (troppe pagine aperte)');
    const task = page.render({ canvas: off, canvasContext: ctx, viewport: vp });
    p.task = task;
    await task.promise;
    if (p.task !== task || !p.rendered) { freeCanvas(off); return; }
    p.task = null;
    // sostituisco il canvas vecchio solo a lavoro finito: niente pagina bianca durante lo zoom
    const old = p.bg; p.wrap.replaceChild(off, old); freeCanvas(old); p.bg = off; off = null;
    p.wrap.dataset.rendered = '1'; p.wrap.classList.remove('err');
  } catch (e) {
    freeCanvas(off);
    p.rendered = false;
    if (e && /RenderingCancelled/.test(e.name || '')) return;
    if (e && e.name === 'NoData') { p.wrap.dataset.msg = 'Il PDF arriva da OneDrive…'; p.wrap.classList.add('err'); return; }
    p.wrap.dataset.msg = 'Questa pagina non si riesce a mostrare'; p.wrap.classList.add('err');
    showError('Pagina ' + (nb.pages.indexOf(p) + 1) + ' non visualizzata', e);
  }
}
function releasePage(p) {
  p.rendered = false;
  if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
  freeCanvas(p.bg); freeCanvas(p.draw);
  delete p.wrap.dataset.rendered;
}

function currentPage() {
  const mid = viewer.scrollTop + viewer.clientHeight / 2;
  let cur = nb.pages[0];
  for (const p of nb.pages) { if (p.wrap.offsetTop <= mid) cur = p; else break; }
  return cur;
}
let lastCur = null;
function updatePageIndicator() {
  if (!nb.pages.length) { $('page-ind').textContent = ''; return; }
  const cur = currentPage();
  $('page-ind').textContent = (nb.pages.indexOf(cur) + 1) + ' / ' + nb.pages.length;
  if (cur !== lastCur) {
    lastCur = cur;
    document.querySelectorAll('#page-list li').forEach((li, i) => li.classList.toggle('cur', nb.pages[i] === cur));
  }
}
viewer.addEventListener('scroll', updatePageIndicator, { passive: true });

// ---------- Barra laterale (pagine) ----------
const wide = () => innerWidth >= 900;
function setSide(open, remember = true) {
  notebook.classList.toggle('side-open', open);
  if (remember && wide()) { try { localStorage.setItem('penna.side', open ? '1' : '0'); } catch {} }
  if (open) observeSideThumbs();
  if (wide() && nb.pages.length) {
    const p = currentPage(), off = p ? viewer.scrollTop - p.wrap.offsetTop : 0;
    layout(); if (p) viewer.scrollTop = p.wrap.offsetTop + off * nb.pages[0].cw / (p.cw || 1);
  }
}
$('btn-pages').onclick = () => setSide(!notebook.classList.contains('side-open'));
function pageLabel(p) {
  const h = (p.rec.blocks || []).find((b) => b.type === 'h' && b.text);
  return h ? h.text : TYPE_LABEL[p.rec.type] + (p.rec.type === 'pdf' ? ' · pag. ' + (p.rec.pdfPage + 1) : '');
}
const sideObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    sideObserver.unobserve(en.target);
    const p = nb.pages[+en.target.dataset.i];
    if (p) thumbLater(p.rec, en.target);
  }
}, { root: $('page-list'), rootMargin: '400px 0px' });
function observeSideThumbs() {
  document.querySelectorAll('#page-list img.th:not(.seen)').forEach((img) => { img.classList.add('seen'); sideObserver.observe(img); });
}
function renderSidebar() {
  $('side-title').textContent = nb.node.name;
  $('side-count').textContent = plural(nb.pages.length, 'pagina', 'pagine');
  const ol = $('page-list'); ol.textContent = ''; lastCur = null;
  nb.pages.forEach((p, i) => {
    const li = el('li');
    const go = el('button', 'go'); go.type = 'button'; go.title = pageLabel(p);
    const img = el('img', 'th'); img.alt = ''; img.draggable = false; img.dataset.i = i; img.style.aspectRatio = String(1 / (p.rec.aspect || LAYOUT.a4));
    go.append(img, el('span', 'num', String(i + 1)));
    go.onclick = () => { viewer.scrollTo({ top: p.wrap.offsetTop - topGap() }); if (!wide()) setSide(false); };
    const mk = (ic, label, fn, dis) => { const b = el('button', 'mini'); b.type = 'button'; b.append(icon(ic)); b.setAttribute('aria-label', label); b.title = label; b.disabled = !!dis; b.onclick = fn; return b; };
    const acts = el('div', 'acts');
    acts.append(mk('up', 'Sposta su', () => movePage(i, -1), i === 0), mk('down', 'Sposta giù', () => movePage(i, 1), i === nb.pages.length - 1), mk('trash', 'Elimina pagina', () => removePage(i)));
    li.append(go, acts); ol.append(li);
  });
  if (notebook.classList.contains('side-open')) observeSideThumbs();
  updatePageIndicator();
}
// dopo un salvataggio aggiorno la miniatura della pagina nella barra (se è aperta)
let sideTimer;
function refreshSideThumbs(recs) {
  clearTimeout(sideTimer);
  sideTimer = setTimeout(() => {
    if (!notebook.classList.contains('side-open')) return;
    for (const r of recs) { const i = nb.pages.findIndex((p) => p.rec === r); const img = document.querySelector(`#page-list img.th[data-i="${i}"]`); if (img) thumbLater(r, img); }
  }, 600);
}
async function movePage(i, d) {
  await flush();
  const a = nb.pages[i].rec, b = nb.pages[i + d].rec;
  [a.order, b.order] = [b.order, a.order];
  await D.savePage(a); await D.savePage(b);
  Sync.requestSync();
  const top = viewer.scrollTop;
  await buildPages(); viewer.scrollTop = top;
}
async function removePage(i) {
  if (nb.pages.length <= 1) { toast('Un quaderno deve avere almeno una pagina.'); return; }
  if (!(await confirmDlg('Eliminare la pagina ' + (i + 1) + '?', 'Scrittura, testi e immagini di questa pagina andranno persi.'))) return;
  await flush();
  await D.deletePage(nb.pages[i].rec);
  Sync.requestSync();
  nb.undo = []; nb.redo = []; updateUndoButtons();
  const top = viewer.scrollTop;
  await buildPages(); viewer.scrollTop = top;
}

$('btn-add-page').onclick = async () => {
  const r = await modal({ title: 'Aggiungi pagina', text: 'Viene inserita dopo la pagina che stai guardando.', options: [
    { paper: 'blank', label: 'Foglio bianco', value: 'blank' }, { paper: 'lined', label: 'Righe', value: 'lined' }, { paper: 'grid', label: 'Quadretti', value: 'grid' },
    { label: 'Importa un PDF…', file: 'application/pdf,.pdf', value: 'pdf', icon: 'import' }] });
  if (!r) return;
  await flush();
  const cur = nb.pages.indexOf(currentPage());
  const lo = nb.pages[cur].rec.order, hi = nb.pages[cur + 1] ? nb.pages[cur + 1].rec.order : lo + 2;
  const order = (i, n) => lo + (hi - lo) * (i + 1) / (n + 1);
  try {
    if (r.value === 'pdf') { toast('Importo il PDF…', 0); await addPdfPages(nb.node.id, await readFile(r.file), r.file.name, order); toast(''); }
    else await D.put('pages', D.blankPage(nb.node.id, order(0, 1), r.value));
  } catch (e) { toast(''); showError('Il PDF non si apre', e); return; }
  Sync.requestSync();
  await buildPages();
  const added = nb.pages[cur + 1]; if (added) viewer.scrollTo({ top: added.wrap.offsetTop - topGap() });
  if (!wide()) setSide(false);
};

// ---------- Testo ----------
function growTa(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function growAll(p) { p.txt.querySelectorAll('textarea').forEach(growTa); }
function renderText(p) {
  p.txt.textContent = '';
  for (const b of p.rec.blocks) p.txt.append(blockEl(p, b));
}
function blockEl(p, b) {
  const box = el('div', 'blk ' + b.type); box.dataset.id = b.id;
  const x = el('button', 'x'); x.type = 'button'; x.append(icon('close')); x.setAttribute('aria-label', 'Elimina blocco');
  x.onclick = () => { p.rec.blocks = p.rec.blocks.filter((q) => q !== b); box.remove(); queueSave(p.rec); renderSidebar(); };
  box.append(x);
  if (b.type === 'h' || b.type === 'p') {
    const ta = el('textarea'); ta.rows = 1; ta.value = b.text || '';
    ta.placeholder = b.type === 'h' ? 'Titolo' : 'Scrivi qui…';
    ta.oninput = () => { b.text = ta.value; growTa(ta); queueSave(p.rec); };
    if (b.type === 'h') ta.onchange = () => renderSidebar();
    box.append(ta);
  } else {
    const list = el('div');
    const mkRow = (item) => {
      const row = el('div', 'row' + (item.done ? ' done' : ''));
      if (b.type === 'ul') row.append(el('span', 'dot', '•'));
      else {
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!item.done;
        cb.onchange = () => { item.done = cb.checked; row.classList.toggle('done', cb.checked); queueSave(p.rec); };
        row.append(cb);
      }
      const inp = el('input'); inp.type = 'text'; inp.value = item.t || ''; inp.placeholder = 'Voce';
      inp.oninput = () => { item.t = inp.value; queueSave(p.rec); };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const ni = { t: '', done: false };
          b.items.splice(b.items.indexOf(item) + 1, 0, ni);
          const nr = mkRow(ni); row.after(nr); nr.querySelector('input[type=text]').focus(); queueSave(p.rec);
        } else if (e.key === 'Backspace' && !inp.value && b.items.length > 1) {
          e.preventDefault();
          const prev = row.previousElementSibling || row.nextElementSibling;
          b.items.splice(b.items.indexOf(item), 1); row.remove();
          if (prev) prev.querySelector('input[type=text]').focus();
          queueSave(p.rec);
        }
      };
      row.append(inp);
      return row;
    };
    for (const it of b.items) list.append(mkRow(it));
    box.append(list);
  }
  return box;
}
document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.onclick = () => {
    const p = currentPage(); if (!p) return;
    const type = btn.dataset.add;
    const b = type === 'ul' || type === 'todo' ? { id: D.uid(), type, items: [{ t: '', done: false }] } : { id: D.uid(), type, text: '' };
    p.rec.blocks.push(b);
    const be = blockEl(p, b); p.txt.append(be); growAll(p);
    queueSave(p.rec);
    const f = be.querySelector('textarea, input[type=text]'); if (f) f.focus();
  };
});

// ---------- Immagini ----------
async function renderImages(p) {
  p.imgs.textContent = '';
  for (const im of p.rec.images) {
    const w = el('div', 'imw'); w.dataset.id = im.id;
    const img = el('img'); img.draggable = false; img.alt = '';
    w.append(img);
    const x = el('button', 'x'); x.type = 'button'; x.append(icon('close')); x.setAttribute('aria-label', 'Elimina immagine');
    x.onclick = () => { p.rec.images = p.rec.images.filter((q) => q !== im); w.remove(); queueSave(p.rec); };
    const rz = el('div', 'rz');
    w.append(x, rz);
    placeImg(p, im, w);
    p.imgs.append(w);
    blobUrl(im.blob).then((u) => { if (u) img.src = u; });
    let drag = null;
    const start = (mode) => (e) => {
      if (S.tool !== 'text') return;
      e.preventDefault(); e.stopPropagation();
      drag = { mode, x: e.clientX, y: e.clientY, ox: im.x, oy: im.y, ow: im.w, id: e.pointerId };
      e.target.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = (e.clientX - drag.x) / p.cw, dy = (e.clientY - drag.y) / p.cw;
      if (drag.mode === 'move') { im.x = Math.max(0, Math.min(1 - im.w, drag.ox + dx)); im.y = Math.max(0, drag.oy + dy); }
      else im.w = Math.max(0.08, Math.min(1 - im.x, drag.ow + dx));
      placeImg(p, im, w);
    };
    const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; queueSave(p.rec); } };
    img.addEventListener('pointerdown', start('move')); rz.addEventListener('pointerdown', start('resize'));
    for (const t of [img, rz]) { t.addEventListener('pointermove', move); t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end); }
  }
}
function placeImg(p, im, w) {
  w.style.left = im.x * 100 + '%'; w.style.top = (im.y / p.aspect) * 100 + '%'; w.style.width = im.w * 100 + '%';
}
async function normalizeImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const png = file.type === 'image/png';
  const blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.85));
  const out = { data: await blob.arrayBuffer(), mime: png ? 'image/png' : 'image/jpeg', ar: c.height / c.width };
  freeCanvas(c);
  return out;
}
async function insertImage(file) {
  const p = currentPage(); if (!p) return;
  try {
    const n = await normalizeImage(file);
    const blob = await D.addBlob(n.data, n.mime, 'immagine');
    p.rec.images.push({ id: D.uid(), blob: blob.id, x: 0.1, y: 0.1, w: 0.5, ar: n.ar });
    await renderImages(p); queueSave(p.rec);
    if (S.tool !== 'text') toast('Per spostare l’immagine scegli lo strumento Testo');
  } catch (e) { showError('Immagine non inserita', e); }
}
$('img-input').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await insertImage(f); };
document.addEventListener('paste', (e) => {
  if (notebook.hidden) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); insertImage(f); }
});

// ---------- Zoom a pizzico ----------
let pinch = null;
viewer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    const rect = viewer.getBoundingClientRect();
    const cx = (a.clientX + b.clientX) / 2 - rect.left, cy = (a.clientY + b.clientY) / 2 - rect.top;
    pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: nb.zoom, ratio: 1, cx, cy,
      fx: viewer.scrollLeft + cx - pagesEl.offsetLeft, fy: viewer.scrollTop + cy - pagesEl.offsetTop };
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
  nb.zoom = Math.min(5, Math.max(0.5, nb.zoom * ratio));
  layout();
  viewer.scrollLeft = fx * ratio - cx + pagesEl.offsetLeft;
  viewer.scrollTop = fy * ratio - cy + pagesEl.offsetTop;
}
viewer.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); }, { passive: true });
viewer.addEventListener('touchcancel', endPinch, { passive: true });
let resizeTimer;
window.addEventListener('resize', () => {
  closePop();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (nb.pages.length && !notebook.hidden) layout(); }, 120);
});

// ---------- Disegno ----------
const widthFactor = (t) => (t === 'hl' ? 0.005 : 0.0007);

function drawStroke(ctx, stroke, W, H) {
  const pts = stroke.pts;
  if (!pts.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.c; ctx.fillStyle = stroke.c;
  if (stroke.t === 'hl') {
    ctx.globalAlpha = stroke.a ?? HL_ALPHA;
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
  ctx.strokeStyle = stroke.c; ctx.lineCap = 'round';
  ctx.lineWidth = stroke.w * W * (a[2] + b[2]) / 2;
  ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(b[0] * W, b[1] * H); ctx.stroke();
}
function redrawPage(p, extra) {
  const c = p.draw;
  if (!c.width) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of p.rec.strokes) drawStroke(ctx, s, c.width, c.height);
  if (extra) drawStroke(ctx, extra, c.width, c.height);
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function hitStroke(s, x, y, rx, aspect) {
  const pts = s.pts, r = rx + (s.w * (s.t === 'hl' ? 1 : 1.2)) / 2;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, (pts[0][1] - y) * aspect) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y * aspect, pts[i - 1][0], pts[i - 1][1] * aspect, pts[i][0], pts[i][1] * aspect) <= r) return true;
  }
  return false;
}
function factor(e) {
  if (e.pointerType !== 'pen' || S.tool === 'hl') return 1;
  const pr = e.pressure > 0 ? e.pressure : 0.5;
  return 0.3 + 1.4 * pr;
}
function attachDrawing(p) {
  const c = p.draw;
  let cur = null, erased = null, pid = null;
  const norm = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const allowed = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse';
  // Apple Pencil: blocco lo scorrimento e Scribble mentre si scrive sulla pagina
  c.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
  }, { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('pointerdown', (e) => {
    if (S.tool === 'text' || !allowed(e) || pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (!pop.hidden) closePop();
    pid = e.pointerId; nb.drawing = 1;
    try { c.setPointerCapture(pid); } catch {}
    const [x, y] = norm(e);
    if (S.tool === 'eraser') { erased = []; eraseAt(p, x, y, erased); return; }
    ensureDraw(p);
    const o = cfg();
    cur = { t: S.tool, c: o.color, w: o.size * widthFactor(S.tool), pts: [[x, y, factor(e)]] };
    if (S.tool === 'hl') cur.a = o.alpha;
    redrawPage(p, cur);
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = norm(ev);
      if (S.tool === 'eraser') { eraseAt(p, x, y, erased); continue; }
      if (!cur) continue;
      const last = cur.pts[cur.pts.length - 1];
      if (Math.abs(last[0] - x) * p.cw < 0.4 && Math.abs(last[1] - y) * p.ch < 0.4) continue;
      const pt = [x, y, factor(ev)];
      cur.pts.push(pt);
      if (cur.t === 'pen' && c.width) drawSegment(c.getContext('2d'), cur, last, pt, c.width, c.height);
    }
    if (cur && cur.t === 'hl') redrawPage(p, cur);
  });
  const finish = (e) => {
    if (e.pointerId !== pid) return;
    pid = null; nb.drawing = 0;
    try { c.releasePointerCapture(e.pointerId); } catch {}
    if (S.tool === 'eraser') {
      if (erased && erased.length) { queueSave(p.rec); pushAction({ type: 'del', items: erased }); }
      erased = null; return;
    }
    if (!cur) return;
    const s = cur; cur = null;
    if (e.type === 'pointercancel') { redrawPage(p); return; }
    p.rec.strokes.push(s);
    pushAction({ type: 'add', pid: p.rec.id, stroke: s });
    redrawPage(p);
    queueSave(p.rec);
  };
  c.addEventListener('pointerup', finish);
  c.addEventListener('pointercancel', finish);
}
function eraseAt(p, x, y, erased) {
  const list = p.rec.strokes;
  if (!list.length || !erased) return;
  const rx = S.pen.size * 0.004;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitStroke(list[i], x, y, rx, p.aspect)) { erased.push({ pid: p.rec.id, stroke: list[i], index: i }); list.splice(i, 1); changed = true; }
  }
  if (changed) redrawPage(p);
}

// ---------- Annulla / Ripeti ----------
const pageById = (id) => nb.pages.find((p) => p.rec.id === id);
function pushAction(a) { nb.undo.push(a); nb.redo = []; updateUndoButtons(); }
function updateUndoButtons() { $('btn-undo').disabled = !nb.undo.length; $('btn-redo').disabled = !nb.redo.length; }
function applyUndo(a) {
  if (a.type === 'add') {
    const p = pageById(a.pid); if (!p) return;
    const i = p.rec.strokes.indexOf(a.stroke); if (i >= 0) p.rec.strokes.splice(i, 1);
    redrawPage(p); queueSave(p.rec);
  } else {
    for (const it of [...a.items].sort((x, y) => x.index - y.index)) { const p = pageById(it.pid); if (p) p.rec.strokes.splice(it.index, 0, it.stroke); }
    for (const id of new Set(a.items.map((it) => it.pid))) { const p = pageById(id); if (p) { ensureDraw(p); redrawPage(p); queueSave(p.rec); } }
  }
}
function applyRedo(a) {
  if (a.type === 'add') {
    const p = pageById(a.pid); if (!p) return;
    p.rec.strokes.push(a.stroke); ensureDraw(p); redrawPage(p); queueSave(p.rec);
  } else {
    for (const it of a.items) { const p = pageById(it.pid); if (p) { const i = p.rec.strokes.indexOf(it.stroke); if (i >= 0) p.rec.strokes.splice(i, 1); } }
    for (const id of new Set(a.items.map((it) => it.pid))) { const p = pageById(id); if (p) { redrawPage(p); queueSave(p.rec); } }
  }
}
function undo() { const a = nb.undo.pop(); if (!a) return; applyUndo(a); nb.redo.push(a); updateUndoButtons(); }
function redo() { const a = nb.redo.pop(); if (!a) return; applyRedo(a); nb.undo.push(a); updateUndoButtons(); }
$('btn-undo').onclick = undo;
$('btn-redo').onclick = redo;
document.addEventListener('keydown', (e) => {
  if (notebook.hidden || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  e.preventDefault(); e.shiftKey ? redo() : undo();
});

// ---------- Salvataggio automatico ----------
const pending = new Set();
let saveTimer = null, saving = Promise.resolve();
function queueSave(rec) {
  pending.add(rec);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const list = [...pending]; pending.clear();
  if (!list.length) return saving;
  saving = saving.then(async () => { for (const r of list) await D.savePage(r); Sync.requestSync(); refreshSideThumbs(list); })
    .catch((e) => showError('Salvataggio non riuscito', e));
  return saving;
}
Sync.hooks.flush = flush;
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', () => flush());

// ---------- Strumenti e pannello colore/spessore ----------
const pop = $('pop'), popBack = $('pop-backdrop');
let popAnchor = null;
function paintDots() {
  $('tool-pen').querySelector('.dot').style.background = S.pen.color;
  $('tool-hl').querySelector('.dot').style.background = S.hl.color;
}
function paintPreview() {
  const c = $('pop-preview'), ctx = c.getContext('2d'), W = c.width, H = c.height, hl = S.tool === 'hl', o = cfg();
  ctx.clearRect(0, 0, W, H);
  const k = W / 360; // il riquadro è largo ~360 punti: tratto alla stessa scala di una pagina larga ~760
  if (hl) { // tre righe di "testo" finto: l'evidenziatore passa su quella centrale, così si vede la trasparenza
    ctx.fillStyle = '#d9d3cb';
    for (const [x, y, w] of [[0.08, 0.2, 0.7], [0.08, 0.5, 0.84], [0.08, 0.8, 0.56]]) {
      const h = 7 * k; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x * W, y * H - h / 2, w * W, h, h / 2) : ctx.rect(x * W, y * H - h / 2, w * W, h); ctx.fill();
    }
  }
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const y = hl ? 0.5 + 0.015 * Math.sin(t * Math.PI * 2) : 0.5 + 0.26 * Math.sin(t * Math.PI * 2.2 + 0.4);
    pts.push([(hl ? 0.1 : 0.08) + (hl ? 0.8 : 0.84) * t, y, hl ? 1 : 0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15))]);
  }
  const st = { t: hl ? 'hl' : 'pen', c: o.color, w: o.size * widthFactor(hl ? 'hl' : 'pen') * 760 * k / W, pts };
  if (hl) st.a = o.alpha;
  drawStroke(ctx, st, W, H);
}
function setSlider(id, frac) {
  const s = $(id);
  s.style.setProperty('--f', String(Math.max(0, Math.min(1, frac))));
  s.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
}
function paintColorChip() {
  paintDots();
  const on = S.tool === 'pen' || S.tool === 'hl', o = S.tool === 'hl' ? S.hl : S.pen, sw = $('btn-color').querySelector('.swatch');
  sw.style.background = o.color; sw.style.opacity = S.tool === 'hl' ? String(Math.max(0.45, o.alpha + 0.25)) : '1';
  sw.style.setProperty('--sz', (10 + o.size * 1.4) + 'px');
  $('btn-color').disabled = !on;
}
function paintPop() {
  const o = cfg(), hl = S.tool === 'hl';
  $('pop-title').textContent = hl ? 'Evidenziatore' : 'Penna';
  $('row-alpha').hidden = !hl;
  const box = $('pop-colors');
  if (box.dataset.tool !== (hl ? 'hl' : 'pen')) {
    box.dataset.tool = hl ? 'hl' : 'pen'; box.textContent = '';
    for (const [c, name] of PALETTE[hl ? 'hl' : 'pen']) {
      const b = el('button', 'color'); b.type = 'button'; b.dataset.color = c; b.setAttribute('aria-label', name); b.title = name;
      const i = el('i'); i.style.background = c; b.append(i);
      b.onclick = () => { cfg().color = c; saveTools(); paintPop(); };
      box.append(b);
    }
  }
  box.querySelectorAll('.color').forEach((x) => x.classList.toggle('active', x.dataset.color === o.color));
  $('sz-val').textContent = o.size;
  $('al-val').textContent = hl ? Math.round(o.alpha * 100) + '%' : '';
  setSlider('sl-size', (o.size - 1) / 9);
  if (hl) setSlider('sl-alpha', (o.alpha - 0.1) / 0.8);
  paintColorChip(); paintPreview();
}
function closePop() { pop.hidden = true; popBack.hidden = true; popAnchor = null; }
function placePop() {
  if (!popAnchor) return;
  const r = popAnchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const above = r.top > innerHeight / 2;
  const top = above ? Math.max(8, r.top - h - 12) : r.bottom + 12;
  pop.classList.toggle('above', above);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  pop.style.setProperty('--ax', Math.max(22, Math.min(w - 22, r.left + r.width / 2 - left)) + 'px');
}
function openPop(anchor) {
  popAnchor = anchor;
  pop.hidden = false; popBack.hidden = false;
  paintPop(); placePop();
}
function makeSlider(id, get, set) {
  const s = $(id);
  const apply = (e) => {
    const r = s.getBoundingClientRect(), pad = 16;
    set(Math.max(0, Math.min(1, (e.clientX - r.left - pad) / Math.max(r.width - 2 * pad, 1)))); saveTools(); paintPop();
  };
  let pid = null;
  s.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { s.setPointerCapture(pid); } catch {} s.classList.add('drag'); apply(e); e.preventDefault(); });
  s.addEventListener('pointermove', (e) => { if (e.pointerId === pid) apply(e); });
  const end = (e) => { if (e.pointerId === pid) { pid = null; s.classList.remove('drag'); } };
  s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
  s.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (d) { set(Math.max(0, Math.min(1, get() + d / 9))); saveTools(); paintPop(); e.preventDefault(); }
  });
}
makeSlider('sl-size', () => (cfg().size - 1) / 9, (f) => { cfg().size = Math.round(1 + f * 9); });
makeSlider('sl-alpha', () => (S.hl.alpha - 0.1) / 0.8, (f) => { S.hl.alpha = Math.round((0.1 + f * 0.8) * 20) / 20; });

function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x.dataset.tool === t));
  $('text-tools').hidden = t !== 'text';
  notebook.classList.toggle('mode-text', t === 'text');
  paintColorChip();
  for (const p of nb.pages) p.wrap.classList.toggle('textmode', t === 'text');
  closePop();
}
document.querySelectorAll('.tool').forEach((b) => {
  b.onclick = () => {
    const t = b.dataset.tool;
    // secondo tocco sullo strumento attivo (penna o evidenziatore) = pannello colore e spessore
    if (S.tool === t && (t === 'pen' || t === 'hl')) { if (justClosed()) return; pop.hidden ? openPop(b) : closePop(); return; }
    setTool(t);
  };
});
$('btn-color').onclick = () => { if (justClosed()) return; if (!pop.hidden) { closePop(); return; } if (S.tool === 'pen' || S.tool === 'hl') openPop($('tool-' + S.tool)); };
// tocco fuori dal pannello = chiudi. Su iPad dopo il tocco arriva anche un "click" sul pulsante sotto il dito:
// se è lo stesso pulsante che apre il pannello, lo ignoro (altrimenti si riaprirebbe subito)
let popClosedAt = 0;
const justClosed = () => Date.now() - popClosedAt < 500;
popBack.addEventListener('pointerdown', (e) => { e.preventDefault(); closePop(); popClosedAt = Date.now(); });
paintColorChip();

async function closeNotebook() {
  closePop();
  await flush();
  teardownPages();
  releasePdfs();
  nb.node = null;
  notebook.hidden = true; library.hidden = false;
  refreshLibrary();
}
$('btn-back').onclick = closeNotebook;

// ---------- Esporta PDF ----------
async function exportBytes() {
  await flush();
  const recs = await D.pagesOf(nb.node.id);
  const blobs = new Map();
  for (const r of recs) {
    for (const id of [r.type === 'pdf' ? r.blob : null, ...(r.images || []).map((i) => i.blob)]) {
      if (id && !blobs.has(id)) { const b = await D.get('blobs', id); if (b) blobs.set(id, b); }
    }
  }
  return buildNotebookPdf(recs, blobs);
}
$('btn-export').onclick = async () => {
  const btn = $('btn-export');
  btn.disabled = true;
  toast('Preparo il PDF…', 0);
  try {
    const bytes = await exportBytes();
    const name = nb.node.name.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
    const file = new File([bytes], name, { type: 'application/pdf' });
    toast(''); btn.disabled = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('PDF scaricato');
  } catch (err) { toast(''); showError('Non riesco a creare il PDF', err); }
  finally { btn.disabled = false; }
};

// ---------- Stato della sincronizzazione e impostazioni ----------
function renderSync() {
  const st = Sync.status, conf = Sync.isConfigured(), conn = Sync.isConnected();
  const time = st.last ? new Date(st.last).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  const label = {
    off: conf ? 'OneDrive non collegato' : 'Solo su questo dispositivo',
    idle: 'Sincronizzato' + (time ? ' · ' + time : ''),
    syncing: 'Sincronizzazione in corso…',
    offline: 'Offline · si sincronizza quando torna la rete',
    error: 'Errore: ' + st.msg,
  }[st.state];
  const short = { off: conf ? 'OneDrive non collegato' : 'Solo su questo dispositivo', idle: 'Sincronizzato con OneDrive', syncing: 'Sincronizzo…', offline: 'Offline', error: 'Errore di sincronizzazione' }[st.state];
  $('sync-text').textContent = label;
  $('sync-short').textContent = short;
  document.querySelectorAll('.sync-chip').forEach((c) => { c.dataset.state = st.state; });
  $('btn-sync').hidden = !conn; $('btn-signout').hidden = !conn;
  $('btn-onedrive').hidden = conn && !(st.state === 'error' && /riaccedere/.test(st.msg));
  $('btn-onedrive').querySelector('span').textContent = conn ? 'Accedi di nuovo' : 'Collega OneDrive';
  $('btn-onedrive').disabled = !conf;
  $('btn-sync').disabled = st.state === 'syncing';
  $('sync-help').textContent = conf ? (conn && st.account ? 'Account: ' + st.account : 'Collega il tuo account Microsoft per avere i quaderni anche sugli altri dispositivi.')
    : 'Per collegare OneDrive serve il codice dell’app (Client ID) nel file config.js. Finché non c’è, i quaderni restano solo su questo dispositivo.';
  $('sync-about').textContent = conn ? ' e copiati su OneDrive' : '';
}
Sync.onStatus(renderSync);
$('app-ver').textContent = APP_VERSION;
const openSettings = () => { renderSync(); $('settings').showModal(); };
$('btn-settings').onclick = openSettings;
$('btn-status').onclick = openSettings;
$('set-close').onclick = () => $('settings').close();
$('btn-sync').onclick = () => Sync.syncNow();
$('btn-onedrive').onclick = () => Sync.signIn();
$('btn-signout').onclick = async () => { $('settings').close(); if (await confirmDlg('Scollegare OneDrive?', 'I quaderni restano su questo dispositivo e su OneDrive.', 'Scollega')) Sync.signOut(); };
Sync.onData(function applyRemote() {
  if (!library.hidden) { refreshLibrary(); return; }
  if (nb.drawing || pending.size || document.activeElement?.closest?.('.txt')) { setTimeout(applyRemote, 1500); return; }
  (async () => {
    const node = await D.get('nodes', nb.node.id);
    if (!node || node.deleted) { closeNotebook(); return; }
    nb.node = node;
    const top = viewer.scrollTop;
    await buildPages(); viewer.scrollTop = top;
  })();
});

// ---------- Avvio ----------
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) {
      try {
        const f = await params.files[0].getFile();
        const n = await D.newNode('notebook', f.name.replace(/\.pdf$/i, ''), null);
        await addPdfPages(n.id, await readFile(f), f.name, (i) => i);
        openNotebook(n.id);
      } catch (e) { showError('Il PDF non si apre', e); }
    }
  });
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // nuova versione installata mentre l'app è aperta: lo dico, si aggiorna con un tocco
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('update-bar').hidden = false; });
  $('btn-update').onclick = async () => { await flush(); location.reload(); };
}
(async () => {
  try {
    await migrateLegacy();
    await refreshLibrary();
  } catch (e) { showError('Avvio', e); }
  renderSync();
  await Sync.init();
})();

// Appigli per i test automatici
window.__penna = { D, Sync, S, nb, lib, openNotebook, refreshLibrary, exportBytes, flush, buildPages, setTool, runSearch, pdfjs, thumbUrl, version: APP_VERSION };
