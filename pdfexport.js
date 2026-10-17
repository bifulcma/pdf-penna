// Esporta un quaderno in PDF (pdf-lib, locale). Sfondi, immagini, testo e tratti vengono "stampati" sulle pagine.
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
      page.drawSvgPath(d, { x: 0, y: 0, borderColor: color, borderWidth: base, borderOpacity: HL_ALPHA, borderLineCap: LineCapStyle.Round });
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

// pages: record ordinati; blobs: Map id -> {mime,data}
export async function buildNotebookPdf(pages, blobs) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const srcs = new Map();
  for (const p of pages) {
    let page;
    if (p.type === 'pdf') {
      const b = blobs.get(p.blob);
      if (!b) continue;
      if (!srcs.has(p.blob)) srcs.set(p.blob, await PDFDocument.load(b.data, { ignoreEncryption: true }));
      const src = srcs.get(p.blob);
      if (p.pdfPage >= src.getPageCount()) continue;
      [page] = await doc.copyPages(src, [p.pdfPage]);
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
    drawStrokes(page, p.strokes || []);
  }
  if (!doc.getPageCount()) doc.addPage([595.28, 595.28 * LAYOUT.a4]);
  return doc.save();
}
