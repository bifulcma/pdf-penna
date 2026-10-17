import * as pdfjsLib from './lib/pdf.min.mjs';
import * as D from './db.js';
import * as Sync from './sync.js';
import { buildNotebookPdf, LAYOUT, HL_ALPHA } from './pdfexport.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const LIB = new URL('./lib/', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const library = $('library'), notebook = $('notebook'), viewer = $('viewer'), pagesEl = $('pages');
const TYPE_LABEL = { blank: 'Foglio bianco', lined: 'Righe', grid: 'Quadretti', pdf: 'PDF' };

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
const fmtDate = (t) => new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });

// Finestra di dialogo: ritorna { value, text } oppure null se annullata
function modal({ title, text = '', input = null, options = [] }) {
  return new Promise((resolve) => {
    const dlg = $('dlg'), inp = $('dlg-input'), opts = $('dlg-options');
    $('dlg-title').textContent = title; $('dlg-text').textContent = text;
    inp.hidden = input === null; inp.value = input ?? '';
    opts.textContent = '';
    let done = false;
    const close = (v) => { if (done) return; done = true; dlg.onclose = null; dlg.oncancel = null; if (dlg.open) dlg.close(); resolve(v); };
    let swRow = null;
    for (const o of options) {
      let b;
      if (o.file) {
        b = el('label', 'tb', o.label);
        const fi = el('input'); fi.type = 'file'; fi.accept = o.file; fi.hidden = true;
        fi.onchange = () => { const f = fi.files[0]; if (f) close({ value: o.value, file: f, text: inp.value }); };
        b.append(fi);
      } else if (o.color) {
        if (!swRow) { swRow = el('div', 'sw-row'); opts.append(swRow); }
        b = el('button', 'tb sw'); b.type = 'button'; b.style.background = o.color; b.setAttribute('aria-label', o.label);
        b.onclick = () => close({ value: o.value, text: inp.value });
        swRow.append(b); continue;
      } else {
        b = el('button', 'tb' + (o.accent ? ' accent' : '') + (o.danger ? ' danger' : ''), o.label); b.type = 'button';
        b.onclick = () => close({ value: o.value, text: inp.value });
      }
      opts.append(b);
    }
    $('dlg-form').onsubmit = (e) => { e.preventDefault(); const first = options.find((o) => !o.file && !o.color); if (first) close({ value: first.value, text: inp.value }); };
    $('dlg-cancel').onclick = () => close(null);
    dlg.oncancel = (e) => { e.preventDefault(); close(null); };
    dlg.onclose = () => { if (!dlg.open) close(null); };
    dlg.showModal();
    if (!inp.hidden) { inp.focus(); inp.select(); }
  });
}
const confirmDlg = async (title, text, label = 'Elimina') =>
  !!(await modal({ title, text, options: [{ label, value: 'ok', danger: true }] }));

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
    } catch (e) { console.error('migrazione', e); }
  }
  await D.setMeta('legacy-migrated', 1);
}

// ---------- PDF ----------
const pdfOpts = { standardFontDataUrl: LIB + 'standard_fonts/', cMapUrl: LIB + 'cmaps/', cMapPacked: true, iccUrl: LIB + 'iccs/', wasmUrl: LIB + 'wasm/' };
async function pdfAspects(buf) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), ...pdfOpts });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
    out.push(vp.height / vp.width);
  }
  task.destroy();
  return out;
}
const pdfDocs = new Map();
function getPdf(blobId) {
  if (!pdfDocs.has(blobId)) {
    const pr = (async () => {
      const b = await D.get('blobs', blobId);
      if (!b) throw new Error('allegato mancante');
      return pdfjsLib.getDocument({ data: new Uint8Array(b.data.slice(0)), ...pdfOpts }).promise;
    })();
    pr.catch(() => pdfDocs.delete(blobId));
    pdfDocs.set(blobId, pr);
  }
  return pdfDocs.get(blobId);
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

// ---------- Libreria ----------
const lib = { cwd: null };
async function refreshLibrary() {
  const nodes = (await D.all('nodes')).filter((n) => !n.deleted);
  const pages = (await D.all('pages')).filter((p) => !p.deleted);
  if (lib.cwd && !nodes.find((n) => n.id === lib.cwd)) lib.cwd = null;
  const count = {};
  for (const p of pages) count[p.nb] = (count[p.nb] || 0) + 1;
  const kids = {};
  for (const n of nodes) if (n.parent) kids[n.parent] = (kids[n.parent] || 0) + 1;

  const crumbs = $('crumbs'); crumbs.textContent = '';
  const path = [];
  for (let c = lib.cwd; c;) { const n = nodes.find((x) => x.id === c); if (!n) break; path.unshift(n); c = n.parent; }
  const root = el('button', '', 'Tutti i quaderni'); root.onclick = () => { lib.cwd = null; refreshLibrary(); };
  crumbs.append(root);
  for (const n of path) { crumbs.append(el('span', '', '›')); const b = el('button', '', n.name); b.onclick = () => { lib.cwd = n.id; refreshLibrary(); }; crumbs.append(b); }

  const items = nodes.filter((n) => (n.parent || null) === lib.cwd)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'it') : a.kind === 'folder' ? -1 : 1));
  const grid = $('lib-grid'); grid.textContent = '';
  $('lib-empty').hidden = items.length > 0;
  for (const n of items) {
    const card = el('div', 'card'); card.dataset.id = n.id;
    const cover = el('button', 'cover'); cover.style.background = n.color; cover.setAttribute('aria-label', 'Apri ' + n.name);
    cover.append(el('span', 'icon', n.kind === 'folder' ? '📁' : '📓'));
    cover.onclick = () => (n.kind === 'folder' ? (lib.cwd = n.id, refreshLibrary()) : openNotebook(n.id));
    const info = el('div', 'info');
    info.append(el('b', '', n.name));
    const sub = n.kind === 'folder' ? ((kids[n.id] || 0) === 1 ? '1 elemento' : (kids[n.id] || 0) + ' elementi') : ((count[n.id] || 0) === 1 ? '1 pagina' : (count[n.id] || 0) + ' pagine') + ' · ' + fmtDate(n.updated);
    info.append(el('span', 'meta', sub));
    const more = el('button', 'more', '⋯'); more.setAttribute('aria-label', 'Opzioni'); more.onclick = () => nodeMenu(n, nodes);
    card.append(cover, info, more);
    grid.append(card);
  }
  if ($('search').value.trim()) runSearch();
}

async function nodeMenu(n, nodes) {
  const r = await modal({ title: n.name, options: [
    { label: 'Apri', value: 'open' }, { label: 'Rinomina', value: 'rename' }, { label: 'Cambia colore', value: 'color' },
    { label: 'Sposta in…', value: 'move' }, { label: 'Elimina', value: 'del', danger: true }] });
  if (!r) return;
  if (r.value === 'open') return n.kind === 'folder' ? (lib.cwd = n.id, refreshLibrary()) : openNotebook(n.id);
  if (r.value === 'rename') {
    const q = await modal({ title: 'Rinomina', input: n.name, options: [{ label: 'Salva', value: 'ok', accent: true }] });
    if (q && q.text.trim()) { n.name = q.text.trim(); await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'color') {
    const q = await modal({ title: 'Colore della copertina', options: D.COLORS.map((c) => ({ color: c, label: c, value: c })) });
    if (q) { n.color = q.value; await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'move') {
    const bad = new Set([n.id]);
    for (let grow = true; grow;) { grow = false; for (const x of nodes) if (x.parent && bad.has(x.parent) && !bad.has(x.id)) { bad.add(x.id); grow = true; } }
    const folders = nodes.filter((x) => x.kind === 'folder' && !bad.has(x.id));
    const q = await modal({ title: 'Sposta “' + n.name + '” in…', options: [{ label: 'Tutti i quaderni (principale)', value: '' }, ...folders.map((f) => ({ label: '📁 ' + f.name, value: f.id }))] });
    if (q) { n.parent = q.value || null; await D.saveNode(n); Sync.requestSync(); refreshLibrary(); }
  } else if (r.value === 'del') {
    if (await confirmDlg('Eliminare “' + n.name + '”?', n.kind === 'folder' ? 'Verrà eliminato anche tutto quello che contiene.' : 'Il quaderno e le sue pagine verranno eliminati (anche da OneDrive).')) {
      await D.deleteNode(n); Sync.requestSync(); refreshLibrary();
    }
  }
}

$('btn-new-nb').onclick = async () => {
  const r = await modal({ title: 'Nuovo quaderno', input: 'Nuovo quaderno', options: [
    { label: 'Con pagine a righe', value: 'lined', accent: true }, { label: 'Con pagine a quadretti', value: 'grid' }, { label: 'Con foglio bianco', value: 'blank' }] });
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
  toast('Importo il PDF…', 0);
  try {
    const n = await D.newNode('notebook', f.name.replace(/\.pdf$/i, ''), lib.cwd);
    await addPdfPages(n.id, await f.arrayBuffer(), f.name, (i) => i);
    Sync.requestSync(); toast('');
    openNotebook(n.id);
  } catch (err) { console.error(err); toast('Non riesco ad aprire questo PDF.'); }
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
  res.hidden = !on; $('lib-grid').hidden = on; $('crumbs').hidden = on; $('lib-empty').hidden = true;
  if (!on) { refreshLibrary(); return; }
  const nodes = (await D.all('nodes')).filter((n) => !n.deleted);
  const pages = (await D.all('pages')).filter((p) => !p.deleted).sort((a, b) => a.order - b.order);
  const low = q.toLowerCase();
  res.textContent = '';
  let n = 0;
  for (const nd of nodes) {
    if (!nd.name.toLowerCase().includes(low)) continue;
    n++;
    const li = el('li'), b = el('button'); b.className = 'hit';
    const t = el('span', 't'); t.append(nd.kind === 'folder' ? '📁 ' : '📓 ', highlight(nd.name, q));
    b.append(t, el('span', 's', nd.kind === 'folder' ? 'Cartella' : 'Quaderno'));
    b.onclick = () => (nd.kind === 'folder' ? (lib.cwd = nd.id, $('search').value = '', refreshLibrary()) : openNotebook(nd.id));
    li.append(b); res.append(li);
  }
  for (const p of pages) {
    const nd = nodes.find((x) => x.id === p.nb);
    if (!nd) continue;
    const idx = pages.filter((x) => x.nb === p.nb).indexOf(p) + 1;
    for (const bl of p.blocks || []) {
      const tx = blockText(bl);
      if (!tx.toLowerCase().includes(low)) continue;
      n++;
      const li = el('li'), b = el('button'); b.className = 'hit';
      const t = el('span', 't'); t.append(highlight(tx.length > 90 ? tx.slice(0, 90) + '…' : tx, q));
      b.append(t, el('span', 's', nd.name + ' · pagina ' + idx));
      b.onclick = () => openNotebook(nd.id, p.id);
      li.append(b); res.append(li);
      break;
    }
  }
  if (!n) res.append(el('li', 'muted', 'Nessun risultato. (La scrittura a mano non si può cercare.)'));
}
let searchTimer;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });

// ---------- Quaderno aperto ----------
const S = { tool: 'pen', color: '#1a1a1a', size: 3 };
const nb = { node: null, pages: [], zoom: 1, undo: [], redo: [], drawing: 0 };

async function openNotebook(id, focusPageId) {
  const node = await D.get('nodes', id);
  if (!node || node.deleted) return;
  nb.node = node; nb.zoom = 1; nb.undo = []; nb.redo = []; updateUndoButtons();
  library.hidden = true; notebook.hidden = false; notebook.classList.remove('side-open');
  await buildPages();
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  if (focusPageId) { const p = nb.pages.find((x) => x.rec.id === focusPageId); if (p) viewer.scrollTop = p.wrap.offsetTop - 12; }
  updatePageIndicator();
}

function teardownPages() {
  for (const p of nb.pages) { observer.unobserve(p.wrap); if (p.task) { try { p.task.cancel(); } catch {} } }
  nb.pages = []; pagesEl.textContent = '';
}
async function buildPages() {
  teardownPages();
  const recs = await D.pagesOf(nb.node.id);
  for (const rec of recs) {
    const wrap = el('div', 'page'); wrap.dataset.id = rec.id;
    const bg = el('canvas', 'bg'), imgs = el('div', 'imgs'), txt = el('div', 'txt'), draw = el('canvas', 'draw');
    wrap.append(bg, imgs, txt, draw);
    pagesEl.append(wrap);
    const p = { rec, wrap, bg, imgs, txt, draw, aspect: rec.aspect || LAYOUT.a4, rendered: false, task: null, cw: 0, ch: 0 };
    nb.pages.push(p);
    wrap.classList.toggle('textmode', S.tool === 'text');
    renderText(p); renderImages(p); attachDrawing(p);
  }
  layout();
  renderSidebar();
}
function fitWidth() { return Math.max(200, viewer.clientWidth - 24); }
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
}, { root: viewer, rootMargin: '1200px 0px' });

const MAX_PIXELS = 9e6;
function pixelRatio(p) { return Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (p.cw * p.ch))); }

function paintPattern(p) {
  const c = p.bg, ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  const W = c.width, k = W / p.cw; // px canvas per px css
  ctx.strokeStyle = '#c8d1db'; ctx.lineWidth = Math.max(1, k * 0.8);
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  if (p.rec.type === 'lined') {
    const step = W * LAYOUT.lined;
    for (let y = W * LAYOUT.margin + step; y < c.height; y += step) line(0, y, W, y);
  } else if (p.rec.type === 'grid') {
    const step = W * LAYOUT.grid;
    for (let y = step; y < c.height; y += step) line(0, y, W, y);
    for (let x = step; x < W; x += step) line(x, 0, x, c.height);
  }
}
async function renderPage(p) {
  if (p.rendered) return;
  p.rendered = true;
  if (p.task) { try { p.task.cancel(); } catch {} }
  const r = pixelRatio(p);
  const W = Math.round(p.cw * r), H = Math.round(p.ch * r);
  p.draw.width = W; p.draw.height = H;
  redrawPage(p);
  if (p.rec.type !== 'pdf') {
    p.bg.width = W; p.bg.height = H; paintPattern(p);
    p.wrap.dataset.rendered = '1';
    return;
  }
  try {
    const pdf = await getPdf(p.rec.blob);
    const page = await pdf.getPage(p.rec.pdfPage + 1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (p.cw / base.width) * r });
    const off = document.createElement('canvas');
    off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    const task = page.render({ canvas: off, canvasContext: off.getContext('2d'), viewport: vp });
    p.task = task;
    await task.promise;
    if (p.task !== task) return;
    p.bg.width = off.width; p.bg.height = off.height;
    p.bg.getContext('2d').drawImage(off, 0, 0);
    p.wrap.dataset.rendered = '1';
  } catch (e) { p.rendered = false; /* annullato oppure allegato non ancora scaricato */ }
}
function releasePage(p) {
  if (!p.rendered) return;
  p.rendered = false;
  if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
  p.bg.width = 0; p.draw.width = 0;
  delete p.wrap.dataset.rendered;
}

function currentPage() {
  const mid = viewer.scrollTop + viewer.clientHeight / 2;
  let cur = nb.pages[0];
  for (const p of nb.pages) { if (p.wrap.offsetTop <= mid) cur = p; else break; }
  return cur;
}
function updatePageIndicator() {
  if (!nb.pages.length) { $('page-ind').textContent = ''; return; }
  const cur = currentPage();
  $('page-ind').textContent = 'Pag. ' + (nb.pages.indexOf(cur) + 1) + ' / ' + nb.pages.length;
  document.querySelectorAll('#page-list li').forEach((li, i) => li.classList.toggle('cur', nb.pages[i] === cur));
}
viewer.addEventListener('scroll', updatePageIndicator, { passive: true });

// ---------- Barra laterale (pagine) ----------
function pageLabel(p) {
  const h = (p.rec.blocks || []).find((b) => b.type === 'h' && b.text);
  return h ? h.text : TYPE_LABEL[p.rec.type] + (p.rec.type === 'pdf' ? ' · pag. ' + (p.rec.pdfPage + 1) : '');
}
function renderSidebar() {
  $('side-title').textContent = nb.node.name;
  const ol = $('page-list'); ol.textContent = '';
  nb.pages.forEach((p, i) => {
    const li = el('li');
    const go = el('button', 'go', (i + 1) + '. ' + pageLabel(p));
    go.onclick = () => { viewer.scrollTo({ top: p.wrap.offsetTop - 12 }); notebook.classList.remove('side-open'); };
    const up = el('button', 'mini', '▲'); up.setAttribute('aria-label', 'Sposta su'); up.disabled = i === 0; up.onclick = () => movePage(i, -1);
    const dn = el('button', 'mini', '▼'); dn.setAttribute('aria-label', 'Sposta giù'); dn.disabled = i === nb.pages.length - 1; dn.onclick = () => movePage(i, 1);
    const rm = el('button', 'mini', '✕'); rm.setAttribute('aria-label', 'Elimina pagina'); rm.onclick = () => removePage(i);
    li.append(go, up, dn, rm); ol.append(li);
  });
  updatePageIndicator();
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
$('btn-pages').onclick = () => notebook.classList.toggle('side-open');

$('btn-add-page').onclick = async () => {
  const r = await modal({ title: 'Aggiungi pagina', options: [
    { label: 'Foglio bianco', value: 'blank' }, { label: 'Righe', value: 'lined' }, { label: 'Quadretti', value: 'grid' },
    { label: 'Importa un PDF…', file: 'application/pdf,.pdf', value: 'pdf' }] });
  if (!r) return;
  await flush();
  const cur = nb.pages.indexOf(currentPage());
  const lo = nb.pages[cur].rec.order, hi = nb.pages[cur + 1] ? nb.pages[cur + 1].rec.order : lo + 2;
  const order = (i, n) => lo + (hi - lo) * (i + 1) / (n + 1);
  try {
    if (r.value === 'pdf') { toast('Importo il PDF…', 0); await addPdfPages(nb.node.id, await r.file.arrayBuffer(), r.file.name, order); toast(''); }
    else await D.put('pages', D.blankPage(nb.node.id, order(0, 1), r.value));
  } catch (e) { console.error(e); toast('Non riesco ad aprire questo PDF.'); return; }
  Sync.requestSync();
  await buildPages();
  const added = nb.pages[cur + 1]; if (added) viewer.scrollTo({ top: added.wrap.offsetTop - 12 });
  notebook.classList.remove('side-open');
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
  const x = el('button', 'x', '×'); x.setAttribute('aria-label', 'Elimina blocco');
  x.onclick = () => { p.rec.blocks = p.rec.blocks.filter((q) => q !== b); box.remove(); queueSave(p.rec); renderSidebar(); };
  box.append(x);
  if (b.type === 'h' || b.type === 'p') {
    const ta = el('textarea'); ta.rows = 1; ta.value = b.text || '';
    ta.placeholder = b.type === 'h' ? 'Titolo' : 'Scrivi qui…';
    ta.oninput = () => { b.text = ta.value; growTa(ta); queueSave(p.rec); if (b.type === 'h') renderSidebar(); };
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
    const x = el('button', 'x', '×'); x.setAttribute('aria-label', 'Elimina immagine');
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
  return { data: await blob.arrayBuffer(), mime: png ? 'image/png' : 'image/jpeg', ar: c.height / c.width };
}
async function insertImage(file) {
  const p = currentPage(); if (!p) return;
  try {
    const n = await normalizeImage(file);
    const blob = await D.addBlob(n.data, n.mime, 'immagine');
    p.rec.images.push({ id: D.uid(), blob: blob.id, x: 0.1, y: 0.1, w: 0.5, ar: n.ar });
    await renderImages(p); queueSave(p.rec);
  } catch (e) { console.error(e); toast('Non riesco a inserire questa immagine.'); }
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
window.addEventListener('resize', () => { if (nb.pages.length && !notebook.hidden) layout(); });

// ---------- Disegno ----------
const widthFactor = (t) => (t === 'hl' ? 0.005 : 0.0007);

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
  c.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
  }, { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('pointerdown', (e) => {
    if (S.tool === 'text' || !allowed(e) || pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pid = e.pointerId; nb.drawing = 1;
    try { c.setPointerCapture(pid); } catch {}
    const [x, y] = norm(e);
    if (S.tool === 'eraser') { erased = []; eraseAt(p, x, y, erased); return; }
    cur = { t: S.tool, c: S.color, w: S.size * widthFactor(S.tool), pts: [[x, y, factor(e)]] };
    redrawPage(p, cur);
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = norm(ev);
      if (S.tool === 'eraser') { eraseAt(p, x, y, erased); continue; }
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
  if (!list.length) return;
  const rx = S.size * 0.004;
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
    for (const id of new Set(a.items.map((it) => it.pid))) { const p = pageById(id); if (p) { redrawPage(p); queueSave(p.rec); } }
  }
}
function applyRedo(a) {
  if (a.type === 'add') {
    const p = pageById(a.pid); if (!p) return;
    p.rec.strokes.push(a.stroke); redrawPage(p); queueSave(p.rec);
  } else {
    for (const it of a.items) { const p = pageById(it.pid); if (p) { const i = p.rec.strokes.indexOf(it.stroke); if (i >= 0) p.rec.strokes.splice(i, 1); } }
    for (const id of new Set(a.items.map((it) => it.pid))) { const p = pageById(id); if (p) { redrawPage(p); queueSave(p.rec); } }
  }
}
$('btn-undo').onclick = () => { const a = nb.undo.pop(); if (!a) return; applyUndo(a); nb.redo.push(a); updateUndoButtons(); };
$('btn-redo').onclick = () => { const a = nb.redo.pop(); if (!a) return; applyRedo(a); nb.undo.push(a); updateUndoButtons(); };

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
  saving = saving.then(async () => { for (const r of list) await D.savePage(r); Sync.requestSync(); })
    .catch(() => toast('Salvataggio non riuscito'));
  return saving;
}
Sync.hooks.flush = flush;
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', () => flush());

// ---------- Strumenti ----------
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x.dataset.tool === t));
  $('text-tools').hidden = t !== 'text';
  for (const p of nb.pages) p.wrap.classList.toggle('textmode', t === 'text');
}
document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
document.querySelectorAll('.color').forEach((b) => {
  b.onclick = () => {
    S.color = b.dataset.color;
    document.querySelectorAll('.color').forEach((x) => x.classList.toggle('active', x === b));
    if (S.tool === 'eraser' || S.tool === 'text') setTool('pen');
  };
});
$('size').oninput = (e) => { S.size = Number(e.target.value); };

async function closeNotebook() {
  await flush();
  teardownPages();
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
  } catch (err) { console.error(err); toast('Non riesco a creare il PDF.'); }
  finally { btn.disabled = false; }
};

// ---------- Stato della sincronizzazione ----------
function renderSync() {
  const st = Sync.status, conf = Sync.isConfigured(), conn = Sync.isConnected();
  const label = {
    off: conf ? 'OneDrive non collegato' : 'Solo su questo dispositivo',
    idle: 'Sincronizzato' + (st.last ? ' · ' + new Date(st.last).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''),
    syncing: 'Sincronizzazione in corso…',
    offline: 'Offline · si sincronizza quando torna la rete',
    error: 'Errore: ' + st.msg,
  }[st.state];
  $('sync-text').textContent = label;
  document.querySelectorAll('.sync-chip').forEach((c) => { c.dataset.state = st.state; c.title = label; });
  $('btn-sync').hidden = !conn; $('btn-signout').hidden = !conn;
  $('btn-onedrive').hidden = conn && !(st.state === 'error' && /riaccedere/.test(st.msg));
  $('btn-onedrive').textContent = conn ? '☁ Accedi di nuovo' : '☁ Collega OneDrive';
  $('btn-onedrive').disabled = !conf;
  $('btn-sync').disabled = st.state === 'syncing';
  $('sync-help').textContent = conf ? (conn && st.account ? 'Account: ' + st.account : '')
    : 'Per collegare OneDrive serve il codice dell’app (Client ID) nel file config.js. Finché non c’è, i quaderni restano solo su questo dispositivo.';
}
Sync.onStatus(renderSync);
$('btn-sync').onclick = () => Sync.syncNow();
$('btn-onedrive').onclick = () => Sync.signIn();
$('btn-signout').onclick = async () => { if (await confirmDlg('Scollegare OneDrive?', 'I quaderni restano su questo dispositivo e su OneDrive.', 'Scollega')) Sync.signOut(); };
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
      const f = await params.files[0].getFile();
      const n = await D.newNode('notebook', f.name.replace(/\.pdf$/i, ''), null);
      await addPdfPages(n.id, await f.arrayBuffer(), f.name, (i) => i);
      openNotebook(n.id);
    }
  });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
(async () => {
  await migrateLegacy();
  await refreshLibrary();
  renderSync();
  await Sync.init();
})();

// Appigli per i test automatici
window.__penna = { D, Sync, S, nb, lib, openNotebook, refreshLibrary, exportBytes, flush, buildPages, setTool, runSearch };
