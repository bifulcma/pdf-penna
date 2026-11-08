// Lettura su iPhone: funzioni pure sul testo delle pagine PDF (pdf.js getTextContent), senza DOM.
// - lines(): pezzi di testo → righe (in punti del PDF, origine in basso a sinistra come nel PDF)
// - textBox(): dove sta il testo nella pagina (per tagliare i margini bianchi e ingrandire)
// - paragraphs(): righe → paragrafi da mostrare «a colonna» nella modalità lettura

const fsOf = (it) => Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
// solo testo orizzontale (niente scritte ruotate a margine)
const flat = (it) => Math.abs(it.transform[1]) < 0.02 * Math.abs(it.transform[0] || 1) && it.transform[0] > 0;

// pezzi → righe, nell'ordine del PDF. Una riga nuova quando la linea di base cambia o il testo torna indietro.
export function lines(items) {
  const out = [];
  let cur = null;
  for (const it of items || []) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    const s = it.str;
    if (!s.trim()) { if (cur && s) cur.sp = true; if (it.hasEOL && cur) cur.eol = true; continue; }
    if (!flat(it)) continue;
    const fs = fsOf(it), x = it.transform[4], y = it.transform[5], w = it.width || 0;
    if (fs <= 0) continue;
    const same = cur && !cur.eol && Math.abs(y - cur.y) < Math.max(cur.fs, fs) * 0.45 && x > cur.x1 - Math.max(cur.fs, fs) * 0.6;
    if (!same) {
      cur = { str: s, x0: x, x1: x + w, y, fs, n: s.length, eol: false, sp: false };
      out.push(cur);
    } else {
      const gap = x - cur.x1;
      const space = cur.sp || (gap > Math.min(cur.fs, fs) * 0.12 && !/\s$/.test(cur.str) && !/^\s/.test(s));
      cur.str += (space ? ' ' : '') + s;
      cur.x1 = Math.max(cur.x1, x + w); cur.x0 = Math.min(cur.x0, x);
      cur.fs = Math.max(cur.fs, fs); cur.n += s.length; cur.sp = false;
    }
    if (it.hasEOL) cur.eol = true;
  }
  for (const l of out) { l.str = l.str.replace(/\s+/g, ' ').trim(); delete l.sp; delete l.eol; }
  return out.filter((l) => l.str);
}

const quant = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

// corpo del testo più usato (pesato sui caratteri): per sapere quanto è grande «il testo normale»
export function bodySize(ls) {
  const w = new Map();
  for (const l of ls) { const k = Math.round(l.fs * 2) / 2; w.set(k, (w.get(k) || 0) + l.n); }
  let best = 0, bn = -1;
  for (const [k, n] of w) if (n > bn) { bn = n; best = k; }
  return best;
}

// riquadro orizzontale del testo, in frazioni della larghezza della pagina [x0, x1] (view = [x0, y0, x1, y1] del PDF).
// Si ignorano le righe isolate più esterne (numeri di pagina, note a margine): 2% per lato, pesato sui caratteri.
export function textBox(ls, view) {
  const W = view[2] - view[0];
  if (!ls.length || W <= 0) return null;
  const chars = ls.reduce((s, l) => s + l.n, 0);
  if (chars < 40) return null; // pochissimo testo (copertina, scansione con due parole): meglio non tagliare
  const left = [], right = [];
  for (const l of ls) { const k = Math.max(1, Math.round(l.n / 10)); for (let i = 0; i < k; i++) { left.push(l.x0); right.push(l.x1); } }
  const a = (quant(left, 0.02) - view[0]) / W, b = (quant(right, 0.98) - view[0]) / W;
  if (!(b > a)) return null;
  return [Math.max(0, a), Math.min(1, b)];
}

// unione dei riquadri di più pagine (pagine pari e dispari dei libri hanno i margini a specchio) + un filo di margine.
// Ritorna { l, r } oppure null se non conviene tagliare (guadagno < 6%).
export function cropOf(boxes, pad = 0.025) {
  const bs = boxes.filter(Boolean);
  if (!bs.length) return null;
  const l = Math.max(0, Math.min(...bs.map((b) => b[0])) - pad), r = Math.min(1, Math.max(...bs.map((b) => b[1])) + pad);
  if (r - l < 0.3 || r - l > 0.94) return r - l > 0.94 ? null : { l: 0, r: 1 };
  return { l: Math.round(l * 1000) / 1000, r: Math.round(r * 1000) / 1000 };
}

const ENDS = /[.!?:;»”"')\]…]$/;
// righe → paragrafi. Un paragrafo nuovo se: spazio verticale più grande del solito, corpo diverso (titoli),
// rientro della prima riga, oppure la riga prima finisce corta con un punto.
export function paragraphs(ls) {
  if (!ls.length) return [];
  const body = bodySize(ls) || ls[0].fs;
  const steps = [];
  for (let i = 1; i < ls.length; i++) { const d = ls[i - 1].y - ls[i].y; if (d > 0 && d < body * 3) steps.push(d); }
  const lead = quant(steps, 0.5) || body * 1.3;
  const colL = quant(ls.map((l) => l.x0), 0.1), colR = quant(ls.map((l) => l.x1), 0.9);
  const out = [];
  let cur = null;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], prev = ls[i - 1];
    let split = !cur;
    if (!split) {
      const d = prev.y - l.y;
      const sizeJump = Math.abs(l.fs - prev.fs) > Math.max(l.fs, prev.fs) * 0.12;
      const bigGap = d > lead * 1.45 || d < -body * 0.5; // salto in su = colonna nuova
      const indent = l.x0 - colL > body * 0.9 && prev.x0 - colL < body * 0.5 && l.x1 > colR - body * 2;
      const shortEnd = prev.x1 < colR - body * 2.5 && ENDS.test(prev.str);
      split = sizeJump || bigGap || indent || shortEnd;
    }
    if (split) { cur = { lines: [], fs: l.fs, text: '' }; out.push(cur); }
    cur.lines.push(l);
    cur.fs = Math.max(cur.fs, l.fs);
    // a capo con trattino in mezzo a una parola: si riunisce («lun-» + «ghezza» = «lunghezza»)
    if (!cur.text) cur.text = l.str;
    else if (/[a-zà-ÿ]-$/i.test(cur.text) && /^[a-zà-ÿ]/.test(l.str)) cur.text = cur.text.slice(0, -1) + l.str;
    else cur.text += ' ' + l.str;
  }
  for (const p of out) p.heading = p.fs > body * 1.2 && p.text.length < 200;
  return out;
}

// riquadro di una riga in coordinate del PDF: [x0, yBasso, x1, yAlto] (un po' sopra e sotto la linea di base)
export const lineBox = (l) => [l.x0, l.y - l.fs * 0.24, l.x1, l.y + l.fs * 0.86];
