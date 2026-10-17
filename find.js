// Ricerca nel testo delle pagine: maiuscole/minuscole e accenti non contano ("liberta" trova "libertà").
// Il testo dei PDF arriva da pdf.js (getTextContent): qui solo funzioni pure, facili da provare.

const MARKS = /[̀-ͯ]/g;
// "piega" un testo per il confronto. map[i] = posizione nel testo originale del carattere i del testo piegato
export function foldMap(str) {
  const out = [], map = [];
  let space = true; // niente spazi iniziali, spazi multipli = uno solo
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9 || c === 160 || c === 0x2028) {
      if (!space) { out.push(' '); map.push(i); space = true; }
      continue;
    }
    space = false;
    if (c < 128) { out.push(c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : str[i]); map.push(i); continue; }
    // NFKD: toglie gli accenti e scioglie le legature dei PDF (ﬁ → fi)
    for (const ch of str[i].normalize('NFKD').replace(MARKS, '').toLowerCase()) { out.push(ch); map.push(i); }
  }
  return { s: out.join(''), map };
}
export const fold = (q) => foldMap(q).s.trim();

// unisce i pezzi di testo di una pagina PDF; pos = [inizio, pezzo] per ritrovare dove sta una parola
export function joinItems(items) {
  let str = '';
  const pos = [];
  for (const it of items || []) {
    if (typeof it.str !== 'string') continue;
    if (it.str) pos.push([str.length, it]);
    str += it.str;
    if (it.hasEOL) str += '\n';
  }
  return { str, pos };
}

// tutte le occorrenze di q (già piegata) nel testo piegato: [inizio, fine) nel testo originale
export function findAll(folded, q, max = 200) {
  const out = [];
  if (!q) return out;
  for (let i = folded.s.indexOf(q); i >= 0 && out.length < max; i = folded.s.indexOf(q, i + q.length)) {
    out.push([folded.map[i], folded.map[i + q.length - 1] + 1]);
  }
  return out;
}

// pezzo di testo attorno alla parola trovata: { pre, hit, post }
export function snippet(str, a, b, before = 38, after = 70) {
  let s = Math.max(0, a - before), e = Math.min(str.length, b + after);
  // taglio agli spazi, così non si parte o si finisce a metà parola
  if (s > 0) { const sp = str.indexOf(' ', s); if (sp >= 0 && sp < a) s = sp + 1; }
  if (e < str.length) { const sp = str.lastIndexOf(' ', e); if (sp > b) e = sp; }
  const clean = (t) => t.replace(/\s+/g, ' ');
  return { pre: (s > 0 ? '…' : '') + clean(str.slice(s, a)), hit: clean(str.slice(a, b)), post: clean(str.slice(b, e)) + (e < str.length ? '…' : '') };
}

// riquadri (in frazioni della pagina mostrata) che coprono il testo [a, b): servono per evidenziare il risultato
// vp = viewport di pdf.js a scala 1 (tiene conto della rotazione della pagina)
// measure(testo, pezzo) facoltativo: larghezza vera dei caratteri (senza, si stima a numero di lettere)
export function hitRects(pos, a, b, vp, measure) {
  const rects = [];
  for (const [start, it] of pos) {
    const end = start + it.str.length;
    if (end <= a || start >= b) continue;
    const t = it.transform, len = it.str.length || 1;
    const h = Math.hypot(t[2], t[3]) || it.height || 10;
    const w = it.width || h * len * 0.5;
    const from = Math.max(a, start) - start, to = Math.min(b, end) - start;
    // testo orizzontale (il caso normale): dalla linea di base in su
    let f1 = from / len, f2 = to / len;
    if (measure) {
      const all = measure(it.str, it);
      if (all > 0) { f1 = measure(it.str.slice(0, from), it) / all; f2 = measure(it.str.slice(0, to), it) / all; }
    }
    const x1 = t[4] + w * f1, x2 = t[4] + w * f2;
    const y1 = t[5] - h * 0.22, y2 = t[5] + h * 0.92;
    const [ax, ay] = vp.convertToViewportPoint(x1, y1), [bx, by] = vp.convertToViewportPoint(x2, y2);
    const l = Math.min(ax, bx) / vp.width, r = Math.max(ax, bx) / vp.width, tp = Math.min(ay, by) / vp.height, bt = Math.max(ay, by) / vp.height;
    if (r > l && bt > tp) rects.push({ l, t: tp, w: r - l, h: bt - tp });
  }
  return rects;
}
