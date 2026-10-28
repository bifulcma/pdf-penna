// Esporta un quaderno in PDF (pdf-lib, locale). Sfondi, immagini, testo, evidenziazioni e tratti vengono "stampati" sulle pagine;
// i commenti diventano note PDF.
import { STRIKE } from './notes.js';

export const LAYOUT = { font: 0.028, margin: 0.06, lined: 0.055, grid: 0.04, a4: 1.4142, lh: 1.35, gap: 0.5 };
export const HL_ALPHA = 0.35;

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

export function drawStrokes(page, list) {
  const { rgb, LineCapStyle } = window.PDFLib;
  const { width: w, height: h } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const dispW = rot % 180 ? h : w;
  for (const s of list) {
    if (!s.pts.length) continue;
    const [r, g, b] = hexToRgb(s.c);
    const color = rgb(r, g, b);
    const pts = s.pts.map((q) => toPdf(q[0], q[1], w, h, rot));
    const base = s.w * dispW;
    if (s.t === 'hl') {
      const [x0, y0] = pts[0];
      let d = 'M ' + x0 + ' ' + (-y0);
      for (let i = 1; i < pts.length; i++) d += ' L ' + pts[i][0] + ' ' + (-pts[i][1]);
      if (pts.length === 1) d += ' L ' + (x0 + 0.01) + ' ' + (-y0);
      page.drawSvgPath(d, { x: 0, y: 0, borderColor: color, borderWidth: base, borderOpacity: s.a ?? HL_ALPHA, borderLineCap: LineCapStyle.Round });
    } else if (pts.length === 1) {
      page.drawCircle({ x: pts[0][0], y: pts[0][1], size: base * s.pts[0][2] / 2, color });
    } else {
      for (let i = 1; i < pts.length; i++) {
        page.drawLine({
          start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] },
          thickness: base * (s.pts[i - 1][2] + s.pts[i][2]) / 2, color, lineCap: LineCapStyle.Round,
        });
      }
    }
  }
}

// altezza della barra di Barra/Modifica dentro la riga (frazione dall'alto): a metà delle lettere minuscole, come sullo schermo
export const STRIKE_Y = 0.52;
// evidenziazioni del testo (sotto i tratti, effetto pennarello) e commenti come note PDF:
// Anteprima, Acrobat e simili mostrano l'icona del commento e, toccandola, il testo.
// Barra / Modifica (a.k 'del' / 'sub'): linea rossa sopra il testo; Modifica ha anche il segno ^ e una nota col testo nuovo.
export function drawAnns(doc, page, anns) {
  if (!anns || !anns.length) return;
  const { rgb, BlendMode, PDFHexString, PDFString, LineCapStyle } = window.PDFLib;
  const { width: w, height: h } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const dispH = rot % 180 ? w : h;
  for (const a of anns) {
    const fix = a.k === 'del' || a.k === 'sub';
    const [r, g, b] = hexToRgb(fix ? STRIKE : a.c || '#f5c400');
    for (const q of a.r || []) {
      if (fix) {
        const y = q.t + q.h * STRIKE_Y, p1 = toPdf(q.l, y, w, h, rot), p2 = toPdf(q.l + q.w, y, w, h, rot);
        page.drawLine({ start: { x: p1[0], y: p1[1] }, end: { x: p2[0], y: p2[1] }, thickness: Math.max(0.8, q.h * dispH * 0.09), color: rgb(r, g, b), lineCap: LineCapStyle.Round });
        continue;
      }
      const p1 = toPdf(q.l, q.t, w, h, rot), p2 = toPdf(q.l + q.w, q.t + q.h, w, h, rot);
      page.drawRectangle({ x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), width: Math.abs(p2[0] - p1[0]), height: Math.abs(p2[1] - p1[1]),
        color: rgb(r, g, b), opacity: a.a ?? HL_ALPHA, blendMode: BlendMode.Multiply });
    }
    const q = (a.r || [])[0];
    const note = a.k === 'sub' ? 'Sostituisci con: «' + (a.s || '') + '»' : a.k === 'del' ? '' : a.n;
    if (!note || !q) continue;
    if (a.k === 'sub') {
      // segno ^ sotto la fine del testo barrato (punto in cui va il testo nuovo)
      const z = a.r[a.r.length - 1], cx = z.l + z.w, cy = z.t + z.h * 0.88, d = z.h * 0.26, ar = rot % 180 ? h / w : w / h;
      const pts = [[cx - d * 0.6 / ar, cy + d], [cx, cy], [cx + d * 0.6 / ar, cy + d]].map(([u, v]) => toPdf(u, v, w, h, rot));
      for (let i = 1; i < 3; i++) page.drawLine({ start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] }, thickness: Math.max(0.8, z.h * dispH * 0.08), color: rgb(r, g, b), lineCap: LineCapStyle.Round });
    }
    // nota nel margine destro, all'altezza della prima riga evidenziata (come sullo schermo)
    const [x, y] = toPdf(0.955, q.t + q.h / 2, w, h, rot), s = 18;
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: 'Text', Name: a.k === 'sub' ? 'Insert' : 'Comment', F: 4, Open: false,
      Rect: [x - s / 2, y - s / 2, x + s / 2, y + s / 2], C: [r, g, b],
      Contents: PDFHexString.fromText(note), T: PDFHexString.fromText('PDF Penna'), Subj: PDFHexString.fromText('«' + a.q + '»'),
      M: PDFString.fromDate(new Date(a.u || a.t || Date.now())),
    });
    page.node.addAnnot(doc.context.register(annot));
  }
}

function drawBackground(page, type) {
  const { rgb } = window.PDFLib;
  const { width: W, height: H } = page.getSize();
  const col = rgb(0.78, 0.82, 0.86);
  if (type === 'lined') {
    const step = W * LAYOUT.lined;
    for (let y = H - W * LAYOUT.margin - step; y > 0; y -= step) page.drawLine({ start: { x: 0, y }, end: { x: W, y }, thickness: 0.6, color: col });
  } else if (type === 'grid') {
    const step = W * LAYOUT.grid;
    for (let y = H - step; y > 0; y -= step) page.drawLine({ start: { x: 0, y }, end: { x: W, y }, thickness: 0.5, color: col });
    for (let x = step; x < W; x += step) page.drawLine({ start: { x, y: 0 }, end: { x, y: H }, thickness: 0.5, color: col });
  }
}

async function drawImages(doc, page, images, blobs) {
  const { width: W, height: H } = page.getSize();
  for (const im of images || []) {
    const b = blobs.get(im.blob);
    if (!b) continue;
    try {
      const emb = b.mime === 'image/png' ? await doc.embedPng(b.data) : await doc.embedJpg(b.data);
      const w = im.w * W, h = w * im.ar;
      page.drawImage(emb, { x: im.x * W, y: H - im.y * W - h, width: w, height: h });
    } catch (e) { /* immagine illeggibile: la salto */ }
  }
}

function safe(font, s) {
  let out = '';
  for (const ch of s) { try { font.encodeText(ch); out += ch; } catch { out += '?'; } }
  return out;
}
function wrap(font, text, size, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const t = cur ? cur + ' ' + word : word;
      if (cur && font.widthOfTextAtSize(t, size) > maxW) { lines.push(cur); cur = word; } else cur = t;
    }
    lines.push(cur);
  }
  return lines;
}

function drawBlocks(page, blocks, fonts) {
  const { rgb } = window.PDFLib;
  const { width: W, height: H } = page.getSize();
  const fs = W * LAYOUT.font, m = W * LAYOUT.margin;
  const ink = rgb(0.17, 0.15, 0.14);
  let y = H - m;
  for (const b of blocks || []) {
    const isH = b.type === 'h';
    const size = isH ? fs * 1.5 : fs;
    const font = isH ? fonts.bold : fonts.reg;
    const lh = size * LAYOUT.lh;
    const rows = b.type === 'h' || b.type === 'p' ? [{ t: b.text || '' }] : (b.items || []);
    const indent = b.type === 'ul' || b.type === 'todo' ? fs * 1.4 : 0;
    for (const row of rows) {
      const lines = wrap(font, safe(font, row.t || ''), size, W - 2 * m - indent);
      lines.forEach((ln, i) => {
        y -= lh;
        if (y < 0) return;
        if (i === 0 && b.type === 'ul') page.drawText('•', { x: m + fs * 0.3, y: y + lh * 0.2, size, font, color: ink });
        if (i === 0 && b.type === 'todo') {
          const s = fs * 0.8;
          page.drawRectangle({ x: m + fs * 0.1, y: y + lh * 0.2, width: s, height: s, borderColor: ink, borderWidth: 0.8, color: row.done ? ink : undefined });
        }
        page.drawText(ln, { x: m + indent, y: y + lh * 0.2, size, font, color: row.done ? rgb(0.55, 0.52, 0.5) : ink });
      });
    }
    y -= fs * LAYOUT.gap;
  }
}

// pages: record ordinati; blobs: Map id -> {mime,data}; onProgress(fatte, totale) facoltativo
export async function buildNotebookPdf(pages, blobs, onProgress) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  // pagine di ogni PDF copiate tutte insieme: font e immagini in comune vengono copiati una volta sola
  // (una pagina alla volta, un libro di 300 pagine diventerebbe enorme)
  const copied = new Map(); // blob -> Map(pdfPage -> pagina copiata)
  for (const [id, b] of blobs) {
    const want = [...new Set(pages.filter((p) => p.type === 'pdf' && p.blob === id).map((p) => p.pdfPage))];
    if (!want.length) continue;
    const src = await PDFDocument.load(b.data, { ignoreEncryption: true });
    const ok = want.filter((i) => i < src.getPageCount());
    const out = await doc.copyPages(src, ok);
    copied.set(id, new Map(ok.map((i, k) => [i, out[k]])));
  }
  let done = 0;
  for (const p of pages) {
    if (onProgress && ++done % 20 === 0) { onProgress(done, pages.length); await new Promise((r) => setTimeout(r, 0)); }
    let page;
    if (p.type === 'pdf') {
      const m = copied.get(p.blob);
      page = m && m.get(p.pdfPage);
      if (!page) continue;
      m.delete(p.pdfPage); // la stessa pagina non si aggiunge due volte
      doc.addPage(page);
    } else {
      page = doc.addPage([595.28, 595.28 * LAYOUT.a4]);
      drawBackground(page, p.type);
    }
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    if (rot === 0) {
      await drawImages(doc, page, p.images, blobs);
      drawBlocks(page, p.blocks, fonts);
    }
    drawAnns(doc, page, p.anns);
    drawStrokes(page, p.strokes || []);
  }
  if (!doc.getPageCount()) doc.addPage([595.28, 595.28 * LAYOUT.a4]);
  return doc.save();
}
