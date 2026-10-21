import * as D from './db.js';
import * as Sync from './sync.js';
import { buildNotebookPdf, LAYOUT, HL_ALPHA } from './pdfexport.js';
import * as F from './find.js';
import * as N from './notes.js';
import * as A from './ask.js';

const APP_VERSION = 'v10';
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
let pdfjsP = null, pdfWorker = null, pdfMod = null;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = import('./lib/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('./pdfworker.js', import.meta.url).href;
      pdfMod = m;
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
async function pdfAspects(buf, onProgress) {
  // copia: il worker si prende (e svuota) il buffer che riceve, su iOS l'originale resterebbe vuoto
  const doc = await loadPdf(new Uint8Array(buf.slice(0)));
  try {
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
      out.push(vp.height / vp.width);
      pg.cleanup();
      if (onProgress && n % 25 === 0) onProgress(n, doc.numPages);
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
// evidenziazioni del testo (per le miniature): stesso effetto "pennarello" dello schermo
function paintAnns(ctx, anns, W, H) {
  if (!anns || !anns.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  for (const a of anns) { ctx.globalAlpha = a.a ?? HL_ALPHA; ctx.fillStyle = a.c; for (const r of a.r || []) ctx.fillRect(r.l * W, r.t * H, r.w * W, r.h * H); }
  ctx.restore();
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
      page.cleanup();
    } else paintPattern(ctx, rec.type, w, h, 1);
    paintAnns(ctx, rec.anns, w, h);
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
      if (!t.img.isConnected || t.img.vis === false) continue; // miniatura uscita dalla vista: la faccio quando torna
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
    const prog = (i, tot) => toast('Apro “' + f.name + '”… pagina ' + i + ' di ' + tot, 0);
    try { await addPdfPages(n.id, buf, f.name, (i) => i, prog); } catch (err) { await D.deleteNode(n); throw err; }
    Sync.requestSync(); toast('');
    await openNotebook(n.id);
  } catch (err) { toast(''); showError('Il PDF non si apre', err); refreshLibrary(); }
};
// crea una pagina per ogni pagina del PDF; order(i, n) decide la posizione
async function addPdfPages(nbId, buf, name, order, onProgress) {
  const asp = await pdfAspects(buf, onProgress);
  const blob = await D.addBlob(buf, 'application/pdf', name);
  const recs = asp.map((a, i) => D.blankPage(nbId, order(i, asp.length), 'pdf', { blob: blob.id, pdfPage: i, aspect: a }));
  await D.putMany('pages', recs);
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
    // commenti ed evidenziazioni sul testo del PDF
    for (const a of p.anns || []) {
      const tx = (a.n ? a.n + ' — ' : '') + '«' + a.q + '»';
      if (!tx.toLowerCase().includes(low)) continue;
      n++;
      hit('comment', highlight(tx.length > 90 ? tx.slice(0, 90) + '…' : tx, q), nd.name + ' · pagina ' + idx + (a.n ? ' · commento' : ' · evidenziato'), () => openNotebook(nd.id, p.id));
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
const cfg = () => S[S.tool === 'hl' || S.tool === 'select' ? 'hl' : 'pen'];
const nb = { node: null, pages: [], zoom: 1, undo: [], redo: [], drawing: 0 };

async function openNotebook(id, focusPageId) {
  const node = await D.get('nodes', id);
  if (!node || node.deleted) return;
  if (nb.node) { await flush(); saveLastPage(); }
  nb.node = node; nb.zoom = 1; nb.undo = []; nb.redo = []; updateUndoButtons();
  closePop(); resetFind(); endSel(); nb.scanToast = false;
  saveSt.dirty = false; saveSt.at = 0; paintSave();
  library.hidden = true; notebook.hidden = false;
  // se il caricamento facesse chiudere l'app, alla prossima apertura non riapro questo quaderno da solo
  openGuard(true);
  D.setMeta('open', id).catch(() => {});
  setSide(wide() && localStorage.getItem('penna.side') === '1', false);
  if (!(await buildPages())) return;
  viewer.scrollLeft = 0;
  let target = null;
  if (focusPageId) target = { i: nb.pages.findIndex((x) => x.rec.id === focusPageId), f: 0 };
  else {
    // riprendo dall'ultima pagina letta
    const lp = await D.getMeta('lp:' + id).catch(() => null);
    if (lp && nb.node === node) {
      let i = nb.pages.findIndex((x) => x.rec.id === lp.id);
      if (i < 0 && lp.i < nb.pages.length) i = lp.i;
      if (i >= 0) target = { i, f: Math.max(-0.5, Math.min(1, +lp.f || 0)) };
      if (i > 0) toast('Riprendi da pagina ' + (i + 1) + ' di ' + nb.pages.length);
    }
  }
  if (target && target.i >= 0) goToPage(target.i, target.f); else { viewer.scrollTop = 0; updatePageIndicator(); }
  setTimeout(() => openGuard(false), 8000);
}
// segno "sto aprendo": tolto appena una pagina è disegnata (o l'app va in secondo piano normalmente)
let guardOn = false;
function openGuard(on) {
  if (on === guardOn) return;
  guardOn = on;
  try { on ? localStorage.setItem('penna.opening', '1') : localStorage.removeItem('penna.opening'); } catch {}
}
const topGap = () => parseFloat(getComputedStyle(pagesEl).paddingTop) - 8;

function teardownPages() {
  for (const p of nb.pages) { p.dead = true; observer.unobserve(p.wrap); if (p.task) { try { p.task.cancel(); } catch {} } freeCanvas(p.bg); freeCanvas(p.draw); dropTextLayer(p); }
  nb.pages = []; pagesEl.textContent = ''; want.clear();
}
// buildSeq: se arriva una seconda richiesta mentre leggo l'archivio, vince l'ultima (niente pagine doppie)
let buildSeq = 0;
async function buildPages() {
  const seq = ++buildSeq;
  const recs = await D.pagesOf(nb.node.id);
  if (seq !== buildSeq) return false;
  teardownPages();
  for (const rec of recs) {
    const wrap = el('div', 'page'); wrap.dataset.id = rec.id;
    // strati: sfondo · evidenziazioni · immagini · testi · tratti · [testo selezionabile] · icone dei commenti
    const bg = el('canvas', 'bg'), anns = el('div', 'anns'), imgs = el('div', 'imgs'), txt = el('div', 'txt'), draw = el('canvas', 'draw'), pins = el('div', 'pins');
    bg.width = bg.height = draw.width = draw.height = 0;
    wrap.append(bg, anns, imgs, txt, draw, pins);
    pagesEl.append(wrap);
    const p = { rec, wrap, bg, anns, imgs, txt, draw, pins, tl: null, aspect: rec.aspect || LAYOUT.a4, rendered: false, task: null, pg: null, cw: 0, ch: 0, W: 0, H: 0 };
    pageOf.set(wrap, p);
    nb.pages.push(p);
    wrap.classList.toggle('textmode', S.tool === 'text');
    wrap.classList.toggle('selmode', S.tool === 'select');
    paintBm(p);
    renderText(p); renderImages(p); renderAnns(p); attachDrawing(p);
  }
  layout();
  renderSidebar();
  renderMarks();
  renderAnnList();
  return true;
}
function fitWidth() {
  const cs = getComputedStyle(pagesEl);
  return Math.max(200, Math.min(1100, viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
}
function layout() {
  const w = fitWidth() * nb.zoom;
  nb.gap = topGap();
  for (const p of nb.pages) {
    p.cw = w; p.ch = w * p.aspect;
    p.wrap.style.width = w + 'px'; p.wrap.style.height = p.ch + 'px';
    p.wrap.style.fontSize = (w * LAYOUT.font) + 'px';
    p.rendered = false;
    observer.unobserve(p.wrap); observer.observe(p.wrap);
    growAll(p);
  }
}

// ---------- Disegno delle pagine: solo quelle visibili (anche con PDF da centinaia di pagine) ----------
// Le pagine vicine allo schermo entrano in "want"; ne disegno al massimo 2 alla volta, prima le più vicine al centro.
// Durante uno scorrimento molto veloce (o trascinando la barra rapida) aspetto che rallenti: niente lavoro inutile.
const want = new Set(), pageOf = new WeakMap(); // pageOf: riquadro .page -> dati della pagina
let pumpTimer = 0, rendering = 0, scrollV = 0, lastScrollT = 0, lastScrollTop = 0, jumped = false;
function schedule(ms = 0) { if (!pumpTimer) pumpTimer = setTimeout(pump, ms); }
function pump() {
  pumpTimer = 0;
  if (!want.size) return;
  if (performance.now() - lastScrollT < 140 && scrollV > 2.5) { schedule(90); return; }
  const mid = viewer.scrollTop + viewer.clientHeight / 2;
  const dist = (p) => Math.abs(p.wrap.offsetTop + p.ch / 2 - mid);
  const list = [...want].filter((p) => !p.rendered).sort((a, b) => dist(a) - dist(b));
  while (rendering < 2 && list.length) {
    const p = list.shift();
    rendering++;
    renderPage(p).catch(() => {}).finally(() => { rendering--; schedule(); });
  }
}
const observer = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const p = pageOf.get(en.target);
    if (!p || p.dead) continue;
    if (en.isIntersecting) want.add(p); else { want.delete(p); releasePage(p); }
  }
  schedule();
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
    openGuard(false);
    return;
  }
  let off = null;
  try {
    const pdf = await getPdf(p.rec.blob);
    const page = await pdf.getPage(p.rec.pdfPage + 1);
    if (!p.rendered) return;
    p.pg = page;
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
    openGuard(false);
    if (S.tool === 'select') buildTextLayer(p);
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
  dropTextLayer(p);
  // pdf.js tiene in memoria i dati della pagina disegnata: li libero quando esce dalla vista
  if (p.pg) { try { p.pg.cleanup(); } catch {} p.pg = null; }
  delete p.wrap.dataset.rendered;
}

// ---------- Pagina corrente, vai a pagina, barra rapida ----------
// pagina "corrente" = quella che occupa la parte alta dello schermo (dove si legge)
function pageIndexAt(y) {
  const ps = nb.pages;
  let lo = 0, hi = ps.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ps[m].wrap.offsetTop <= y) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function curIndex() {
  if (!nb.pages.length) return -1;
  const top = viewer.scrollTop, h = viewer.clientHeight;
  if (top > 0 && top + h >= viewer.scrollHeight - 2) return nb.pages.length - 1;
  const g = nb.gap ?? topGap();
  return pageIndexAt(top + g + (h - g) * 0.3);
}
function currentPage() { return nb.pages[Math.max(0, curIndex())]; }
// porta la pagina i in alto (f = punto della pagina, in frazioni della sua altezza)
function goToPage(i, f = 0) {
  if (!nb.pages.length) return;
  i = Math.max(0, Math.min(nb.pages.length - 1, i));
  const p = nb.pages[i];
  jumped = true;
  viewer.scrollTop = p.wrap.offsetTop - (nb.gap ?? topGap()) + f * p.ch;
  updatePageIndicator();
  saveLastPageSoon();
}
let lastCur = -1;
function updatePageIndicator() {
  const n = nb.pages.length;
  if (!n) return;
  const i = curIndex();
  $('pg-cur').textContent = i + 1; $('pg-tot').textContent = n;
  if (i === lastCur) return;
  const ol = $('page-list');
  if (ol.children[lastCur]) ol.children[lastCur].classList.remove('cur');
  if (ol.children[i]) ol.children[i].classList.add('cur');
  lastCur = i;
  paintAskPage();
  const bm = !!nb.pages[i].rec.bm;
  $('btn-bm').classList.toggle('on', bm);
  $('btn-bm').setAttribute('aria-pressed', String(bm));
  $('bm-add-lbl').textContent = bm ? 'Modifica il segnalibro di pagina ' + (i + 1) : 'Segna pagina ' + (i + 1);
  $('btn-prev').disabled = i === 0; $('btn-next').disabled = i === n - 1;
}
let scrollRaf = 0;
viewer.addEventListener('scroll', () => {
  const now = performance.now(), top = viewer.scrollTop;
  // velocità di scorrimento (px/ms): serve a non disegnare pagine che passano di corsa
  scrollV = jumped ? 0 : Math.abs(top - lastScrollTop) / Math.max(8, now - lastScrollT);
  jumped = false; lastScrollT = now; lastScrollTop = top;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updatePageIndicator(); showScrub(); saveLastPageSoon(); if (selSnap) placeSelMenu(); });
}, { passive: true });

// ultima pagina letta (per quaderno, su questo dispositivo)
let lpTimer = 0;
function saveLastPage() {
  clearTimeout(lpTimer); lpTimer = 0;
  if (!nb.node || !nb.pages.length || notebook.hidden) return;
  const i = curIndex(), p = nb.pages[i];
  const f = (viewer.scrollTop - (p.wrap.offsetTop - (nb.gap ?? topGap()))) / (p.ch || 1);
  D.setMeta('lp:' + nb.node.id, { id: p.rec.id, i, f: Math.round(f * 1000) / 1000 }).catch(() => {});
}
function saveLastPageSoon() { clearTimeout(lpTimer); lpTimer = setTimeout(saveLastPage, 600); }

// tocchi sulla barra in basso: il palmo appoggiato mentre si scrive con la Pencil non deve cambiare pagina
let lastPen = 0, barPointer = '';
$('pagebar').addEventListener('pointerdown', (e) => { barPointer = e.pointerType; }, true);
const palmTap = () => barPointer === 'touch' && lastPen > 0 && performance.now() - lastPen < 700;
$('btn-prev').onclick = () => { if (!palmTap()) goToPage(curIndex() - 1); };
$('btn-next').onclick = () => { if (!palmTap()) goToPage(curIndex() + 1); };
$('btn-bm').onclick = () => { if (!palmTap()) bookmarkPage(curIndex()); };
$('btn-find').onclick = () => { if (!palmTap()) openFind(); };
$('btn-notes').onclick = () => { if (!palmTap()) openAnns(); };
$('page-ind').onclick = () => { if (palmTap()) return; if (!gotoEl.hidden) { closePop(); return; } if (justClosed()) return; openGoto(); };

// pannello "Vai a pagina" con tastierino
const gotoEl = $('goto');
let gotoVal = '';
function paintGoto(bad) {
  const n = nb.pages.length;
  $('goto-sub').textContent = bad ? 'Scegli da 1 a ' + n : 'di ' + n;
  $('goto-sub').classList.toggle('bad', !!bad);
  const v = $('goto-val');
  v.textContent = gotoVal || String(curIndex() + 1);
  v.classList.toggle('ph', !gotoVal);
  const f = $('goto-field');
  f.classList.remove('bad');
  if (bad) { void f.offsetWidth; f.classList.add('bad'); }
}
function openGoto() {
  closePop();
  gotoVal = '';
  gotoEl.hidden = false; popBack.hidden = false;
  paintGoto();
  placePopover(gotoEl, $('page-ind'));
}
function gotoKey(k) {
  if (/^\d$/.test(k)) { if (gotoVal.length < 5) gotoVal = (gotoVal + k).replace(/^0+/, ''); }
  else if (k === 'del') gotoVal = gotoVal.slice(0, -1);
  else if (k === 'prev' || k === 'next') { gotoVal = ''; goToPage(curIndex() + (k === 'next' ? 1 : -1)); }
  else if (k === 'go') {
    if (!gotoVal) { closePop(); return; }
    const n = +gotoVal;
    if (n < 1 || n > nb.pages.length) { gotoVal = ''; paintGoto(true); return; }
    closePop(); goToPage(n - 1); return;
  }
  paintGoto();
}
gotoEl.querySelectorAll('.key').forEach((b) => { b.onclick = () => gotoKey(b.dataset.k); });

// barra rapida a destra: compare quando scorri, trascinala per saltare tra centinaia di pagine
const scrub = $('scrub'), scrubThumb = $('scrub-thumb');
let scrubHide = 0, scrubDrag = null;
function scrubFrac() { const max = viewer.scrollHeight - viewer.clientHeight; return max > 0 ? Math.min(1, viewer.scrollTop / max) : 0; }
function showScrub() {
  if (nb.pages.length < 4 || viewer.scrollHeight < viewer.clientHeight * 3 || nb.drawing) return;
  scrub.style.setProperty('--f', String(scrubFrac()));
  if (scrubDrag) { $('scrub-pg').textContent = 'Pagina ' + (curIndex() + 1); $('scrub-of').textContent = 'di ' + nb.pages.length; }
  scrub.classList.add('show');
  clearTimeout(scrubHide);
  if (!scrubDrag) scrubHide = setTimeout(hideScrub, 1600);
}
function hideScrub() { if (!scrubDrag) scrub.classList.remove('show'); }
scrubThumb.addEventListener('pointerdown', (e) => {
  if (!scrub.classList.contains('show')) return;
  e.preventDefault(); e.stopPropagation();
  scrubDrag = { id: e.pointerId, y: e.clientY, f: scrubFrac(), span: Math.max(1, scrub.clientHeight - scrubThumb.offsetHeight) };
  try { scrubThumb.setPointerCapture(e.pointerId); } catch {}
  scrub.classList.add('drag'); showScrub();
});
scrubThumb.addEventListener('pointermove', (e) => {
  if (!scrubDrag || e.pointerId !== scrubDrag.id) return;
  e.preventDefault();
  const f = Math.max(0, Math.min(1, scrubDrag.f + (e.clientY - scrubDrag.y) / scrubDrag.span));
  viewer.scrollTop = f * (viewer.scrollHeight - viewer.clientHeight);
});
const endScrub = (e) => {
  if (!scrubDrag || e.pointerId !== scrubDrag.id) return;
  scrubDrag = null; scrub.classList.remove('drag');
  scrubHide = setTimeout(hideScrub, 1200);
  schedule();
};
scrubThumb.addEventListener('pointerup', endScrub);
scrubThumb.addEventListener('pointercancel', endScrub);

// ---------- Barra laterale: pagine, segnalibri, ricerca ----------
const wide = () => innerWidth >= 900;
function setSide(open, remember = true) {
  notebook.classList.toggle('side-open', open);
  if (remember && wide()) { try { localStorage.setItem('penna.side', open ? '1' : '0'); } catch {} }
  if (wide() && nb.pages.length) {
    const p = currentPage(), off = p ? viewer.scrollTop - p.wrap.offsetTop : 0;
    layout(); if (p) { jumped = true; viewer.scrollTop = p.wrap.offsetTop + off * nb.pages[0].cw / (p.cw || 1); }
  }
  if (open && sideTab === 'pages') { observeSideThumbs(); centerCurThumb(); }
}
$('btn-pages').onclick = () => setSide(!notebook.classList.contains('side-open'));
let sideTab = 'pages';
function showTab(t) {
  sideTab = t;
  document.querySelectorAll('#sidebar .seg button').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $('tab-pages').hidden = t !== 'pages'; $('tab-marks').hidden = t !== 'marks'; $('tab-find').hidden = t !== 'find'; $('tab-anns').hidden = t !== 'anns';
  if (t === 'pages') { observeSideThumbs(); centerCurThumb(); }
}
document.querySelectorAll('#sidebar .seg button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
// con 300 pagine la miniatura della pagina che stai leggendo deve essere già sotto gli occhi
function centerCurThumb() {
  const ol = $('page-list'), li = ol.children[Math.max(0, curIndex())];
  if (li) ol.scrollTop = li.offsetTop - ol.offsetTop - (ol.clientHeight - li.offsetHeight) / 2;
}
function pageLabel(p) {
  const h = (p.rec.blocks || []).find((b) => b.type === 'h' && b.text);
  return h ? h.text : TYPE_LABEL[p.rec.type] + (p.rec.type === 'pdf' ? ' · pag. ' + (p.rec.pdfPage + 1) : '');
}
// miniature: caricate quando si avvicinano, tolte quando sono lontane (300 immagini in memoria peserebbero troppo)
const sideObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const img = en.target;
    img.vis = en.isIntersecting;
    if (en.isIntersecting) { if (!img.classList.contains('ok')) { const p = nb.pages[+img.dataset.i]; if (p) thumbLater(p.rec, img); } }
    else if (img.classList.contains('ok')) { img.removeAttribute('src'); img.classList.remove('ok'); }
  }
}, { root: $('page-list'), rootMargin: '600px 0px' });
function observeSideThumbs() {
  document.querySelectorAll('#page-list img.th:not(.seen)').forEach((img) => { img.classList.add('seen'); sideObserver.observe(img); });
}
function renderSidebar() {
  $('side-title').textContent = nb.node.name;
  $('side-count').textContent = plural(nb.pages.length, 'pagina', 'pagine');
  const ol = $('page-list');
  ol.querySelectorAll('img.th').forEach((img) => sideObserver.unobserve(img));
  ol.textContent = ''; lastCur = -1;
  nb.pages.forEach((p, i) => {
    const li = el('li');
    const go = el('button', 'go'); go.type = 'button'; go.title = pageLabel(p);
    const img = el('img', 'th'); img.alt = ''; img.draggable = false; img.dataset.i = i; img.style.aspectRatio = String(1 / (p.rec.aspect || LAYOUT.a4));
    go.append(img, el('span', 'num', String(i + 1)));
    go.onclick = () => { goToPage(i); if (!wide()) setSide(false); };
    const mk = (ic, label, fn, dis) => { const b = el('button', 'mini'); b.type = 'button'; b.append(icon(ic)); b.setAttribute('aria-label', label); b.title = label; b.disabled = !!dis; b.onclick = fn; return b; };
    const acts = el('div', 'acts');
    acts.append(mk('up', 'Sposta su', () => movePage(i, -1), i === 0), mk('down', 'Sposta giù', () => movePage(i, 1), i === nb.pages.length - 1), mk('trash', 'Elimina pagina', () => removePage(i)));
    li.append(go, acts); ol.append(li);
  });
  if (notebook.classList.contains('side-open') && sideTab === 'pages') observeSideThumbs();
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

// ---------- Segnalibri (con nome, salvati nella pagina: seguono riordino e sincronizzazione) ----------
function paintBm(p) { p.wrap.classList.toggle('bm', !!p.rec.bm); }
async function bookmarkPage(i) {
  const p = nb.pages[i];
  if (!p) return;
  const n = i + 1;
  if (!p.rec.bm) {
    const r = await modal({ title: 'Segnalibro a pagina ' + n, text: 'Dagli un nome per ritrovarla subito, per esempio “Capitolo 3” o “Firma”.', input: 'Pagina ' + n,
      options: [{ label: 'Aggiungi segnalibro', value: 'ok', accent: true }] });
    if (!r) return;
    p.rec.bm = { name: r.text.trim() || 'Pagina ' + n, t: Date.now() };
    toast('Segnalibro aggiunto a pagina ' + n);
  } else {
    const r = await modal({ title: p.rec.bm.name, text: 'Segnalibro a pagina ' + n, options: [
      { label: 'Vai alla pagina', value: 'go', icon: 'open' }, { label: 'Rinomina', value: 'ren', icon: 'edit' }, { label: 'Togli il segnalibro', value: 'del', danger: true, icon: 'trash' }] });
    if (!r) return;
    if (r.value === 'go') { goToPage(i); if (!wide()) setSide(false); return; }
    if (r.value === 'ren') {
      const q = await modal({ title: 'Rinomina segnalibro', input: p.rec.bm.name, options: [{ label: 'Salva', value: 'ok', accent: true }] });
      if (!q || !q.text.trim()) return;
      p.rec.bm = { ...p.rec.bm, name: q.text.trim() };
    } else { delete p.rec.bm; toast('Segnalibro tolto da pagina ' + n); }
  }
  paintBm(p); queueSave(p.rec); renderMarks();
  lastCur = -1; updatePageIndicator();
}
function renderMarks() {
  const ul = $('bm-list'); ul.textContent = '';
  const list = [];
  nb.pages.forEach((p, i) => { if (p.rec.bm) list.push([p, i]); });
  $('bm-empty').hidden = list.length > 0;
  for (const [p, i] of list) {
    const li = el('li'), go = el('button', 'row-go'); go.type = 'button';
    const tx = el('span', 'tx'); tx.append(el('b', '', p.rec.bm.name));
    if (p.rec.bm.name !== 'Pagina ' + (i + 1)) tx.append(el('span', 's', 'Pagina ' + (i + 1)));
    go.append(icon('bookmark', 'ic bmk'), tx);
    go.onclick = () => { goToPage(i); if (!wide()) setSide(false); };
    const more = el('button', 'mini'); more.type = 'button'; more.append(icon('more'));
    more.setAttribute('aria-label', 'Modifica il segnalibro ' + p.rec.bm.name);
    more.onclick = () => bookmarkPage(i);
    li.append(go, more); ul.append(li);
  }
}
$('btn-bm-add').onclick = () => bookmarkPage(curIndex());

// ---------- Ricerca nel testo del PDF (e nelle note) ----------
// Il testo di ogni pagina si legge una volta con pdf.js e resta salvato (meta "tx:<pdf>"): la seconda ricerca è immediata.
const textMem = new Map(); // id del PDF -> Map(pagina -> testo)
const findSt = { gen: 0, marks: [], sel: null };
async function pdfText(rec, touched) {
  let m = textMem.get(rec.blob);
  if (!m) {
    m = new Map(); textMem.set(rec.blob, m);
    const saved = await D.getMeta('tx:' + rec.blob).catch(() => null);
    if (Array.isArray(saved)) saved.forEach((s, i) => { if (typeof s === 'string') m.set(i, s); });
  }
  if (m.has(rec.pdfPage)) return m.get(rec.pdfPage);
  const pdf = await getPdf(rec.blob);
  const page = await pdf.getPage(rec.pdfPage + 1);
  const tc = await page.getTextContent();
  page.cleanup();
  const str = F.joinItems(tc.items).str;
  m.set(rec.pdfPage, str); touched.add(rec.blob);
  return str;
}
async function pageText(rec, touched) {
  const notes = [...(rec.blocks || []).map(blockText), ...(rec.anns || []).map((a) => a.n)].filter(Boolean).join('\n');
  if (rec.type !== 'pdf') return notes;
  const t = await pdfText(rec, touched);
  return notes ? t + '\n' + notes : t;
}
function setFindStatus(t) { $('find-status').textContent = t; $('find-status').hidden = !t; }
function clearFindMarks() { for (const m of findSt.marks) m.remove(); findSt.marks = []; }
function resetFind() {
  findSt.gen++; clearFindMarks();
  $('find-input').value = ''; $('find-list').textContent = '';
  setFindStatus('Scrivi una parola: la cerco in tutte le pagine del PDF e nelle tue note.');
}
async function runFind(raw) {
  const q = F.fold(raw), gen = ++findSt.gen;
  clearFindMarks();
  const list = $('find-list'); list.textContent = '';
  if (q.length < 2) { setFindStatus(raw.trim() ? 'Scrivi almeno 2 lettere.' : 'Scrivi una parola: la cerco in tutte le pagine del PDF e nelle tue note.'); return; }
  const pages = nb.pages.slice(), total = pages.length, MAX = 300, touched = new Set();
  let hits = 0, hitPages = 0, shown = 0, missing = 0;
  setFindStatus('Cerco…');
  for (let i = 0; i < total; i++) {
    const p = pages[i];
    let str;
    try { str = await pageText(p.rec, touched); } catch (e) { missing++; continue; }
    if (gen !== findSt.gen) return;
    const found = F.findAll(F.foldMap(str), q, 60);
    if (found.length) {
      hitPages++; hits += found.length;
      for (const [a, b] of found) { if (shown < MAX) { addFindHit(list, p.rec.id, i, str, a, b); shown++; } }
    }
    if (i % 12 === 11 && i < total - 1) {
      setFindStatus('Cerco… pagina ' + (i + 1) + ' di ' + total + (hits ? ' · ' + plural(hits, 'risultato', 'risultati') : ''));
      await new Promise((r) => setTimeout(r, 0));
      if (gen !== findSt.gen) return;
    }
  }
  for (const id of touched) { const m = textMem.get(id); const arr = []; m.forEach((s, k) => { arr[k] = s; }); D.setMeta('tx:' + id, arr).catch(() => {}); }
  setFindStatus(hits ? plural(hits, 'risultato', 'risultati') + ' in ' + plural(hitPages, 'pagina', 'pagine') + (hits > shown ? ' · mostro i primi ' + shown : '')
    : 'Nessun risultato per “' + raw.trim() + '”.' + (missing ? ' (Alcune pagine non sono ancora arrivate da OneDrive.)' : ' Se il PDF è una scansione (foto delle pagine) non contiene testo da cercare.'));
}
function addFindHit(list, id, i, str, a, b) {
  const li = el('li'), btn = el('button', 'row-go fhit'); btn.type = 'button';
  const sn = F.snippet(str, a, b), s = el('span', 'snip');
  s.append(sn.pre, el('mark', '', sn.hit), sn.post);
  const tx = el('span', 'tx'); tx.append(el('b', '', 'Pagina ' + (i + 1)), s);
  btn.append(tx);
  btn.onclick = () => openHit(btn, id, a, b);
  li.append(btn); list.append(li);
}
async function openHit(btn, id, a, b) {
  if (findSt.sel) findSt.sel.classList.remove('sel');
  findSt.sel = btn; btn.classList.add('sel');
  const i = nb.pages.findIndex((x) => x.rec.id === id);
  if (i < 0) return;
  const p = nb.pages[i];
  goToPage(i);
  if (!wide()) setSide(false);
  clearFindMarks();
  if (p.rec.type !== 'pdf') return;
  try {
    const pdf = await getPdf(p.rec.blob);
    const page = await pdf.getPage(p.rec.pdfPage + 1);
    const tc = await page.getTextContent();
    // larghezza vera delle lettere (una "m" è più larga di una "i"): il riquadro cade proprio sulla parola
    const mctx = document.createElement('canvas').getContext('2d');
    const measure = (str, it) => { const st = tc.styles[it.fontName]; mctx.font = '100px ' + ((st && st.fontFamily) || 'sans-serif'); return mctx.measureText(str).width; };
    const rects = F.hitRects(F.joinItems(tc.items).pos, a, b, page.getViewport({ scale: 1 }), measure);
    if (!rects.length || p.dead) return;
    for (const r of rects) {
      const m = el('i', 'find-mark');
      m.style.left = r.l * 100 + '%'; m.style.top = r.t * 100 + '%'; m.style.width = r.w * 100 + '%'; m.style.height = r.h * 100 + '%';
      p.wrap.append(m); findSt.marks.push(m);
    }
    // la parola trovata a un terzo dello schermo (e in vista anche se la pagina è ingrandita)
    jumped = true;
    viewer.scrollTop = Math.max(0, p.wrap.offsetTop + rects[0].t * p.ch - viewer.clientHeight * 0.35);
    if (p.cw > viewer.clientWidth) viewer.scrollLeft = Math.max(0, p.wrap.offsetLeft + rects[0].l * p.cw - viewer.clientWidth * 0.3);
  } catch (e) { if (!e || e.name !== 'NoData') console.warn('evidenziazione', e); }
}
function openFind() {
  setSide(true); showTab('find');
  const inp = $('find-input'); inp.focus(); inp.select();
}
let findTimer;
$('find-input').addEventListener('input', () => {
  clearTimeout(findTimer);
  findSt.gen++; // una ricerca ancora in corso si ferma: i risultati vecchi non valgono più
  if (F.fold($('find-input').value).length >= 2) setFindStatus('Cerco…');
  findTimer = setTimeout(() => runFind($('find-input').value), 350);
});
$('find-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); clearTimeout(findTimer); runFind($('find-input').value); e.target.blur();
});

// ---------- Testo selezionabile (strumento Seleziona) ----------
// Sopra la pagina PDF c'è il livello di testo di pdf.js: lettere trasparenti nello stesso punto di quelle stampate,
// così il dito o la Pencil selezionano il testo con le maniglie di iOS. Si costruisce solo con lo strumento Seleziona
// e solo per le pagine disegnate (vicine allo schermo): anche un libro da 300 pagine resta leggero.
const tlPages = new Set(); // pagine che hanno il livello di testo
const SCAN_MSG = 'Questo PDF è una scansione: non contiene testo selezionabile';
async function buildTextLayer(p) {
  if (p.rec.type !== 'pdf' || !p.pg || p.dead) return;
  const page = p.pg;
  const scale = p.cw / page.getViewport({ scale: 1 }).width; // pixel dello schermo per punto del PDF
  if (p.tl) { // c'è già: dopo uno zoom cambio solo la scala (posizioni e larghezze sono in proporzione)
    if (Math.abs(p.tl.scale - scale) > 1e-6) { p.tl.scale = scale; p.tl.div.style.setProperty('--total-scale-factor', String(scale)); }
    return;
  }
  const m = await pdfjs();
  if (p.tl || p.pg !== page || p.dead) return;
  const vp = page.getViewport({ scale });
  const div = el('div', 'textLayer');
  const mark = {};
  p.tl = mark; // segnaposto: niente doppioni mentre leggo il testo
  let tc;
  try { tc = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true }); } catch { tc = null; }
  if (p.tl !== mark || p.dead) return;
  p.tl = null;
  if (!tc) return;
  const layer = new m.TextLayer({ textContentSource: tc, container: div, viewport: vp });
  // misure in % della pagina: seguono lo zoom (pagina ruotata: il livello è girato, quindi i lati sono scambiati)
  const rot = vp.rotation % 180 !== 0;
  div.style.width = (rot ? p.aspect * 100 : 100) + '%'; div.style.height = (rot ? 100 / p.aspect : 100) + '%';
  div.style.setProperty('--total-scale-factor', String(scale));
  const tl = { div, layer, scale, end: null };
  p.tl = tl; tlPages.add(p);
  p.wrap.insertBefore(div, p.pins);
  try { await layer.render(); } catch { if (p.tl === tl) dropTextLayer(p); return; }
  if (p.tl !== tl) return;
  const t0 = performance.now();
  if (!window.__noFit) tl.fitted = fitToInk(p, layer, tc.items.filter((it) => it.str !== undefined));
  tl.fitMs = Math.round(performance.now() - t0); // per i test: quanto costa posare le parole
  const end = el('div', 'endOfContent'); div.append(end); tl.end = end;
  div.addEventListener('mousedown', () => div.classList.add('selecting'));
  const has = layer.textContentItemsStr.some((t) => t.trim());
  p.wrap.classList.toggle('notext', !has);
  if (!has) {
    if (!p.wrap.querySelector('.scan-note')) { const n = el('div', 'scan-note'); n.append(icon('alert'), el('span', '', SCAN_MSG)); p.wrap.append(n); }
    if (S.tool === 'select' && !nb.scanToast && p === currentPage()) { nb.scanToast = true; toast(SCAN_MSG, 4500); }
  }
}
function dropTextLayer(p) {
  if (!p.tl) return;
  if (p.tl.layer) { try { p.tl.layer.cancel(); } catch {} p.tl.div.remove(); }
  p.tl = null; tlPages.delete(p);
}
// Allineamento fine. pdf.js scrive ogni riga del PDF col carattere del browser (diverso da quello del PDF) e la allarga
// tutta insieme: a metà riga le parole possono scivolare di qualche pixel, soprattutto nel testo giustificato.
// Qui ogni parola viene posata sull'inchiostro vero della pagina appena disegnata (inizio e fine di ogni parola).
// Se parole e macchie d'inchiostro non tornano (sottolineature, sfondi, lettere attaccate) la riga resta com'è.
const fitCtx = document.createElement('canvas').getContext('2d');
const emOf = (txt, fam) => { fitCtx.font = '100px ' + fam; return fitCtx.measureText(txt).width / 100; };
function fitToInk(p, layer, items) {
  const cv = p.bg;
  if (!cv.width || !p.cw || p.tl.div.dataset.mainRotation !== '0') return 0;
  const k = cv.width / p.cw, lines = [];
  for (let i = 0; i < layer.textDivs.length && i < items.length; i++) {
    const d = layer.textDivs[i], it = items[i], st = d.style;
    if (!it.str || !it.str.trim() || !d.isConnected || st.getPropertyValue('--rotate') || !it.width) continue;
    const t = it.transform, fh = parseFloat(st.getPropertyValue('--font-height'));
    if (!fh || Math.abs(t[1]) > 1e-3 * fh || Math.abs(t[2]) > 1e-3 * fh) continue;
    const F = fh * p.tl.scale, L = parseFloat(st.left) / 100 * p.cw, T = parseFloat(st.top) / 100 * p.ch;
    lines.push({ d, str: it.str, F, L, T, R: L + it.width * p.tl.scale, sx: parseFloat(st.getPropertyValue('--scale-x')) || 1 });
  }
  p.tl.lineCount = lines.length;
  if (!lines.length) return 0;
  // una sola lettura dei pixel: il riquadro che contiene tutto il testo
  let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
  for (const l of lines) { x0 = Math.min(x0, l.L - l.F); x1 = Math.max(x1, l.R + l.F); y0 = Math.min(y0, l.T); y1 = Math.max(y1, l.T + l.F * 1.2); }
  x0 = Math.max(0, Math.floor(x0 * k)); y0 = Math.max(0, Math.floor(y0 * k)); x1 = Math.min(cv.width, Math.ceil(x1 * k)); y1 = Math.min(cv.height, Math.ceil(y1 * k));
  if (x1 - x0 < 4 || y1 - y0 < 4) return 0;
  let px;
  try { px = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data; } catch { return 0; }
  const bw = x1 - x0, todo = [];
  let fitted = 0;
  for (const l of lines) {
    // colonne con inchiostro nella fascia delle lettere della riga (sopra le gambe di g, p, q)
    const ya = Math.max(y0, Math.round((l.T + l.F * 0.15) * k)), yb = Math.min(y1, Math.round((l.T + l.F * 0.86) * k));
    const xa = Math.max(x0, Math.floor((l.L - l.F * 0.08) * k)), xb = Math.min(x1, Math.ceil((l.R + l.F * 0.08) * k));
    if (yb - ya < 2 || xb - xa < 2) continue;
    const runs = [], gap = Math.max(2, l.F * k * 0.16);
    let s0 = -1, last = -1e9;
    for (let x = xa; x < xb; x++) {
      let ink = false;
      for (let y = ya; y < yb && !ink; y++) { const i = ((y - y0) * bw + (x - x0)) * 4; ink = px[i] + px[i + 1] + px[i + 2] < 510; }
      if (!ink) continue;
      if (x - last > gap) { if (s0 >= 0) runs.push([s0, last + 1]); s0 = x; }
      last = x;
    }
    if (s0 >= 0) runs.push([s0, last + 1]);
    const words = [...l.str.matchAll(/\S+/g)], fam = l.d.style.fontFamily;
    if (!words.length || runs.length < words.length) continue;
    if (runs.length > words.length) {
      // più macchie che parole (apostrofi, accenti staccati): ogni macchia va alla parola dove pdf.js la metterebbe
      const at = (n) => (l.L + l.sx * l.F * emOf(l.str.slice(0, n), fam)) * k;
      const exp = words.map((m) => [at(m.index), at(m.index + m[0].length)]);
      const own = runs.map(([a, b]) => {
        let best = -1, bo = 0, bd = Infinity;
        exp.forEach(([c, d], j) => { const o = Math.min(b, d) - Math.max(a, c), dd = Math.abs((a + b) / 2 - (c + d) / 2); if (o > bo || (bo <= 0 && o <= 0 && dd < bd)) { bo = Math.max(bo, o); bd = dd; best = j; } });
        return best;
      });
      const merged = words.map(() => null);
      own.forEach((j, r) => { const g = merged[j]; merged[j] = g ? [g[0], runs[r][1]] : [runs[r][0], runs[r][1]]; });
      if (merged.some((g) => !g) || own.some((j, r) => r && j < own[r - 1])) continue;
      runs.length = 0; runs.push(...merged);
    }
    // in em della riga (prima della sua scala orizzontale): così vale a ogni zoom
    const em = (x) => (x / k - l.L) / l.sx / l.F;
    const frag = document.createDocumentFragment(), parts = [];
    let pos = 0;
    words.forEach((m, j) => {
      const before = l.str.slice(pos, m.index);
      const g = before ? el('span', 'g', before) : null, w = el('span', 'w', m[0]);
      if (g) frag.append(g);
      frag.append(w);
      parts.push({ g, w, n: [...m[0]].length, sp: before ? (before.match(/ /g) || []).length || 1 : 0, u: em(runs[j][0]), v: em(runs[j][1]) });
      pos = m.index + m[0].length;
    });
    if (pos < l.str.length) frag.append(l.str.slice(pos));
    l.d.textContent = ''; l.d.append(frag);
    l.parts = parts;
    todo.push(l);
  }
  // larghezze naturali misurate nella pagina, con le stesse regole (legature spente): una sola misurazione per tutte le righe
  const unit = (e, l) => e.getBoundingClientRect().width / l.sx / l.F;
  for (const l of todo) for (const q of l.parts) { q.wn = unit(q.w, l); q.gn = q.g ? unit(q.g, l) : 0; }
  for (const l of todo) {
    let cur = 0, ok = true;
    for (const q of l.parts) {
      if (q.g) q.g.style.wordSpacing = ((q.u - cur - q.gn) / q.sp).toFixed(4) + 'em';
      else q.w.style.marginLeft = (q.u - cur).toFixed(4) + 'em';
      q.w.style.letterSpacing = ((q.v - q.u - q.wn) / q.n).toFixed(4) + 'em';
      // macchia troppo diversa dalla parola: meglio non toccare (parole di 1-2 segni come "1" o "è" hanno poco inchiostro: si accettano)
      if (!q.wn || (q.n >= 3 && Math.abs(q.v - q.u - q.wn) > q.wn * 0.45)) ok = false;
      cur = q.v;
    }
    if (ok) fitted++; else l.d.textContent = l.str;
  }
  return fitted;
}
// bordo dell'evidenziazione sull'inchiostro vero della pagina (il testo trasparente può scostarsi di un paio di pixel).
// r in frazioni della pagina; side 'l' o 'r'. Ritorna la nuova x (frazione) oppure null.
function inkEdge(p, r, side) {
  const cv = p.bg;
  if (!cv.width || !cv.height) return null;
  const Wc = cv.width, Hc = cv.height, F = r.h * Hc, ex = (side === 'l' ? r.l : r.l + r.w) * Wc;
  const x0 = Math.max(0, Math.floor(ex - F * 0.7)), x1 = Math.min(Wc, Math.ceil(ex + F * 0.7));
  const y0 = Math.max(0, Math.floor((r.t + r.h * 0.2) * Hc)), y1 = Math.min(Hc, Math.ceil((r.t + r.h * 0.78) * Hc));
  if (x1 - x0 < 3 || y1 - y0 < 2) return null;
  let d;
  try { d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data; } catch { return null; }
  const bw = x1 - x0, bh = y1 - y0, ink = new Uint8Array(bw);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (y * bw + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 450) ink[x] = 1; }
  const gap = Math.max(2, F * 0.16), edges = [];
  let start = -1, last = -1e9;
  for (let x = 0; x < bw; x++) if (ink[x]) { if (x - last > gap) { if (start >= 0) edges.push([start, last + 1]); start = x; } last = x; }
  if (start >= 0) edges.push([start, last + 1]);
  let best = null, bd = F * 0.45;
  for (const [a, b] of edges) { const v = side === 'l' ? a : b, dd = Math.abs(v - (ex - x0)); if (dd < bd) { bd = dd; best = v; } }
  return best === null ? null : (x0 + best) / Wc;
}
// riquadri definitivi: inizio e fine agganciati alle lettere (solo se la selezione comincia/finisce a inizio/fine parola),
// più un filo di margine come un vero evidenziatore
function snapRects(part) {
  const rs = part.rects.map((r) => ({ ...r }));
  if (!rs.length) return rs;
  const first = rs[0], last = rs[rs.length - 1];
  if (part.ws) { const x = inkEdge(part.p, first, 'l'); if (x !== null && x < first.l + first.w) { first.w += first.l - x; first.l = x; } }
  if (part.we) { const x = inkEdge(part.p, last, 'r'); if (x !== null && x > last.l) last.w = x - last.l; }
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return rs.map((r) => { const pad = r.h * part.p.aspect * 0.07; return { l: r4(Math.max(0, r.l - pad)), t: r4(r.t), w: r4(Math.min(1 - Math.max(0, r.l - pad), r.w + 2 * pad)), h: r4(r.h) }; });
}
function startSelectMode() {
  for (const p of nb.pages) if (p.pg && p.wrap.dataset.rendered) buildTextLayer(p);
  if (nb.pages.length && !nb.pages.some((p) => p.rec.type === 'pdf')) { toast('Qui non c’è testo di un PDF: lo strumento Seleziona serve sulle pagine dei PDF', 4000); return; }
  let seen = null; try { seen = localStorage.getItem('penna.selHint'); localStorage.setItem('penna.selHint', '1'); } catch {}
  if (!seen) toast('Tieni premuto su una parola e trascina per scegliere il testo', 3500);
}

// ---------- Selezione: Copia · Evidenzia · Commenta · Copia con commento ----------
const selMenu = $('selmenu');
let selSnap = null, selTimer = 0, menuDown = 0;
const inTextLayer = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return !!(e && e.closest('.textLayer')); };
const normText = (t) => (pdfMod && pdfMod.normalizeUnicode ? pdfMod.normalizeUnicode(t) : t); // legature del PDF (ﬁ → fi)
// testo e riquadri della selezione su una pagina; i riquadri in frazioni della pagina valgono a ogni zoom
function pagePart(p, range) {
  const W = p.wrap.getBoundingClientRect();
  if (!W.width || !W.height) return null;
  const tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    { acceptNode: (n) => (n.nodeType === 3 || n.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  let text = '', ws = false, we = false, seen = false;
  const rects = [], sub = document.createRange();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    if (n.nodeName === 'BR') { text += '\n'; continue; }
    let a = n === range.startContainer ? range.startOffset : 0, b = n === range.endContainer ? range.endOffset : n.length;
    if (b <= a) continue;
    text += n.data.slice(a, b);
    while (a < b && /\s/.test(n.data[a])) a++;
    while (b > a && /\s/.test(n.data[b - 1])) b--;
    if (b <= a) continue;
    if (!seen) { seen = true; ws = a === 0 || /\s/.test(n.data[a - 1]); }
    we = b === n.length || /\s/.test(n.data[b]);
    sub.setStart(n, a); sub.setEnd(n, b);
    for (const c of sub.getClientRects()) {
      const l = Math.max(0, (c.left - W.left) / W.width), t = Math.max(0, (c.top - W.top) / W.height);
      const r = Math.min(1, (c.right - W.left) / W.width), bt = Math.min(1, (c.bottom - W.top) / W.height);
      if (r > l && bt > t) rects.push({ l, t, w: r - l, h: bt - t });
    }
  }
  const quote = N.cleanQuote(normText(text));
  if (!quote || !rects.length) return null;
  return { p, quote, rects: N.mergeRects(rects), ws, we };
}
function readSelection() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed || S.tool !== 'select' || notebook.hidden) return null;
  const range = sel.getRangeAt(0), parts = [];
  for (const p of tlPages) if (p.tl && p.tl.end && range.intersectsNode(p.tl.div)) { const part = pagePart(p, range); if (part) parts.push(part); }
  if (!parts.length) return null;
  parts.sort((a, b) => nb.pages.indexOf(a.p) - nb.pages.indexOf(b.p));
  return { parts, text: parts.map((x) => x.quote).join('\n\n') };
}
function showSelMenu() {
  selMenu.querySelector('.hdot').style.background = S.hl.color;
  selMenu.hidden = false;
  placeSelMenu();
}
function hideSelMenu() { selMenu.hidden = true; }
// fine della selezione: dopo un'azione, cambiando strumento o quaderno
function endSel() {
  selSnap = null; hideSelMenu(); clearTimeout(selTimer);
  const sel = document.getSelection();
  if (sel && sel.rangeCount && inTextLayer(sel.anchorNode)) sel.removeAllRanges();
}
// il menu sta sotto il testo scelto (sopra di solito c'è il menu di iOS); se sotto non c'è posto, sopra
function placeSelMenu() {
  if (!selSnap || selMenu.hidden) return;
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  for (const part of selSnap.parts) {
    if (!part.p.wrap.isConnected) continue;
    const W = part.p.wrap.getBoundingClientRect();
    for (const r of part.rects) {
      top = Math.min(top, W.top + r.t * W.height); bottom = Math.max(bottom, W.top + (r.t + r.h) * W.height);
      left = Math.min(left, W.left + r.l * W.width); right = Math.max(right, W.left + (r.l + r.w) * W.width);
    }
  }
  if (top === Infinity) { hideSelMenu(); return; }
  const mw = selMenu.offsetWidth, mh = selMenu.offsetHeight, gap = 14;
  const hi = $('btn-back').getBoundingClientRect().bottom + 10;
  let lo = innerHeight - 8;
  for (const b of [$('pagebar'), $('tools')]) { const r = b.getBoundingClientRect(); if (r.height && r.top > innerHeight / 2) lo = Math.min(lo, r.top - 10); }
  let y = bottom + gap;
  if (y + mh > lo) y = top - gap - mh;
  if (y < hi) y = Math.max(hi, Math.min(lo - mh, (top + bottom - mh) / 2)); // selezione più alta dello schermo: in mezzo
  selMenu.style.left = Math.max(8, Math.min(innerWidth - mw - 8, (left + right - mw) / 2)) + 'px';
  selMenu.style.top = y + 'px';
  selMenu.style.visibility = bottom < hi || top > lo ? 'hidden' : ''; // testo scorso fuori dallo schermo
}
function updateSel() {
  const s = readSelection();
  if (!s) {
    // tocco sul menu: iPad può togliere la selezione prima del "click", quindi il menu aspetta un attimo
    if (Date.now() - menuDown < 700) { clearTimeout(selTimer); selTimer = setTimeout(updateSel, 750); return; }
    selSnap = null; hideSelMenu(); return;
  }
  selSnap = s; showSelMenu();
}
document.addEventListener('selectionchange', () => {
  if (notebook.hidden || S.tool !== 'select') return;
  fixSelectionEnd();
  clearTimeout(selTimer);
  selTimer = setTimeout(updateSel, 140);
});
selMenu.addEventListener('pointerdown', (e) => { menuDown = Date.now(); if (e.pointerType === 'mouse') e.preventDefault(); });
selMenu.querySelectorAll('button').forEach((b) => { b.onclick = () => selAction(b.dataset.act); });
function selAction(act) {
  const s = selSnap;
  if (!s) return;
  if (act === 'ask') { openAsk(true); return; }
  endSel();
  if (act === 'copy') { copyText(s.text, 'Copiato'); return; }
  if (act === 'hl') {
    const ch = s.parts.map((part) => { const a = newAnn(part); return { p: part.p, id: a.id, after: a }; });
    commitAnns(ch);
    toast(s.parts.length > 1 ? 'Evidenziato su ' + s.parts.length + ' pagine' : 'Evidenziato');
    return;
  }
  // commento: si aggancia al testo della prima pagina della selezione
  const part = s.parts[0], copy = act === 'copynote';
  const only = s.parts.length > 1 ? ' (solo il testo di pagina ' + (nb.pages.indexOf(part.p) + 1) + ')' : '';
  editNote({ p: part.p, quote: part.quote, copy, onSave: (txt) => {
    const a = newAnn(part, txt);
    if (copy) copyText(N.entryMarkdown(nb.node.name, { page: nb.pages.indexOf(part.p) + 1, q: a.q, n: a.n }), 'Salvato e copiato in Markdown: incollalo in Claude Code');
    commitAnns([{ p: part.p, id: a.id, after: a }]);
    if (!copy) toast((txt ? 'Commento salvato' : 'Evidenziato') + only);
  } });
}
// la copia di sistema (⌘C, "Copia" di iOS) prende lo stesso testo pulito
viewer.addEventListener('copy', (e) => {
  const s = readSelection();
  if (!s || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', s.text); e.preventDefault();
});
// tocco su un testo evidenziato (con lo strumento Seleziona) = apri l'evidenziazione
viewer.addEventListener('click', (e) => {
  if (S.tool !== 'select') return;
  const sel = document.getSelection();
  if (sel && !sel.isCollapsed) return;
  const w = e.target.closest && e.target.closest('.page'), p = w && pageOf.get(w);
  if (!p || !(p.rec.anns || []).length || e.target.closest('.ann-pin')) return;
  const R = w.getBoundingClientRect(), x = (e.clientX - R.left) / R.width, y = (e.clientY - R.top) / R.height;
  const a = p.rec.anns.find((q) => (q.r || []).some((r) => x >= r.l && x <= r.l + r.w && y >= r.t && y <= r.t + r.h));
  if (a) annMenu(p, a.id);
});

// Safari: trascinando la maniglia nello spazio tra le righe, la selezione salterebbe a fine pagina. È il rimedio
// del lettore di pdf.js: il blocco "fine contenuto" segue il punto che si sta spostando.
let prevRange = null, pointerIsDown = false;
const modernSel = (() => { const m = /\bChrome\/(\d+)\b/.exec(navigator.userAgent); return (!!m && +m[1] >= 148) || /Firefox\//.test(navigator.userAgent); })();
function resetEnd(p) {
  const t = p.tl;
  if (!t || !t.end) return;
  t.div.append(t.end); t.end.style.width = t.end.style.height = t.end.style.userSelect = '';
  t.div.classList.remove('selecting');
}
document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
document.addEventListener('pointerup', () => { pointerIsDown = false; tlPages.forEach(resetEnd); }, true);
window.addEventListener('blur', () => { pointerIsDown = false; tlPages.forEach(resetEnd); });
document.addEventListener('keyup', () => { if (!pointerIsDown) tlPages.forEach(resetEnd); });
function fixSelectionEnd() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) { tlPages.forEach(resetEnd); prevRange = null; return; }
  const range = sel.getRangeAt(0);
  for (const p of tlPages) { if (!p.tl || !p.tl.end) continue; if (range.intersectsNode(p.tl.div)) p.tl.div.classList.add('selecting'); else resetEnd(p); }
  if (modernSel || !inTextLayer(range.startContainer) && !inTextLayer(range.endContainer)) return;
  const modifyStart = !!prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === 3) anchor = anchor.parentNode;
  if (anchor.classList && (anchor.classList.contains('w') || anchor.classList.contains('g'))) anchor = anchor.parentNode;
  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
      anchor = anchor && anchor.previousSibling;
    } while (anchor && !anchor.childNodes.length);
  }
  const layer = anchor && anchor.parentElement && anchor.parentElement.closest('.textLayer');
  const p = layer && pageOf.get(layer.parentElement);
  if (p && p.tl && p.tl.end && p.tl.div === layer) {
    const end = p.tl.end;
    end.style.width = layer.style.width; end.style.height = layer.style.height; end.style.userSelect = 'text';
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

// Copia negli appunti. Su iPad va chiamata subito dentro il tocco (niente attese prima);
// se l'API moderna manca o rifiuta, vecchio metodo con un campo nascosto.
function copyText(s, msg = 'Copiato') {
  const legacy = () => {
    const ta = el('textarea'); ta.value = s; ta.readOnly = true;
    ta.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;padding:0;border:0;opacity:0;font-size:16px';
    document.body.append(ta);
    ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, s.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  };
  const done = (ok) => { toast(ok ? msg : 'Non riesco a copiare: tieni premuto sul testo e scegli Copia', ok ? 2600 : 4500); return ok; };
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).then(() => done(true), () => done(legacy()));
  return Promise.resolve(done(legacy()));
}

// ---------- Evidenziazioni e commenti (salvati nella pagina: seguono riordino, copia, export e OneDrive) ----------
const annCopy = (a) => (a ? JSON.parse(JSON.stringify(a)) : null);
function newAnn(part, note) {
  const now = Date.now();
  const a = { id: D.uid(), q: part.quote, c: S.hl.color, a: Math.max(0.2, Math.min(0.6, S.hl.alpha)), r: snapRects(part), t: now, u: now };
  if (note) a.n = note;
  return a;
}
function setAnn(p, id, val) {
  const list = p.rec.anns || (p.rec.anns = []);
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
  if (val) list.push(annCopy(val));
  N.sortAnns(list);
  renderAnns(p); queueSave(p.rec); renderAnnList();
}
// changes: [{ p, id, after }] (after null = elimina); un solo passo di Annulla
function commitAnns(changes) {
  const ch = changes.map(({ p, id, after }) => ({ pid: p.rec.id, id, before: annCopy((p.rec.anns || []).find((x) => x.id === id)), after: annCopy(after) }));
  for (const c of changes) setAnn(c.p, c.id, c.after);
  pushAction({ type: 'ann', ch });
}
function renderAnns(p) {
  p.anns.textContent = ''; p.pins.textContent = '';
  const list = p.rec.anns || [], used = [];
  for (const a of list) {
    for (const r of a.r || []) {
      const i = el('i', 'ann-r'); i.dataset.id = a.id;
      i.style.left = r.l * 100 + '%'; i.style.top = r.t * 100 + '%'; i.style.width = r.w * 100 + '%'; i.style.height = r.h * 100 + '%';
      i.style.background = a.c; i.style.opacity = String(a.a ?? HL_ALPHA);
      p.anns.append(i);
    }
    if (!a.n || !(a.r || []).length) continue;
    // icona del commento nel margine destro, all'altezza della prima riga (due commenti vicini: una sotto l'altra)
    const ch = p.ch || fitWidth() * p.aspect, step = 46 / Math.max(200, ch);
    let y = a.r[0].t + a.r[0].h / 2;
    while (used.some((u) => Math.abs(u - y) < step)) y += step;
    used.push(y);
    const b = el('button', 'ann-pin'); b.type = 'button'; b.dataset.id = a.id;
    b.style.top = 'calc(' + y * 100 + '% - 22px)';
    b.setAttribute('aria-label', 'Commento: ' + a.n); b.title = a.n;
    const dot = el('i'); dot.append(icon('comment')); b.append(dot);
    b.onclick = () => annMenu(p, a.id);
    p.pins.append(b);
  }
}
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
async function annMenu(p, id) {
  const a = (p.rec.anns || []).find((x) => x.id === id);
  if (!a) return;
  endSel();
  const i = nb.pages.indexOf(p);
  const r = await modal({ title: (a.n ? 'Commento' : 'Testo evidenziato') + ' · pagina ' + (i + 1), text: '«' + clip(a.q, 240) + '»' + (a.n ? '\n\n' + a.n : ''), options: [
    { label: a.n ? 'Modifica il commento' : 'Aggiungi un commento', value: 'edit', icon: 'comment' },
    { label: 'Copia per Claude Code', value: 'copy', icon: 'copy-note' },
    { label: a.n ? 'Elimina commento ed evidenziazione' : 'Togli l’evidenziazione', value: 'del', danger: true, icon: 'trash' }] });
  if (!r) return;
  if (r.value === 'copy') { copyText(N.entryMarkdown(nb.node.name, { page: i + 1, q: a.q, n: a.n }), 'Copiato in Markdown: incollalo in Claude Code'); return; }
  if (r.value === 'del') { commitAnns([{ p, id, after: null }]); toast(a.n ? 'Commento eliminato' : 'Evidenziazione tolta'); return; }
  editNote({ p, quote: a.q, value: a.n || '', color: a.c, onSave: (txt) => {
    const v = annCopy(a); if (txt) v.n = txt; else delete v.n;
    v.u = Date.now();
    commitAnns([{ p, id, after: v }]);
    toast(txt ? 'Commento salvato' : 'Commento tolto: resta l’evidenziazione');
  } });
}
// piccolo editor del commento. onSave(testo) parte dentro il tocco su "Salva": così su iPad si può anche copiare subito
const cdlg = $('cdlg');
function editNote({ p, quote, value = '', color = S.hl.color, copy = false, onSave }) {
  const ta = $('cdlg-text');
  $('cdlg-title').textContent = (value ? 'Modifica il commento' : 'Commento') + ' · pagina ' + (nb.pages.indexOf(p) + 1);
  $('cdlg-quote').textContent = '«' + clip(quote, 400) + '»';
  $('cdlg-quote').style.setProperty('--c', color);
  ta.value = value;
  $('cdlg-ok').textContent = copy ? 'Salva e copia' : 'Salva';
  const close = () => { if (cdlg.open) cdlg.close(); };
  $('cdlg-ok').onclick = () => { const t = ta.value.trim(); close(); onSave(t); };
  $('cdlg-cancel').onclick = close;
  cdlg.showModal();
  ta.focus();
}
cdlg.addEventListener('click', (e) => { if (e.target === cdlg) cdlg.close(); });

// ---------- Pannello Commenti ed esportazione per Claude Code ----------
function annEntries() {
  const out = [];
  nb.pages.forEach((p, i) => { for (const a of p.rec.anns || []) out.push({ p, a, page: i + 1, q: a.q, n: a.n }); });
  return out;
}
function renderAnnList() {
  const ul = $('ann-list'), info = $('ann-count');
  ul.textContent = ''; info.textContent = '';
  const list = annEntries(), nn = list.filter((x) => x.n).length;
  $('btn-notes').dataset.n = list.length ? String(list.length) : '';
  $('btn-md-copy').disabled = $('btn-md-share').disabled = !list.length;
  if (!list.length) {
    info.append('Ancora niente. Scegli lo strumento ', el('b', '', 'Seleziona'), ', tieni premuto su una frase del PDF e tocca ', el('b', '', 'Evidenzia'), ' o ', el('b', '', 'Commenta'), '.');
    return;
  }
  info.textContent = [nn ? plural(nn, 'commento', 'commenti') : '', list.length - nn ? plural(list.length - nn, 'evidenziazione', 'evidenziazioni') : ''].filter(Boolean).join(' · ');
  for (const e of list) {
    const li = el('li'), go = el('button', 'row-go ann-row'); go.type = 'button';
    const dot = el('i', 'adot'); dot.style.background = e.a.c;
    const tx = el('span', 'tx'); tx.append(el('b', '', 'Pagina ' + e.page), el('span', 'q', '«' + e.a.q + '»'));
    if (e.a.n) tx.append(el('span', 'nt', e.a.n));
    go.append(dot, tx);
    go.onclick = () => showAnn(e.p, e.a.id);
    const more = el('button', 'mini'); more.type = 'button'; more.append(icon('more'));
    more.setAttribute('aria-label', 'Modifica o elimina'); more.title = 'Modifica o elimina';
    more.onclick = () => annMenu(e.p, e.a.id);
    li.append(go, more); ul.append(li);
  }
}
// porta in vista il testo evidenziato e lo fa lampeggiare
function showAnn(p, id) {
  const a = (p.rec.anns || []).find((x) => x.id === id);
  if (!a) return;
  if (!wide()) setSide(false);
  goToPage(nb.pages.indexOf(p));
  const r = (a.r || [])[0];
  if (r) { jumped = true; viewer.scrollTop = Math.max(0, p.wrap.offsetTop + r.t * p.ch - viewer.clientHeight * 0.35); }
  p.anns.querySelectorAll('.ann-r').forEach((x) => { if (x.dataset.id === id) { x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash'); } });
}
function openAnns() { setSide(true); showTab('anns'); }
const allMarkdown = () => N.toMarkdown(nb.node.name, annEntries());
$('btn-md-copy').onclick = () => {
  const n = annEntries().length;
  if (!n) { toast('Ancora nessun commento da copiare'); return; }
  copyText(allMarkdown(), 'Copiate ' + plural(n, 'voce', 'voci') + ' in Markdown: incollale in Claude Code');
};
$('btn-md-share').onclick = async () => {
  if (!annEntries().length) return;
  const md = allMarkdown(), name = nb.node.name.replace(/[\\/:*?"<>|]/g, '_') + ' - commenti.md';
  let file = new File([md], name, { type: 'text/markdown' });
  if (navigator.canShare && !navigator.canShare({ files: [file] })) file = new File([md], name, { type: 'text/plain' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('File .md scaricato');
};

// ---------- Chiedi: domande sul testo al Mac Studio (Qwen gratis sul Mac, o Claude con l'abbonamento) ----------
// Indirizzo e token restano solo su questo dispositivo (localStorage, non vanno su OneDrive). Non parte niente
// senza un tocco su un'azione o su Invia; la prima volta un avviso dice dove va il testo.
const AI_KEY = 'penna.ai';
const aiCfg = (() => { try { return JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch { return {}; } })();
aiCfg.model = aiCfg.model || {};
const saveAi = () => { try { localStorage.setItem(AI_KEY, JSON.stringify(aiCfg)); } catch {} };
const aiReady = () => !!(aiCfg.url && aiCfg.token);
const PRIVACY = 'Il testo selezionato viene inviato al tuo Mac Studio (e, se scegli Claude, a Anthropic con il tuo abbonamento). Non parte niente finché non tocchi un’azione o Invia.';
const PRIVACY_WEB = 'Con «Cerca sul web» la tua domanda e alcuni pezzi del testo possono uscire dal Mac Studio verso internet: con Claude li usa Anthropic per cercare e leggere pagine; con Qwen la ricerca va a Tavily (un servizio di ricerca). Le pagine trovate sono trattate come dati, non come ordini. Puoi spegnerlo quando vuoi.';
const askEl = $('ask'), askAns = $('ask-answer');
const askSt = { scope: 'page', sel: null, src: aiCfg.src === 'claude' ? 'claude' : 'qwen', ctrl: null, busy: false, stopped: false, last: null, answer: '', error: '', info: '', ctxInfo: '', model: '', thinking: false, saved: null,
  found: [], numbered: false, searching: '', webOld: false,
  queries: [], qPlanned: false, qFound: -1, qPoor: false, qedit: false, // ricerche fatte dal Mac (fase 9) e "Modifica ricerca"
  snap: 'half', kbOn: false, kbPrev: null }; // altezza del pannello: compact | half | full; tastiera aperta
// fonti da mostrare (e salvare) per la risposta di adesso: quelle citate, o le pagine consultate
const askSources = () => (askSt.last && askSt.last.web ? A.collectSources(askSt.answer, askSt.found, askSt.numbered) : { list: [], cited: false });
// le ricerche fatte davvero (per Copia e Salva come commento)
const askQueries = () => (askSt.last && askSt.last.web && !askSt.webOld && !askSt.qPlanned ? askSt.queries : []);
// il web per la sorgente scelta c'è sul Mac? (dall'ultima "Prova connessione"; se non si sa, si prova)
const webHealth = (src) => { const h = aiCfg.health; return h && h['web_' + src] ? h['web_' + src] : null; };
// testo di una pagina per l'assistente: testo del PDF e note scritte con la tastiera (non i commenti: lì ci sono anche le risposte salvate)
async function aiPageText(rec, touched) {
  const notes = (rec.blocks || []).map(blockText).filter(Boolean).join('\n');
  if (rec.type !== 'pdf') return notes;
  const t = await pdfText(rec, touched);
  return notes ? t + '\n' + notes : t;
}
function persistTexts(touched) {
  for (const id of touched) { const m = textMem.get(id); if (!m) continue; const arr = []; m.forEach((s, k) => { arr[k] = s; }); D.setMeta('tx:' + id, arr).catch(() => {}); }
}
function openAsk(fromSel) {
  if (askSt.busy) askStop();
  askSt.sel = null;
  if (fromSel && selSnap) {
    const part = selSnap.parts[0];
    askSt.sel = { p: part.p, part, text: selSnap.text, page: nb.pages.indexOf(part.p) + 1, rects: snapRects(part) };
  }
  endSel(); closePop();
  askSt.scope = askSt.sel ? 'sel' : 'page';
  askSt.answer = ''; askSt.error = ''; askSt.last = null; askSt.saved = null; askSt.queries = []; askSt.qedit = false;
  askSt.snap = askSt.kbOn ? 'full' : 'half'; askSt.kbPrev = askSt.kbOn ? 'half' : null; // si apre a metà
  askEl.classList.remove('closing'); askEl.style.setProperty('--ask-y', '0px'); askSizeKey = '';
  $('ask-input').value = ''; growAsk();
  askEl.hidden = false;
  paintAsk(); placeAsk();
}
function closeAsk() {
  if (askSt.busy) askStop();
  clearTimeout(askCloseT);
  askEl.hidden = true; askSt.sel = null; askSt.qedit = false;
  askEl.classList.remove('closing', 'dragging'); askEl.style.setProperty('--ask-y', '0px');
  if (askEl.contains(document.activeElement)) document.activeElement.blur();
}
function paintAsk() {
  const ready = aiReady();
  $('ask-setup').hidden = ready; $('ask-main').hidden = !ready;
  askEl.classList.toggle('setup', !ready);
  askEl.querySelectorAll('.ask-src button').forEach((b) => {
    const on = b.dataset.src === askSt.src, h = aiCfg.health && aiCfg.health[b.dataset.src];
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    b.classList.toggle('off', !!(h && !h.ok));
    b.title = h && !h.ok ? h.error : A.SOURCES[b.dataset.src].long;
  });
  if (!ready) return;
  const cur = curIndex() + 1;
  askEl.querySelectorAll('.ask-scope button').forEach((b) => {
    const s = b.dataset.scope;
    b.hidden = s === 'sel' && !askSt.sel;
    b.classList.toggle('on', s === askSt.scope); b.setAttribute('aria-selected', String(s === askSt.scope));
    if (s === 'page') b.textContent = 'Pagina ' + cur;
    if (s === 'sel' && askSt.sel) b.textContent = 'Selezione · p. ' + askSt.sel.page;
  });
  const q = $('ask-quote');
  q.textContent = askSt.scope === 'sel' ? '«' + clip(askSt.sel.text, 320) + '»'
    : askSt.scope === 'page' ? 'Il testo della pagina ' + cur + (nb.pages.length > 1 ? ' di ' + nb.pages.length : '')
      : 'Le pagine del PDF che servono: le scelgo con le parole della tua domanda (e ti dico quali)';
  q.classList.toggle('plain', askSt.scope !== 'sel');
  const acts = $('ask-acts'); acts.textContent = '';
  for (const a of askSt.scope === 'doc' ? A.ACTIONS.filter((x) => x.id === 'sum') : A.ACTIONS) {
    const b = el('button', 'chip-act', askSt.scope === 'doc' ? 'Riassumi il PDF' : a.label); b.type = 'button'; b.dataset.act = a.id;
    b.disabled = askSt.busy;
    b.onclick = () => askRun({ action: a.id });
    acts.append(b);
  }
  $('ask-input').placeholder = askSt.scope === 'sel' ? 'Chiedi qualcosa su questo passaggio…' : askSt.scope === 'page' ? 'Chiedi qualcosa su questa pagina…' : 'Domanda sul PDF…';
  $('ask-send').disabled = askSt.busy;
  paintAskWeb();
  paintAskOut();
  placeAsk();
}
// interruttore "Cerca sul web" e la riga accanto: cosa fa con la sorgente scelta, o cosa manca sul Mac
function paintAskWeb() {
  const on = !!aiCfg.web, b = $('ask-web'), wh = webHealth(askSt.src), note = $('ask-web-note');
  b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); b.disabled = askSt.busy;
  const h = aiCfg.health, old = h && h.qwen && !h.web_claude; // bridge della fase 7: non sa cercare
  const plain = h && h.web_claude && +h.version < 3; // bridge della fase 8: cerca con le parole della frase, non con ricerche mirate
  note.classList.toggle('warn', on && (old || plain || !!(wh && !wh.ok)));
  note.textContent = !on ? 'Spento: solo il testo del PDF'
    : old ? 'Aggiorna il Mac Studio (rilancia l’installazione), poi Prova connessione'
      : wh && !wh.ok ? (askSt.src === 'qwen' ? 'Qwen: manca la chiave Tavily sullo Studio, usa Claude' : 'Claude: ' + (wh.error || 'non può cercare'))
        : plain ? 'Ricerche poco mirate: aggiorna il Mac Studio (rilancia l’installazione)'
          : askSt.src === 'claude' ? 'Claude cerca, legge le pagine e cita le fonti' : 'Qwen sceglie le ricerche, legge le fonti migliori (Tavily) e le cita';
}
let askRaf = 0;
// "Ho cercato: …" (o "Ricerche: …" mentre lavora), l'avviso se le fonti sono scarse, e "Modifica ricerca"
function paintAskQueries() {
  const l = askSt.last, has = !!(l && l.web && askSt.queries.length && !askSt.webOld);
  $('ask-queries').hidden = !has || askSt.qedit;
  $('ask-qedit').hidden = !(has && askSt.qedit);
  if (!has) return;
  $('ask-queries-t').textContent = A.queriesLabel(askSt.queries, askSt.busy ? 'busy' : askSt.qPlanned ? 'planned' : 'done');
  const poor = $('ask-poor');
  poor.hidden = askSt.busy || !askSt.qPoor;
  poor.textContent = askSt.qFound === 0 ? 'Non ho trovato fonti affidabili sul web' : 'Ho trovato una sola fonte affidabile';
  $('ask-qedit-open').hidden = askSt.busy;
}
function paintAskOut() {
  askRaf = 0;
  const out = $('ask-out'), shown = askSt.busy || askSt.answer || askSt.error;
  out.hidden = false; // sempre: con il pannello alto, lo spazio della risposta c'è già
  out.querySelector('.ask-btns').hidden = !shown;
  askEl.classList.toggle('has-out', !!shown); // c'è una risposta: i comandi si fanno piccoli (vedi style.css)
  paintAskQueries();
  if (!shown) {
    $('ask-info').textContent = ''; askAns.textContent = '';
    askAns.append(el('p', 'ask-hint', 'La risposta comparirà qui. Per avere più spazio, trascina in su la barretta in cima al pannello.'));
    return;
  }
  const l = askSt.last;
  $('ask-info').textContent = askSt.info || (l ? [A.SOURCES[l.src].label, A.modelLabel(l.src, askSt.model), askSt.ctxInfo, l.web ? (askSt.webOld ? 'senza web: aggiorna il Mac Studio' : 'con il web') : ''].filter(Boolean).join(' · ') + (askSt.stopped && !askSt.busy && askSt.answer ? ' · fermata' : '') : '');
  const nearEnd = askAns.scrollHeight - askAns.scrollTop - askAns.clientHeight < 40;
  askAns.textContent = '';
  if (askSt.answer) askAns.append(A.renderMd(askSt.answer));
  if (askSt.busy) {
    if (!askSt.answer) askAns.append(el('p', 'ask-wait' + (askSt.searching ? ' ask-search' : ''), askSt.searching ? askSt.searching + '…' : askSt.thinking ? 'Sta ragionando…' : 'Chiedo a ' + A.SOURCES[askSt.last ? askSt.last.src : askSt.src].label + '…'));
    let tgt = askAns.lastElementChild; // il cursore lampeggia in fondo al testo che sta arrivando
    if (tgt && (tgt.tagName === 'UL' || tgt.tagName === 'OL')) tgt = tgt.lastElementChild;
    if (!tgt || tgt.tagName === 'PRE' || tgt.tagName === 'HR') tgt = askAns;
    tgt.append(el('i', 'caret'));
    if (askSt.answer && askSt.searching) askAns.append(el('p', 'ask-wait ask-search', askSt.searching + '…')); // Claude cerca ancora a metà risposta
  } else {
    const src = askSources();
    if (src.list.length) { // Fonti: link veri (solo http/https), si aprono in una scheda nuova
      const box = el('div', 'ask-sources'), h = el('div', 'ask-sources-h');
      h.append(icon('globe'), el('span', '', src.cited ? 'Fonti' : 'Pagine consultate'));
      const ol = el('ol');
      for (const s of src.list) {
        const a = el('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.append(el('span', 't', s.title), el('span', 'h', s.host));
        const li = el('li'); li.append(a); ol.append(li);
      }
      box.append(h, ol); askAns.append(box);
    }
  }
  if (askSt.error) { const e = el('div', 'ask-err'); e.append(icon('alert'), el('span', '', askSt.error)); askAns.append(e); }
  if (nearEnd || askSt.busy) askAns.scrollTop = askAns.scrollHeight;
  const has = !!askSt.answer && !askSt.busy;
  const canSave = has && askSt.last && askSt.last.scope === 'sel' && !!askSt.sel;
  $('ask-save').hidden = !(askSt.last && askSt.last.scope === 'sel');
  $('ask-save').disabled = !canSave || !!askSt.saved;
  $('ask-save').querySelector('span').textContent = askSt.saved ? 'Salvato come commento ✓' : 'Salva come commento';
  $('ask-copy').disabled = !has;
  const r = $('ask-retry');
  r.textContent = ''; r.append(icon(askSt.busy ? 'stop' : 'retry'), el('span', '', askSt.busy ? 'Ferma' : 'Riprova'));
  r.setAttribute('aria-label', askSt.busy ? 'Ferma' : 'Riprova'); r.title = r.getAttribute('aria-label'); // su iPhone si vede solo l'icona
  r.disabled = !askSt.busy && !askSt.last;
}
const askLater = () => { if (!askRaf) askRaf = requestAnimationFrame(paintAskOut); };
// ---------- altezza del pannello: compatto (risposta + domanda), metà (con i comandi), quasi tutto schermo ----------
// La maniglia in cima (e il titolo) si trascinano: al rilascio il pannello scatta sull'altezza più vicina (con la spinta
// del dito); un tocco passa alla successiva; tirato giù sotto il compatto si chiude. Con la tastiera aperta il pannello
// sta sopra la tastiera (visualViewport) e prende tutto lo spazio che resta, per leggere la risposta.
const SNAPS = ['compact', 'half', 'full'];
const stProbe = el('div'); // per leggere in px la zona sicura in alto (env(safe-area-inset-top))
stProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:var(--st);visibility:hidden;pointer-events:none';
document.body.append(stProbe);
let askCtlH = 0, askCloseT = 0; // altezza naturale dei comandi (ultima misurata quando si vedono)
function askSizes() {
  const vv = window.visualViewport, vh = vv ? vv.height : innerHeight, top = vv ? vv.offsetTop : 0;
  const bottom = parseFloat(getComputedStyle(askEl).bottom) || 0; // già sopra la tastiera (--kb)
  const full = Math.max(200, Math.floor(innerHeight - bottom - top - stProbe.offsetHeight - (innerWidth <= 600 ? 8 : 12)));
  const ctl = askEl.querySelector('.ask-ctl'), btns = askEl.querySelector('.ask-btns');
  if (ctl.offsetParent && ctl.scrollHeight) askCtlH = ctl.scrollHeight;
  // il resto (maniglia, titolo, campo domanda, righe sopra la risposta, bordi): non dipende dall'altezza scelta
  const fixed = askEl.offsetHeight - (ctl.offsetParent ? ctl.offsetHeight : 0) - askAns.offsetHeight - (btns.offsetParent ? btns.offsetHeight + 10 : 0);
  const compact = Math.min(full, Math.max(Math.round(vh * 0.4), fixed + 110));
  const want = Math.max(Math.round(vh * 0.5), fixed + (askCtlH || 240) + 64 + 130); // metà schermo, ma con comandi e risposta interi
  const half = Math.min(Math.max(compact + 1, full - 40), Math.max(compact + 60, want));
  return { compact, half: Math.min(half, full), full };
}
// L'altezza si ricalcola solo se cambia la posizione scelta, lo schermo o la tastiera: non quando arriva la risposta
// (il pannello non deve "muoversi" sotto il dito mentre si tocca un pulsante).
let askSizeKey = '';
function applySnap(force = false) {
  if (askEl.hidden) return;
  if (!aiReady()) { askEl.style.removeProperty('--ask-h'); askSizeKey = ''; return; } // pannello "collega il Mac": altezza del contenuto
  const vv = window.visualViewport, key = [askSt.snap, askSt.kbOn, innerWidth, innerHeight, vv ? Math.round(vv.height) + ':' + Math.round(vv.offsetTop) : ''].join();
  if (!force && key === askSizeKey) return;
  askSizeKey = key;
  const sz = askSizes();
  askEl.classList.toggle('tight', askSt.kbOn && sz.full < 600); // tastiera aperta e poco spazio: solo domanda e risposta
  for (const s of SNAPS) askEl.classList.toggle('snap-' + s, askSt.snap === s);
  askEl.dataset.snap = askSt.snap;
  askEl.style.setProperty('--ask-h', sz[askSt.snap] + 'px');
}
function setSnap(s) { if (!SNAPS.includes(s)) return; askSt.snap = s; askSt.kbPrev = null; applySnap(true); }
const cycleSnap = () => setSnap(SNAPS[(SNAPS.indexOf(askSt.snap) + 1) % SNAPS.length]); // compatto → metà → tutto → compatto
// tastiera dell'iPad aperta: il pannello sale sopra la tastiera e usa tutto lo spazio che resta (poi torna com'era)
function placeAsk() {
  if (askEl.hidden) return;
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
  askEl.style.setProperty('--kb', kb + 'px');
  askEl.style.setProperty('--vh', (vv ? vv.height : innerHeight) + 'px');
  const open = kb > 80; // con la tastiera esterna dell'iPad resta solo una barretta: non conta
  if (open !== askSt.kbOn) {
    askSt.kbOn = open;
    if (open) { askSt.kbPrev = askSt.snap; askSt.snap = 'full'; }
    else if (askSt.kbPrev) { askSt.snap = askSt.kbPrev; askSt.kbPrev = null; }
  }
  askEl.classList.toggle('kbopen', open);
  applySnap();
}
if (window.visualViewport) { visualViewport.addEventListener('resize', placeAsk); visualViewport.addEventListener('scroll', placeAsk); }
addEventListener('resize', placeAsk);
let askDrag = null;
function askGripDown(e) {
  if (askEl.hidden || !aiReady() || e.target.closest('button, a, input, textarea, select')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  askDrag = { id: e.pointerId, y: e.clientY, h: askEl.getBoundingClientRect().height, moved: false, pts: [[e.timeStamp, e.clientY]], sz: null };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
}
function askGripMove(e) {
  const d = askDrag;
  if (!d || e.pointerId !== d.id) return;
  const dy = e.clientY - d.y;
  if (!d.moved) { if (Math.abs(dy) < 7) return; d.moved = true; d.sz = askSizes(); askEl.classList.add('dragging'); }
  d.pts.push([e.timeStamp, e.clientY]); if (d.pts.length > 8) d.pts.shift();
  const h = d.h - dy, { compact, full } = d.sz;
  askEl.style.setProperty('--ask-h', Math.round(Math.max(compact, Math.min(full + 16, h))) + 'px');
  askEl.style.setProperty('--ask-y', Math.round(Math.max(0, compact - h)) + 'px'); // sotto il compatto scende, e lasciato giù si chiude
  e.preventDefault();
}
function askGripUp(e) {
  const d = askDrag;
  if (!d || e.pointerId !== d.id) return;
  askDrag = null; askEl.classList.remove('dragging');
  if (!d.moved) { if (e.type === 'pointerup') cycleSnap(); return; } // un tocco: altezza successiva
  let k = 0; // velocità degli ultimi ~100 ms (se il dito si è fermato prima di staccarsi, è quasi zero)
  while (k < d.pts.length - 1 && e.timeStamp - d.pts[k][0] > 100) k++;
  const [t0, y0] = d.pts[k], v = e.timeStamp > t0 ? (e.clientY - y0) / (e.timeStamp - t0) : 0; // px/ms, + = verso il basso
  const h = d.h - (e.clientY - d.y), sz = d.sz;
  askSt.fling = { v: Math.round(v * 100) / 100, h: Math.round(h), n: d.pts.length }; // per i test
  if (h < sz.compact - 70 || (v > 0.7 && h < sz.compact + 10)) { // giù oltre la soglia (o una spinta decisa dal compatto): si chiude
    askEl.classList.add('closing');
    askCloseT = setTimeout(closeAsk, 200);
    return;
  }
  askEl.style.setProperty('--ask-y', '0px');
  const aim = h - v * 220; // con la spinta va dove stava andando
  setSnap(SNAPS.reduce((b, s) => (Math.abs(sz[s] - aim) < Math.abs(sz[b] - aim) ? s : b), 'half'));
}
for (const t of [$('ask-grip'), askEl.querySelector('.ask-head')]) {
  t.addEventListener('pointerdown', askGripDown);
  t.addEventListener('pointermove', askGripMove);
  t.addEventListener('pointerup', askGripUp);
  t.addEventListener('pointercancel', askGripUp);
}
$('ask-grip').addEventListener('keydown', (e) => {
  const i = SNAPS.indexOf(askSt.snap);
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleSnap(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setSnap(SNAPS[Math.min(2, i + 1)]); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setSnap(SNAPS[Math.max(0, i - 1)]); }
});
function growAsk() { const t = $('ask-input'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight + 2) + 'px'; t.style.overflowY = t.scrollHeight > 120 ? 'auto' : 'hidden'; }
// scorrendo il PDF col pannello aperto, "Pagina N" segue la pagina che si sta leggendo
function paintAskPage() {
  if (askEl.hidden || askSt.busy || !aiReady()) return;
  const b = askEl.querySelector('.ask-scope [data-scope="page"]'), cur = curIndex() + 1;
  b.textContent = 'Pagina ' + cur;
  if (askSt.scope === 'page') $('ask-quote').textContent = 'Il testo della pagina ' + cur + (nb.pages.length > 1 ? ' di ' + nb.pages.length : '');
}

// il testo da mandare: selezione (con la sua pagina come contesto), pagina corrente, o i passaggi utili del PDF
async function askContext(scope, what, src) {
  const touched = new Set(), title = nb.node.name;
  try {
    if (scope === 'sel') {
      const s = askSt.sel;
      const pageTextS = await aiPageText(s.p.rec, touched).catch(() => '');
      return { ctx: { title, scope, quote: s.text, page: s.page, pageText: pageTextS }, info: 'Selezione · pagina ' + s.page };
    }
    if (scope === 'page') {
      const i = Math.max(0, curIndex()), p = nb.pages[i];
      const text = await aiPageText(p.rec, touched);
      if (!text.trim()) return { error: p.rec.type === 'pdf' ? 'Su questa pagina non c’è testo da inviare: è una scansione (una foto) o è vuota.' : 'Questa pagina non ha testo scritto con la tastiera (la scrittura a mano non si può inviare).' };
      return { ctx: { title, scope, page: i + 1, pageText: text }, info: 'Pagina ' + (i + 1) };
    }
    const list = [], n = nb.pages.length;
    for (let i = 0; i < n; i++) {
      let t = '';
      try { t = await aiPageText(nb.pages[i].rec, touched); } catch {}
      list.push({ n: i + 1, text: t });
      if (i % 20 === 19 && i < n - 1) { askSt.info = 'Leggo il PDF… pagina ' + (i + 1) + ' di ' + n; askLater(); await new Promise((r) => setTimeout(r, 0)); if (askSt.stopped) return null; }
    }
    if (src === 'qwen') await refreshQwenCtx(); // "Tutto il PDF" con Qwen: tutto il libro, se entra nel suo contesto
    const pick = A.pickPages(list, what.question || '', { budget: A.docBudget(src, aiCfg.health), current: curIndex() + 1 });
    if (!pick.pages.length) return { error: 'Nel PDF non c’è testo da inviare: è una scansione (foto delle pagine).' };
    return { ctx: { title, scope, docText: pick.text, docNote: pick.note }, info: pick.all ? 'Tutto il PDF (' + plural(pick.pages.length, 'pagina', 'pagine') + ' con testo)' : 'Ho incluso ' + A.pagesLabel(pick.pages, pick.total), pick };
  } finally { persistTexts(touched); }
}
// Contesto di Qwen (num_ctx) dal bridge, in silenzio: serve a decidere quanto PDF mandare. Salvato con la salute del
// collegamento; si rilegge se manca (bridge aggiornato dopo l'ultima prova) o ha più di 6 ore. Errori ignorati.
async function refreshQwenCtx() {
  const h = aiCfg.health;
  if (!aiCfg.url || !aiCfg.token || !h || !h.qwen || (h.qwen.num_ctx !== undefined && Date.now() - (h.at || 0) < 6 * 3600e3)) return;
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(aiCfg.url + '/health', { headers: { Authorization: 'Bearer ' + aiCfg.token }, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const j = r.ok ? await r.json() : null;
    if (j && j.qwen) { h.qwen = j.qwen; h.at = Date.now(); saveAi(); }
  } catch {} finally { clearTimeout(t); }
}
async function askRun(what, opts = {}) {
  if (askSt.busy) return;
  if (!aiReady()) { paintAsk(); return; }
  if (what.question !== undefined && !what.question.trim()) { $('ask-input').focus(); return; }
  if (!aiCfg.privacy) {
    const ok = await modal({ title: 'Prima di inviare', text: PRIVACY, options: [{ label: 'Ho capito, invia', value: 'ok', accent: true }] });
    if (!ok) return;
    aiCfg.privacy = 1; saveAi();
  }
  // opts.queries = ricerche corrette a mano ("Modifica ricerca"): si cerca sul web con quelle, così come sono
  const src = askSt.src, model = aiCfg.model[src] || '', queries = opts.queries && opts.queries.length ? opts.queries : null, web = !!queries || !!aiCfg.web;
  askSt.last = { what, scope: askSt.scope, src, model, web, queries };
  askSt.busy = true; askSt.stopped = false; askSt.answer = ''; askSt.error = ''; askSt.saved = null; askSt.thinking = false;
  askSt.found = []; askSt.numbered = false; askSt.searching = ''; askSt.webOld = false;
  askSt.queries = queries || []; askSt.qPlanned = false; askSt.qFound = -1; askSt.qPoor = false; askSt.qedit = false;
  askSt.info = 'Preparo il testo…'; askSt.ctxInfo = ''; askSt.model = model;
  paintAsk();
  const c = await askContext(askSt.scope, what, src);
  if (!c || askSt.stopped) { askDone(null); return; }
  if (c.error) { askDone(c.error); return; }
  askSt.info = ''; askSt.ctxInfo = c.info;
  askSt.pick = c.pick || null;
  const body = { provider: src, model, system: A.SYSTEM, messages: [{ role: 'user', content: A.buildMessage(c.ctx, what) }] };
  if (web) {
    body.web = true;
    body.web_ctx = A.webCtx(c.ctx, what); // il Mac Studio sceglie da qui le ricerche mirate (nomi propri, termini specifici)
    body.web_query = queries ? queries[0] : A.webQuery(c.ctx, what); // solo per un bridge vecchio (fase 8)
    if (queries) body.web_queries = queries;
    askSt.searching = queries ? A.searchLabel({ q: queries[0] }) : 'Scelgo cosa cercare';
  }
  askSt.sent = body; // per i test
  paintAskOut();
  await askStream(body);
}
async function askStream(body) {
  const ctrl = new AbortController();
  askSt.ctrl = ctrl;
  let timedOut = false;
  const wait = setTimeout(() => { timedOut = true; ctrl.abort(); }, 30000); // il Mac non risponde nemmeno
  let res;
  try {
    res = await fetch(aiCfg.url + '/ask', { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiCfg.token } });
  } catch (e) { clearTimeout(wait); askDone(askSt.stopped && !timedOut ? null : A.MSG_DOWN); return; }
  clearTimeout(wait);
  if (!res.ok) { let j = null; try { j = await res.json(); } catch {} askDone(A.errorText(res.status, j)); return; }
  if (!res.body || !res.body.getReader) { askDone('Questo browser non sa leggere le risposte a pezzi: aggiorna iPadOS.'); return; }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let err = null, done = false, idle = 0;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; ctrl.abort(); }, 100000); }; // il bridge manda un "ping" ogni 15 s
  const feed = A.sseReader((name, d) => {
    if (name === 'text') { askSt.answer += d.t || ''; askSt.thinking = false; askSt.searching = ''; askLater(); }
    else if (name === 'thinking') { if (!askSt.thinking && !askSt.answer) { askSt.thinking = true; askLater(); } }
    else if (name === 'search') { askSt.searching = A.searchLabel(d); askSt.thinking = false; askLater(); }
    else if (name === 'status') { askSt.searching = String(d.t || '').slice(0, 120).replace(/…$/, ''); askSt.thinking = false; askLater(); }
    else if (name === 'queries') {
      askSt.queries = (Array.isArray(d.list) ? d.list : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 10).map((x) => x.slice(0, 200));
      askSt.qPlanned = !!d.planned;
      if (typeof d.found === 'number') { askSt.qFound = d.found; askSt.qPoor = !!d.poor; }
      askLater();
    }
    else if (name === 'sources') { askSt.found = Array.isArray(d.list) ? d.list.slice(0, 40) : []; askSt.numbered = !!d.numbered; }
    else if (name === 'meta') {
      if (d.model) askSt.model = d.model;
      if (body.web && d.web !== true) { askSt.webOld = true; askSt.searching = ''; } // bridge vecchio: ha risposto senza cercare
      else if (body.web && aiCfg.health && !aiCfg.health.web_claude) { aiCfg.health.web_claude = { ok: true, error: '' }; saveAi(); paintAskWeb(); } // Mac aggiornato nel frattempo
      if (body.web && d.web === true && aiCfg.health && aiCfg.health.version !== String(d.version || '2')) { aiCfg.health.version = String(d.version || '2'); saveAi(); paintAskWeb(); } // versione del bridge (3 = ricerche mirate)
      askLater();
    }
    else if (name === 'error') err = d.message || 'errore sul Mac Studio';
    else if (name === 'done') done = true;
  });
  arm();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      arm(); feed(dec.decode(value, { stream: true }));
      if (err || done) break;
    }
  } catch (e) { if (!askSt.stopped || timedOut) err = timedOut ? 'Il Mac Studio ha smesso di rispondere. Riprova.' : A.MSG_DOWN; }
  clearTimeout(idle);
  try { reader.cancel().catch(() => {}); } catch {}
  if (!err && !done && !askSt.stopped) err = 'La risposta si è interrotta a metà. Riprova.';
  askDone(err);
}
function askDone(err) {
  askSt.busy = false; askSt.ctrl = null; askSt.thinking = false; askSt.searching = '';
  if (err) { askSt.error = err; askSt.info = ''; }
  paintAsk();
}
function askStop() { askSt.stopped = true; if (askSt.ctrl) askSt.ctrl.abort(); }
askEl.querySelectorAll('.ask-src button').forEach((b) => {
  b.onclick = () => { if (askSt.busy) return; askSt.src = b.dataset.src; aiCfg.src = askSt.src; saveAi(); paintAsk(); };
});
askEl.querySelectorAll('.ask-scope button').forEach((b) => {
  b.onclick = () => { if (askSt.busy) return; askSt.scope = b.dataset.scope; askSt.answer = ''; askSt.error = ''; askSt.last = null; paintAsk(); };
});
// "Cerca sul web": spento all'inizio, la scelta resta ricordata; la prima volta che lo accendi spiega cosa esce verso internet
$('ask-web').onclick = async () => {
  if (askSt.busy) return;
  if (!aiCfg.web && !aiCfg.webPrivacy) {
    const ok = await modal({ title: 'Cerca sul web', text: PRIVACY_WEB, options: [{ label: 'Accendi la ricerca sul web', value: 'ok', accent: true }, { label: 'Lascia spento', value: 'no' }] });
    if (!ok || ok.value !== 'ok') return;
    aiCfg.webPrivacy = 1;
  }
  aiCfg.web = !aiCfg.web; saveAi();
  paintAskWeb();
};
$('ask-form').onsubmit = (e) => { e.preventDefault(); const q = $('ask-input').value; askRun({ question: q }); };
$('ask-input').addEventListener('input', growAsk);
$('ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('ask-form').requestSubmit ? $('ask-form').requestSubmit() : $('ask-form').onsubmit(e); } });
for (const t of [$('ask-input'), $('ask-qedit-input')]) { // la tastiera si apre e si chiude con un po' di ritardo
  t.addEventListener('focus', () => setTimeout(placeAsk, 350));
  t.addEventListener('blur', () => setTimeout(placeAsk, 350));
}
$('ask-close').onclick = closeAsk;
askEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAsk(); } });
$('ask-retry').onclick = () => { if (askSt.busy) { askStop(); return; } const l = askSt.last; if (!l) return; askSt.scope = l.scope; askRun(l.what, { queries: l.queries }); };
$('ask-copy').onclick = () => { if (askSt.answer) copyText(A.withSources(askSt.answer, askSources().list, askQueries()), 'Risposta copiata'); };
// "Modifica ricerca": le ricerche fatte, una per riga; "Cerca di nuovo" rilancia la stessa richiesta con quelle
$('ask-qedit-open').onclick = () => {
  if (askSt.busy || !askSt.queries.length || !askSt.last) return;
  askSt.qedit = true; paintAskQueries();
  const t = $('ask-qedit-input'); t.value = askSt.queries.join('\n'); t.focus();
  try { t.setSelectionRange(t.value.length, t.value.length); } catch {}
};
$('ask-qedit-cancel').onclick = () => { askSt.qedit = false; paintAskQueries(); };
$('ask-qedit').onsubmit = (e) => {
  e.preventDefault();
  const list = A.parseQueries($('ask-qedit-input').value), l = askSt.last;
  if (!list.length) { $('ask-qedit-input').focus(); return; }
  if (!l || askSt.busy) return;
  $('ask-qedit-input').blur();
  askSt.scope = l.scope; askRun(l.what, { queries: list });
};
$('ask-qedit-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); askSt.qedit = false; paintAskQueries(); } });
$('ask-save').onclick = () => {
  const s = askSt.sel, l = askSt.last;
  if (!s || !l || !askSt.answer || askSt.saved) return;
  if (!nb.pages.includes(s.p)) { toast('La pagina è stata ricaricata: seleziona di nuovo il testo'); return; }
  const a = newAnn(s.part, A.commentText(l.what, l.src, askSt.model, askSt.answer, { web: !!l.web && !askSt.webOld, sources: askSources().list, queries: askQueries() }));
  if (s.rects && s.rects.length) a.r = s.rects;
  commitAnns([{ p: s.p, id: a.id, after: a }]);
  askSt.saved = a.id; paintAskOut();
  toast('Risposta salvata come commento sulla frase (pagina ' + s.page + ')', 3000);
};
const copyCmd = () => copyText(A.INSTALL_CMD, 'Comando copiato: incollalo nel Terminale del Mac Studio');
$('ask-setup-cmd').onclick = copyCmd;
$('ask-setup-open').onclick = () => { closeAsk(); openSettings(); };
$('btn-ask').onclick = () => { if (palmTap()) return; if (!askEl.hidden && !askSt.busy && !askSt.sel) { closeAsk(); return; } openAsk(false); };

// ---------- Impostazioni › Assistente ----------
function aiStatusLine(h) {
  const ul = $('ai-status'); ul.textContent = '';
  ul.hidden = !h;
  if (!h) return;
  for (const k of ['qwen', 'claude']) {
    const x = h[k] || {}, li = el('li');
    li.append(el('b', x.ok ? 'y' : 'n', x.ok ? '✓' : '✗'), el('span', '', A.SOURCES[k].label + (x.ok ? (k === 'qwen' ? ' · ' + x.default : ' · abbonamento' + (x.plan ? ' ' + x.plan : '')) : ' · ' + (x.error || 'non disponibile'))));
    ul.append(li);
  }
  // ricerca sul web (bridge della fase 8): Claude ✓, Qwen ✓ se sul Mac c'è la chiave Tavily
  if (!h.web_claude) { const li = el('li'); li.append(el('b', 'n', '✗'), el('span', '', 'Web · il bridge sul Mac Studio è vecchio: rilancia la riga di installazione')); ul.append(li); return; }
  for (const k of ['claude', 'qwen']) {
    const x = h['web_' + k] || {}, li = el('li');
    li.append(el('b', x.ok ? 'y' : 'n', x.ok ? '✓' : '✗'), el('span', '', 'Web con ' + A.SOURCES[k].label + (x.ok ? (k === 'qwen' ? ' · chiave Tavily presente' : ' · ricerca e lettura di pagine') : ' · ' + (x.error || 'non disponibile'))));
    ul.append(li);
  }
}
function paintAiModels() {
  const src = $('ai-src').value, sel = $('ai-model'), h = aiCfg.health && aiCfg.health[src];
  sel.textContent = '';
  const opts = src === 'claude' ? ((h && h.models) || ['sonnet', 'opus']).map((m) => [m, A.CLAUDE_MODELS[m] || m])
    : [['', 'Quello predefinito' + (h && h.default ? ' (' + h.default + ')' : '')], ...((h && h.models) || []).map((m) => [m, m])];
  for (const [v, t] of opts) { const o = el('option', '', t); o.value = v; sel.append(o); }
  const want = aiCfg.model[src] || (src === 'claude' ? (h && h.default) || 'sonnet' : '');
  sel.value = opts.some(([v]) => v === want) ? want : opts[0][0];
}
function paintAiChip(state, text) { $('ai-chip').dataset.state = state; $('ai-state').textContent = text; }
function renderAi() {
  $('ai-url').value = aiCfg.url || ''; $('ai-token').value = aiCfg.token || '';
  $('ai-err').hidden = true;
  $('ai-src').value = askSt.src;
  $('btn-ai-forget').hidden = !aiReady();
  $('ai-cmd').textContent = A.INSTALL_CMD;
  const h = aiCfg.health;
  if (!aiReady()) paintAiChip('off', 'Mac Studio non collegato');
  else if (h && (h.qwen.ok || h.claude.ok)) paintAiChip('idle', 'Collegato al Mac Studio');
  else paintAiChip('off', 'Indirizzo e token salvati: tocca Prova connessione');
  aiStatusLine(aiReady() ? h : null);
  paintAiModels();
}
function aiErr(msg) { const e = $('ai-err'); e.textContent = msg || ''; e.hidden = !msg; }
// incollando "https://…ts.net#token=…" nel campo indirizzo, il token va al suo posto
$('ai-url').addEventListener('input', () => {
  const r = A.parseUrl($('ai-url').value);
  if (r.ok && r.token) { $('ai-url').value = r.url; $('ai-token').value = r.token; aiErr(''); }
});
function readAiFields() {
  const u = A.parseUrl($('ai-url').value);
  if (!u.ok) { aiErr(u.error); return null; }
  const t = A.checkToken(u.token || $('ai-token').value);
  if (!t.ok) { aiErr(t.error); return null; }
  $('ai-url').value = u.url; $('ai-token').value = t.token;
  aiErr('');
  return { url: u.url, token: t.token };
}
async function testAi() {
  const f = readAiFields();
  if (!f) return;
  if (f.url !== aiCfg.url || f.token !== aiCfg.token) aiCfg.health = null;
  aiCfg.url = f.url; aiCfg.token = f.token; saveAi();
  $('btn-ai-forget').hidden = false;
  const btn = $('btn-ai-test'); btn.disabled = true;
  paintAiChip('syncing', 'Provo il collegamento…');
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(f.url + '/health?fresh=1', { headers: { Authorization: 'Bearer ' + f.token }, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok || !j || !j.qwen) throw Object.assign(new Error(A.errorText(r.status, j)), { said: true });
    aiCfg.health = { at: Date.now(), version: String(j.version || ''), qwen: j.qwen, claude: j.claude, web_claude: j.web_claude || null, web_qwen: j.web_qwen || null };
    // la sorgente scelta non c'è sul Mac ma l'altra sì: passo all'altra
    if (!j[askSt.src].ok && j[askSt.src === 'qwen' ? 'claude' : 'qwen'].ok) { askSt.src = askSt.src === 'qwen' ? 'claude' : 'qwen'; aiCfg.src = askSt.src; }
    saveAi();
    renderAi();
    paintAiChip(j.qwen.ok || j.claude.ok ? 'idle' : 'error', j.qwen.ok && j.claude.ok ? 'Collegato: Qwen e Claude pronti' : j.qwen.ok || j.claude.ok ? 'Collegato (solo ' + (j.qwen.ok ? 'Qwen' : 'Claude') + ')' : 'Collegato, ma né Qwen né Claude sono pronti');
  } catch (e) {
    paintAiChip('error', e.said ? e.message : A.MSG_DOWN);
    aiStatusLine(null);
  } finally { clearTimeout(t); btn.disabled = false; if (!askEl.hidden) paintAsk(); }
}
$('btn-ai-test').onclick = testAi;
$('ai-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); testAi(); } });
$('btn-ai-forget').onclick = async () => {
  $('settings').close();
  if (!(await confirmDlg('Scollegare il Mac Studio?', 'Tolgo indirizzo e token da questo dispositivo. Sul Mac Studio non cambia niente.', 'Scollega'))) { openSettings(); return; }
  delete aiCfg.url; delete aiCfg.token; aiCfg.health = null; saveAi();
  if (!askEl.hidden) paintAsk();
  openSettings();
};
$('ai-src').onchange = () => { askSt.src = $('ai-src').value; aiCfg.src = askSt.src; saveAi(); paintAiModels(); if (!askEl.hidden) paintAsk(); };
$('ai-model').onchange = () => { aiCfg.model[$('ai-src').value] = $('ai-model').value; saveAi(); };
$('btn-ai-cmd').onclick = copyCmd;

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
  closePop(); hideSelMenu();
  clearTimeout(resizeTimer);
  // girando l'iPad resto sulla stessa pagina (e nello stesso punto della pagina)
  resizeTimer = setTimeout(() => {
    if (!nb.pages.length || notebook.hidden) return;
    const i = curIndex(), p = nb.pages[i], f = (viewer.scrollTop - (p.wrap.offsetTop - nb.gap)) / (p.ch || 1);
    layout(); goToPage(i, f);
  }, 120);
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
    if (S.tool === 'text' || S.tool === 'select' || !allowed(e) || pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (!pop.hidden || !gotoEl.hidden) closePop();
    if (e.pointerType === 'pen') lastPen = performance.now();
    clearTimeout(scrubHide); scrub.classList.remove('show');
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
    if (e.pointerType === 'pen') lastPen = performance.now();
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
    if (e.pointerType === 'pen') lastPen = performance.now();
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
  if (a.type === 'ann') { for (const c of [...a.ch].reverse()) { const p = pageById(c.pid); if (p) setAnn(p, c.id, c.before); } return; }
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
  if (a.type === 'ann') { for (const c of a.ch) { const p = pageById(c.pid); if (p) setAnn(p, c.id, c.after); } return; }
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
  if (notebook.hidden || $('dlg').open || $('settings').open) return;
  const k = e.key, cmd = e.metaKey || e.ctrlKey;
  if (!gotoEl.hidden) { // tastiera fisica nel pannello "Vai a pagina"
    if (/^\d$/.test(k)) gotoKey(k); else if (k === 'Backspace') gotoKey('del'); else if (k === 'Enter') gotoKey('go'); else if (k === 'Escape') closePop(); else return;
    e.preventDefault(); return;
  }
  if (cmd && k.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
  if (cmd && k.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
  if (k === 'Escape' && selSnap) { endSel(); return; }
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (cmd && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (!cmd && (k === 'ArrowRight' || k === 'ArrowLeft') && viewer.scrollWidth <= viewer.clientWidth + 2) { e.preventDefault(); goToPage(curIndex() + (k === 'ArrowRight' ? 1 : -1)); }
});

// ---------- Salvataggio (automatico + tasto Salva) ----------
// Ogni modifica si salva da sola poco dopo (al massimo ~2,5 s anche scrivendo senza pause).
// In barra: "Modifiche non salvate" finché c'è qualcosa in sospeso, poi "Salvato alle 19:42".
const pending = new Set();
const saveSt = { dirty: false, at: 0 };
let saveTimer = null, firstPending = 0, saving = Promise.resolve();
const hhmm = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
function paintSave() {
  const s = $('save-state'), d = saveSt.dirty;
  s.dataset.state = d ? 'dirty' : 'saved';
  s.querySelector('.long').textContent = d ? 'Modifiche non salvate' : saveSt.at ? 'Salvato alle ' + hhmm(saveSt.at) : 'Salvato';
  s.querySelector('.short').textContent = d ? 'Non salvato' : 'Salvato';
  s.title = s.querySelector('.long').textContent;
  $('btn-save').classList.toggle('dirty', d);
  $('btn-save').setAttribute('aria-label', d ? 'Salva (ci sono modifiche non salvate)' : 'Salva');
}
function queueSave(rec) {
  pending.add(rec);
  if (!saveSt.dirty) { saveSt.dirty = true; paintSave(); }
  const now = Date.now();
  if (!firstPending) firstPending = now;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, Math.max(0, Math.min(600, firstPending + 2500 - now)));
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null; firstPending = 0;
  const list = [...pending]; pending.clear();
  if (!list.length) return saving;
  saving = saving.then(async () => { for (const r of list) await D.savePage(r); Sync.requestSync(); refreshSideThumbs(list); })
    .then(() => { if (!pending.size && !saveTimer) { saveSt.dirty = false; saveSt.at = Date.now(); paintSave(); } })
    .catch((e) => showError('Salvataggio non riuscito', e));
  return saving;
}
Sync.hooks.flush = flush;
document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); saveLastPage(); openGuard(false); } });
window.addEventListener('pagehide', () => { flush(); saveLastPage(); openGuard(false); });

// tasto Salva: scrive subito sul dispositivo e, se OneDrive è collegato, invia subito
async function saveNow() {
  if (!nb.node) return;
  const btn = $('btn-save');
  await flush();
  saveLastPage();
  await D.setMetaStrict('saved', Date.now()).catch(() => {});
  saveSt.dirty = pending.size > 0; saveSt.at = Date.now(); paintSave();
  btn.classList.remove('done'); void btn.offsetWidth; btn.classList.add('done');
  const msg = 'Salvato ✓ alle ' + hhmm(saveSt.at);
  if (!Sync.isConnected()) { toast(msg); return; }
  toast(msg + ' · invio a OneDrive…', 0);
  const res = await syncAndWait(20000);
  toast(msg + ({ idle: ' · copiato su OneDrive', offline: ' · sei offline: lo invio a OneDrive appena torna la rete', error: ' · OneDrive: ' + Sync.status.msg }[res] || ' · invio a OneDrive in corso'), 4500);
}
function syncAndWait(ms) {
  return new Promise((resolve) => {
    let done = false, seen = false, t = 0;
    const h = (st) => { if (st.state === 'syncing') seen = true; else if (seen || st.state !== 'idle') fin(st.state); };
    const fin = (v) => { if (done) return; done = true; Sync.offStatus(h); clearTimeout(t); resolve(v); };
    t = setTimeout(() => fin('timeout'), ms);
    Sync.onStatus(h);
    Sync.syncNow();
  });
}
$('btn-save').onclick = saveNow;
$('btn-save-menu').onclick = async () => {
  const conn = Sync.isConnected();
  const r = await modal({ title: 'Salva ed esporta',
    text: (saveSt.dirty ? 'Ci sono modifiche non ancora salvate.' : saveSt.at ? 'Salvato alle ' + hhmm(saveSt.at) + '.' : 'È tutto salvato.') + ' Le modifiche si salvano anche da sole mentre scrivi' + (conn ? ' e vanno su OneDrive.' : '.'),
    options: [{ label: 'Salva ora', value: 'save', icon: 'save' }, { label: 'Esporta PDF con annotazioni', value: 'export', icon: 'share' }, { label: 'Salva una copia del quaderno', value: 'copy', icon: 'dup' }] });
  if (!r) return;
  if (r.value === 'save') saveNow(); else if (r.value === 'export') exportPdf(); else copyNotebook();
};

// "Salva copia": un nuovo quaderno uguale, con tutte le annotazioni (il PDF originale non viene duplicato)
async function copyNotebook() {
  await flush();
  const src = nb.node;
  const r = await modal({ title: 'Salva una copia', text: 'Crea un nuovo quaderno identico a questo, con tutte le annotazioni. Lo trovi nella libreria.', input: src.name + ' (copia)',
    options: [{ label: 'Salva copia', value: 'ok', accent: true }] });
  if (!r) return;
  const n = await D.newNode('notebook', r.text.trim() || src.name + ' (copia)', src.parent);
  n.color = src.color; await D.put('nodes', n);
  const now = Date.now();
  const copies = (await D.pagesOf(src.id)).map((p) => {
    const c = JSON.parse(JSON.stringify(p));
    delete c.etag; c.id = D.uid(); c.nb = n.id; c.updated = now; c.dirty = 1;
    return c;
  });
  await D.putMany('pages', copies);
  Sync.requestSync();
  toast('Copia salvata nella libreria: “' + n.name + '”', 3500);
  return n;
}

// ---------- Strumenti e pannello colore/spessore ----------
const pop = $('pop'), popBack = $('pop-backdrop');
let popAnchor = null;
function paintDots() {
  $('tool-pen').querySelector('.dot').style.background = S.pen.color;
  $('tool-hl').querySelector('.dot').style.background = S.hl.color;
}
function paintPreview() {
  const c = $('pop-preview'), ctx = c.getContext('2d'), W = c.width, H = c.height, hl = S.tool === 'hl' || S.tool === 'select', o = cfg();
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
  const hl = S.tool === 'hl' || S.tool === 'select', on = S.tool === 'pen' || hl, o = hl ? S.hl : S.pen, sw = $('btn-color').querySelector('.swatch');
  sw.style.background = o.color; sw.style.opacity = hl ? String(Math.max(0.45, o.alpha + 0.25)) : '1';
  sw.style.setProperty('--sz', (10 + o.size * 1.4) + 'px');
  $('btn-color').disabled = !on;
}
function paintPop() {
  const o = cfg(), hl = S.tool === 'hl' || S.tool === 'select';
  $('pop-title').textContent = S.tool === 'select' ? 'Colore per evidenziare il testo' : hl ? 'Evidenziatore' : 'Penna';
  $('row-alpha').hidden = !hl;
  $('row-size').hidden = S.tool === 'select';
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
function closePop() { pop.hidden = true; gotoEl.hidden = true; popBack.hidden = true; popAnchor = null; }
// pannello a comparsa vicino al pulsante: sotto se il pulsante è in alto, sopra se è in basso
function placePopover(box, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const above = r.top > innerHeight / 2;
  const top = above ? Math.max(8, r.top - h - 12) : r.bottom + 12;
  box.classList.toggle('above', above);
  box.style.left = left + 'px'; box.style.top = top + 'px';
  box.style.setProperty('--ax', Math.max(22, Math.min(w - 22, r.left + r.width / 2 - left)) + 'px');
}
function openPop(anchor) {
  closePop();
  popAnchor = anchor;
  pop.hidden = false; popBack.hidden = false;
  paintPop(); placePopover(pop, anchor);
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
  const was = S.tool;
  S.tool = t;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x.dataset.tool === t));
  $('text-tools').hidden = t !== 'text';
  notebook.classList.toggle('mode-text', t === 'text');
  notebook.classList.toggle('mode-select', t === 'select');
  paintColorChip();
  for (const p of nb.pages) { p.wrap.classList.toggle('textmode', t === 'text'); p.wrap.classList.toggle('selmode', t === 'select'); }
  closePop();
  if (was === 'select' && t !== 'select') endSel();
  if (t === 'select' && was !== 'select') startSelectMode();
}
document.querySelectorAll('.tool').forEach((b) => {
  b.onclick = () => {
    const t = b.dataset.tool;
    // secondo tocco sullo strumento attivo (penna o evidenziatore) = pannello colore e spessore
    if (S.tool === t && (t === 'pen' || t === 'hl' || t === 'select')) { if (justClosed()) return; pop.hidden ? openPop(b) : closePop(); return; }
    setTool(t);
  };
});
$('btn-color').onclick = () => { if (justClosed()) return; if (!pop.hidden) { closePop(); return; } if (S.tool === 'pen' || S.tool === 'hl' || S.tool === 'select') openPop($('tool-' + S.tool)); };
// tocco fuori dal pannello = chiudi. Su iPad dopo il tocco arriva anche un "click" sul pulsante sotto il dito:
// se è lo stesso pulsante che apre il pannello, lo ignoro (altrimenti si riaprirebbe subito)
let popClosedAt = 0;
const justClosed = () => Date.now() - popClosedAt < 500;
popBack.addEventListener('pointerdown', (e) => { e.preventDefault(); closePop(); popClosedAt = Date.now(); });
paintColorChip();

async function closeNotebook() {
  closePop(); endSel(); closeAsk();
  await flush();
  saveLastPage();
  D.setMeta('open', null).catch(() => {});
  teardownPages();
  releasePdfs();
  nb.node = null;
  notebook.hidden = true; library.hidden = false;
  refreshLibrary();
}
$('btn-back').onclick = closeNotebook;

// ---------- Esporta PDF ----------
async function exportBytes(onProgress) {
  await flush();
  const recs = await D.pagesOf(nb.node.id);
  const blobs = new Map();
  for (const r of recs) {
    for (const id of [r.type === 'pdf' ? r.blob : null, ...(r.images || []).map((i) => i.blob)]) {
      if (id && !blobs.has(id)) { const b = await D.get('blobs', id); if (b) blobs.set(id, b); }
    }
  }
  return buildNotebookPdf(recs, blobs, onProgress);
}
let exporting = false;
async function exportPdf() {
  if (exporting || !nb.node) return;
  exporting = true;
  toast('Preparo il PDF con le annotazioni…', 0);
  const t0 = performance.now();
  try {
    const bytes = await exportBytes((i, n) => toast('Preparo il PDF… pagina ' + i + ' di ' + n, 0));
    const name = nb.node.name.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
    const file = new File([bytes], name, { type: 'application/pdf' });
    toast('');
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    // Safari apre "Condividi" solo subito dopo un tocco: se preparare il PDF ha richiesto tempo, chiedo un tocco in più
    let how = canShare && performance.now() - t0 < 900 ? 'share' : null;
    for (let tries = 0; tries < 2; tries++) {
      if (!how) {
        const r = await modal({ title: 'Il PDF è pronto', text: name + ' · ' + (bytes.length / 1048576).toFixed(1).replace('.', ',') + ' MB',
          options: [...(canShare ? [{ label: 'Condividi o salva in File', value: 'share', accent: true }] : []), { label: 'Scarica', value: 'dl', icon: 'save' }] });
        if (!r) return;
        how = r.value;
      }
      if (how === 'share') {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; how = null; continue; }
      }
      break;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('PDF scaricato');
  } catch (err) { toast(''); showError('Non riesco a creare il PDF', err); }
  finally { exporting = false; }
}

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
const openSettings = () => { renderSync(); renderAi(); $('settings').showModal(); };
$('btn-settings').onclick = openSettings;
$('btn-status').onclick = openSettings;
$('set-close').onclick = () => $('settings').close();
$('btn-sync').onclick = () => Sync.syncNow();
$('btn-onedrive').onclick = () => Sync.signIn();
$('btn-signout').onclick = async () => { $('settings').close(); if (await confirmDlg('Scollegare OneDrive?', 'I quaderni restano su questo dispositivo e su OneDrive.', 'Scollega')) Sync.signOut(); };
Sync.onData(function applyRemote() {
  if (!library.hidden) { refreshLibrary(); return; }
  if (nb.drawing || pending.size || selSnap || $('cdlg').open || (!askEl.hidden && askSt.sel) || document.activeElement?.closest?.('.txt')) { setTimeout(applyRemote, 1500); return; }
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
// riapro il quaderno che era aperto (Safari su iPad chiude spesso le app in secondo piano)
async function resumeLast() {
  let guard = null;
  try { guard = localStorage.getItem('penna.opening'); localStorage.removeItem('penna.opening'); } catch {}
  if (guard) return; // l'ultima apertura non è arrivata in fondo (app chiusa di colpo?): meglio non riprovare da solo
  const id = await D.getMeta('open');
  if (!id || !notebook.hidden) return;
  const n = await D.get('nodes', id);
  if (n && !n.deleted) await openNotebook(id);
}
(async () => {
  try {
    await migrateLegacy();
    await refreshLibrary();
    await resumeLast();
  } catch (e) { showError('Avvio', e); }
  renderSync();
  await Sync.init();
})();

// Appigli per i test automatici
window.__penna = { D, Sync, S, nb, lib, openNotebook, refreshLibrary, exportBytes, flush, buildPages, setTool, runSearch, pdfjs, thumbUrl, version: APP_VERSION,
  goToPage, curIndex, saveNow, saveSt, copyNotebook, runFind, closeNotebook, want, stats: () => ({ rendering, want: want.size, drawn: nb.pages.filter((p) => p.bg.width > 0).length, textLayers: tlPages.size }),
  N, readSelection, allMarkdown, tlPages, undo, redo, copyText, A, ask: { st: askSt, cfg: aiCfg, open: openAsk, close: closeAsk, run: askRun, test: testAi, place: placeAsk, sizes: askSizes, snap: setSnap } };
