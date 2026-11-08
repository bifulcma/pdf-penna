// Lettura su iPhone: funzioni pure sul testo delle pagine PDF (pdf.js getTextContent), senza DOM.
// - lines(): pezzi di testo → righe (in punti del PDF, origine in basso a sinistra come nel PDF)
// - textBox(): dove sta il testo nella pagina (per tagliare i margini bianchi e ingrandire)
// - paragraphs(): righe → paragrafi da mostrare «a colonna» nella modalità lettura

const fsOf = (it) => Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
// solo testo orizzontale (niente scritte ruotate a margine)
const flat = (it) => Math.abs(it.transform[1]) < 0.02 * Math.abs(it.transform[0] || 1) && it.transform[0] > 0;

// peso di larghezza di una lettera quando non si può misurare col carattere vero (stima: i, l, spazio stretti; m, w larghe)
export const charWeight = (ch) => (/\s/.test(ch) ? 0.28 : /[iljtfrI.,;:'’!|()\[\]-]/.test(ch) ? 0.3 : /[mwMW@%]/.test(ch) ? 0.82 : /[A-Z]/.test(ch) ? 0.68 : 0.52);
// dove sta ogni lettera di un pezzo di testo: [x inizio, x fine] in punti del PDF. La larghezza del pezzo (vera, data dal PDF)
// si divide tra le lettere in proporzione alla loro larghezza (wf(lettera, font) misurata, oppure stimata)
function charXs(it, wf) {
  const s = it.str, x = it.transform[4], w = it.width || 0, ws = [];
  let tot = 0;
  for (let i = 0; i < s.length; i++) { const v = Math.max(0.01, +(wf ? wf(s[i], it.fontName) : charWeight(s[i])) || 0.01); ws.push(v); tot += v; }
  const out = [];
  let acc = 0;
  for (let i = 0; i < s.length; i++) { const a = x + (w * acc) / tot; acc += ws[i]; out.push([a, x + (w * acc) / tot]); }
  return out;
}

// pezzi → righe, nell'ordine del PDF. Una riga nuova quando la linea di base cambia o il testo torna indietro.
// Ogni riga ha anche cx: la posizione di ogni lettera di str (per evidenziare solo alcune parole).
export function lines(items, wf) {
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
    const xs = charXs(it, wf);
    if (!same) {
      cur = { str: s, cx: xs, x0: x, x1: x + w, y, fs, n: s.length, eol: false, sp: false };
      out.push(cur);
    } else {
      const gap = x - cur.x1;
      const space = cur.sp || (gap > Math.min(cur.fs, fs) * 0.12 && !/\s$/.test(cur.str) && !/^\s/.test(s));
      if (space) cur.cx.push([cur.x1, Math.max(cur.x1, x)]);
      cur.cx.push(...xs);
      cur.str += (space ? ' ' : '') + s;
      cur.x1 = Math.max(cur.x1, x + w); cur.x0 = Math.min(cur.x0, x);
      cur.fs = Math.max(cur.fs, fs); cur.n += s.length; cur.sp = false;
    }
    if (it.hasEOL) cur.eol = true;
  }
  // spazi doppi → uno solo, niente spazi ai lati (le posizioni delle lettere seguono)
  for (const l of out) {
    let t = '';
    const cx = [];
    for (let i = 0; i < l.str.length; i++) {
      const ch = l.str[i];
      if (/\s/.test(ch)) { if (t && t[t.length - 1] !== ' ') { t += ' '; cx.push(l.cx[i]); } } else { t += ch; cx.push(l.cx[i]); }
    }
    if (t.endsWith(' ')) { t = t.slice(0, -1); cx.pop(); }
    l.str = t; l.cx = cx; delete l.sp; delete l.eol;
  }
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
    if (split) { cur = { lines: [], fs: l.fs, text: '', map: [] }; out.push(cur); }
    const li = cur.lines.length;
    cur.lines.push(l);
    cur.fs = Math.max(cur.fs, l.fs);
    // map: per ogni lettera del paragrafo [riga, x inizio, x fine] (null = spazio messo tra due righe)
    const own = (l.cx && l.cx.length === l.str.length ? l.cx : [...l.str].map(() => [l.x0, l.x1])).map(([a, b]) => [li, a, b]);
    // a capo con trattino in mezzo a una parola: si riunisce («lun-» + «ghezza» = «lunghezza»)
    if (!cur.text) { cur.text = l.str; cur.map.push(...own); }
    else if (/[a-zà-ÿ]-$/i.test(cur.text) && /^[a-zà-ÿ]/.test(l.str)) { cur.text = cur.text.slice(0, -1) + l.str; cur.map.pop(); cur.map.push(...own); }
    else { cur.text += ' ' + l.str; cur.map.push(null, ...own); }
  }
  for (const p of out) p.heading = p.fs > body * 1.2 && p.text.length < 200;
  return out;
}

// riquadro di una riga in coordinate del PDF: [x0, yBasso, x1, yAlto] (un po' sopra e sotto la linea di base)
export const lineBox = (l) => [l.x0, l.y - l.fs * 0.24, l.x1, l.y + l.fs * 0.86];

// [a, b) allargato alle parole intere (senza spazi ai lati); null se dentro ci sono solo spazi
export function wordSpan(text, a, b) {
  a = Math.max(0, Math.min(a, text.length)); b = Math.max(a, Math.min(b, text.length));
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (b <= a) return null;
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return [a, b];
}

// lettere [a, b) di un paragrafo → un riquadro per riga toccata, in coordinate del PDF [x0, yBasso, x1, yAlto]
export function spanBoxes(g, a, b) {
  const by = new Map();
  for (let i = Math.max(0, a); i < Math.min(b, g.text.length); i++) {
    const m = g.map[i];
    if (!m || /\s/.test(g.text[i])) continue;
    const c = by.get(m[0]);
    if (!c) by.set(m[0], [m[1], m[2]]); else { c[0] = Math.min(c[0], m[1]); c[1] = Math.max(c[1], m[2]); }
  }
  return [...by].sort((x, y) => x[0] - y[0]).map(([li, [x0, x1]]) => { const bx = lineBox(g.lines[li]); return [x0, bx[1], x1, bx[3]]; });
}

// Evidenziatore «intelligente»: il tratto del dito (pts, frazioni della pagina) passa sopra righe di testo?
// rows: [{ t, h, str, cx: [[l, r]] }] in frazioni della pagina; aspect = altezza / larghezza della pagina.
// Se almeno il 60% dei punti sta su una riga: per ogni riga toccata le parole intere sotto il dito [{ row, a, b }]; altrimenti null.
export function strokeWords(rows, pts, aspect = 1.414) {
  if (!rows || !rows.length || !pts || !pts.length) return null;
  const hits = new Map();
  let on = 0;
  for (const [x, y] of pts) {
    let best = -1, bd = Infinity;
    rows.forEach((r, i) => {
      if (!r.cx.length) return;
      const pad = r.h * aspect * 0.6, L = r.cx[0][0], Rr = r.cx[r.cx.length - 1][1];
      if (x < L - pad || x > Rr + pad) return;
      const d = Math.abs(y - (r.t + r.h / 2));
      if (d <= r.h * 0.75 && d < bd) { bd = d; best = i; }
    });
    if (best < 0) continue;
    on++;
    const h = hits.get(best);
    if (!h) hits.set(best, [x, x]); else { h[0] = Math.min(h[0], x); h[1] = Math.max(h[1], x); }
  }
  if (on < pts.length * 0.6) return null;
  const out = [];
  for (const [i, [x0, x1]] of hits) {
    const r = rows[i];
    let a = -1, b = -1, near = -1, nd = Infinity;
    r.cx.forEach(([l, rr], k) => {
      if (/\s/.test(r.str[k])) return;
      if (rr >= x0 && l <= x1) { if (a < 0) a = k; b = k + 1; }
      const d = Math.min(Math.abs(l - x0), Math.abs(rr - x0));
      if (d < nd) { nd = d; near = k; }
    });
    if (a < 0) { if (near < 0) continue; a = near; b = near + 1; }
    const w = wordSpan(r.str, a, b);
    if (w) out.push({ row: i, a: w[0], b: w[1] });
  }
  return out.length ? out.sort((p, q) => p.row - q.row) : null;
}
