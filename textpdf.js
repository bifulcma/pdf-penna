// Un testo in markdown semplice (la risposta dell'AI: trascrizione della scrittura a mano + analisi) → PDF A4 da leggere
// e spedire (pdf-lib, locale: niente esce dall'iPad per fare il PDF). Brief 14, 18/11/26.
// Titolo, riga piccola (che cos'è, pagina, modello, data), poi titoli, capoversi, elenchi, citazioni, codice; grassetto e
// corsivo veri; in fondo «PDF Penna · pagina N di M». Caratteri che Helvetica non ha: sostituiti (→ diventa ->) o tolti.
import { mdBlocks, mdInline } from './ask.js';

const A4 = [595.28, 841.89], M = 56, SIZE = 11, LH = 1.42;
const SWAP = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '−': '-', '\u2011': '-', '✓': 'ok', '✗': 'x', '✦': '*', '▪': '•', '◦': '•', '●': '•', '☐': '[ ]', '☑': '[x]', '\u2009': ' ', '\u202f': ' ', '\u200b': '', '\ufeff': '' };

// solo i caratteri che il font sa scrivere (WinAnsi): gli altri si cambiano con qualcosa di simile, o «?»
export function safeText(font, s) {
  let out = '';
  for (const ch of String(s).normalize('NFC')) {
    if (ch === '\t') { out += '  '; continue; }
    const c = SWAP[ch] !== undefined ? SWAP[ch] : ch;
    if (!c) continue;
    try { font.encodeText(c); out += c; } catch {
      const cp = ch.codePointAt(0);
      if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) continue; // emoji: via
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); // lettera con un segno che il font non ha: senza segno
      try { font.encodeText(plain); out += plain; } catch { out += '?'; }
    }
  }
  return out;
}

// pezzi in linea → [{ s, font }] (grassetto dentro corsivo e viceversa compresi; i link: testo e indirizzo)
function runs(text, F, bold = false, ital = false, out = []) {
  const font = bold && ital ? F.bi : bold ? F.b : ital ? F.i : F.r;
  for (const r of mdInline(text)) {
    if (r.t === 'b') runs(r.s, F, true, ital, out);
    else if (r.t === 'i') runs(r.s, F, bold, true, out);
    else if (r.t === 'a') out.push({ s: r.s === r.href ? r.href : r.s + ' (' + r.href + ')', font });
    else out.push({ s: r.s, font });
  }
  return out;
}
// righe che stanno in maxW: si va a capo solo sugli spazi; una parola più larga della riga si spezza
function wrapRuns(list, size, maxW, spaceW) {
  const atoms = [];
  let sp = false;
  for (const r of list) {
    for (const tok of safeText(r.font, r.s).split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { sp = true; continue; }
      let t = tok;
      while (r.font.widthOfTextAtSize(t, size) > maxW && t.length > 1) { // parola lunghissima (un indirizzo): a pezzi
        let n = t.length - 1;
        while (n > 1 && r.font.widthOfTextAtSize(t.slice(0, n), size) > maxW) n--;
        atoms.push({ t: t.slice(0, n), font: r.font, sp, w: r.font.widthOfTextAtSize(t.slice(0, n), size) });
        t = t.slice(n); sp = true;
      }
      atoms.push({ t, font: r.font, sp, w: r.font.widthOfTextAtSize(t, size) });
      sp = false;
    }
  }
  const lines = [];
  let cur = [], w = 0;
  for (let i = 0; i < atoms.length; i++) {
    // un gruppo = pezzi attaccati senza spazio («**parola**,»): non si separano
    let j = i, gw = atoms[i].w;
    while (j + 1 < atoms.length && !atoms[j + 1].sp) { j++; gw += atoms[j].w; }
    const lead = cur.length && atoms[i].sp ? spaceW : 0;
    if (cur.length && w + lead + gw > maxW) { lines.push(cur); cur = []; w = 0; }
    for (let k = i; k <= j; k++) { const a = atoms[k]; cur.push({ t: (cur.length && a.sp ? ' ' : '') + a.t, font: a.font }); }
    w += (cur.length > j - i + 1 ? lead : 0) + gw;
    i = j;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// md: testo in markdown; title: titolo in cima; meta: riga piccola sotto il titolo → Uint8Array del PDF
export async function buildTextPdf(md, { title = '', meta = '' } = {}) {
  const L = (typeof window !== 'undefined' ? window : globalThis).PDFLib;
  const { PDFDocument, StandardFonts, rgb } = L;
  const doc = await PDFDocument.create();
  const F = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold),
    i: await doc.embedFont(StandardFonts.HelveticaOblique), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique), m: await doc.embedFont(StandardFonts.Courier) };
  const ink = rgb(0.13, 0.12, 0.11), soft = rgb(0.42, 0.4, 0.38), line = rgb(0.8, 0.78, 0.75);
  const W = A4[0] - 2 * M;
  let page = null, y = 0;
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const need = (h) => { if (!page || y - h < M + 14) newPage(); };
  // un capoverso: righe già spezzate, con rientro e (sulla prima riga) un segno davanti (• o «3.»)
  const para = (list, { size = SIZE, indent = 0, mark = '', color = ink, gap = 0.55, keep = 1 } = {}) => {
    const lh = size * LH, lines = wrapRuns(list, size, W - indent, F.r.widthOfTextAtSize(' ', size));
    lines.forEach((ln, i) => {
      need(i === 0 ? lh * Math.min(lines.length, keep) : lh); // un titolo non resta solo in fondo alla pagina
      y -= lh;
      if (i === 0 && mark) page.drawText(mark, { x: M + indent - F.r.widthOfTextAtSize(mark, size) - 5, y: y + lh * 0.28, size, font: F.r, color });
      let x = M + indent, buf = '', bf = null;
      const flush = () => { if (buf) { page.drawText(buf, { x, y: y + lh * 0.28, size, font: bf, color }); x += bf.widthOfTextAtSize(buf, size); buf = ''; } };
      for (const a of ln) { if (a.font !== bf) { flush(); bf = a.font; } buf += a.t; }
      flush();
    });
    y -= size * gap;
  };
  newPage();
  if (title) para([{ s: title, font: F.b }], { size: 17, gap: 0.25 });
  if (meta) para([{ s: meta, font: F.r }], { size: 9, color: soft, gap: 0.6 });
  if (title || meta) { page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: line }); y -= 12; }
  for (const b of mdBlocks(md)) {
    if (b.t === 'h') { y -= 5; para(runs(b.text, F, true), { size: b.level <= 2 ? 13.5 : 12, gap: 0.35, keep: 3 }); }
    // gli a capo dentro un capoverso restano (come sullo schermo): in una trascrizione ogni riga scritta a mano è una riga
    else if (b.t === 'p') b.text.split('\n').forEach((ln, i, all) => para(runs(ln, F), { gap: i === all.length - 1 ? 0.55 : 0.08 }));
    else if (b.t === 'quote') b.text.split('\n').forEach((ln, i, all) => para(runs(ln, F, false, true), { indent: 16, color: soft, gap: i === all.length - 1 ? 0.55 : 0.08 }));
    else if (b.t === 'hr') { need(14); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: line }); y -= 10; }
    else if (b.t === 'code') { for (const ln of b.text.split('\n')) para([{ s: ln || ' ', font: F.m }], { size: 9.5, indent: 10, gap: 0 }); y -= SIZE * 0.55; }
    else b.items.forEach((it, i) => para(runs(it, F), { indent: b.t === 'ol' ? 22 : 16, mark: b.t === 'ol' ? ((b.start || 1) + i) + '.' : '•', gap: i === b.items.length - 1 ? 0.55 : 0.22 }));
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = 'PDF Penna · pagina ' + (i + 1) + ' di ' + pages.length;
    p.drawText(t, { x: A4[0] - M - F.r.widthOfTextAtSize(t, 8), y: M - 22, size: 8, font: F.r, color: soft });
  });
  if (title) doc.setTitle(safeText(F.r, title));
  doc.setCreator('PDF Penna');
  return doc.save();
}
