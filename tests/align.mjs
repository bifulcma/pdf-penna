// Misura quanto il testo trasparente (livello di testo) cade sopra le lettere stampate sul canvas della pagina.
// Per ogni parola: riquadro della parola nel livello di testo vs. inchiostro scuro nel canvas, sulla stessa riga.
export const ALIGN_FN = `
window.__align = function (pageIdx, words) {
  const p = __penna.nb.pages[pageIdx], cv = p.bg, W = p.wrap.getBoundingClientRect();
  const k = cv.width / W.width, ctx = cv.getContext('2d');
  const out = [];
  const nodes = []; const tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT); for (let n = tw.nextNode(); n; n = tw.nextNode()) nodes.push(n);
  for (const word of words) {
    let node = null, idx = -1, nth = 0;
    const [w, want] = Array.isArray(word) ? word : [word, 0];
    // solo parole intere (niente "versi" dentro "università")
    const whole = (t, i) => (i === 0 || /\\s/.test(t[i - 1])) && (i + w.length === t.length || /\\s/.test(t[i + w.length]));
    for (const n of nodes) { let i = -1; while ((i = n.data.indexOf(w, i + 1)) >= 0) { if (!whole(n.data, i)) continue; if (nth++ === want) { node = n; idx = i; break; } } if (node) break; }
    if (!node) { out.push({ w, missing: true }); continue; }
    const r = document.createRange(); r.setStart(node, idx); r.setEnd(node, idx + w.length);
    const c = r.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor((c.left - W.left - c.height) * k)), x1 = Math.min(cv.width, Math.ceil((c.right - W.left + c.height) * k));
    const y0 = Math.max(0, Math.floor((c.top - W.top + c.height * 0.15) * k)), y1 = Math.min(cv.height, Math.ceil((c.bottom - W.top - c.height * 0.15) * k));
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, bw = x1 - x0, bh = y1 - y0;
    const col = new Array(bw).fill(0);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (y * bw + x) * 4; if (d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 140) col[x]++; }
    // gruppi di colonne con inchiostro (parole), separati da spazi larghi almeno ~0.2 dell'altezza del carattere
    const gap = Math.max(2, c.height * k * 0.17), runs = [];
    let s = -1, last = -1e9;
    for (let x = 0; x < bw; x++) if (col[x]) { if (x - last > gap) { if (s >= 0) runs.push([s, last]); s = x; } last = x; }
    if (s >= 0) runs.push([s, last]);
    const L = (c.left - W.left) * k - x0, R = (c.right - W.left) * k - x0;
    const hit = runs.filter(([a, b]) => Math.min(b, R) - Math.max(a, L) > (b - a) * 0.3);
    if (!hit.length) { out.push({ w, noink: true }); continue; }
    const inkL = hit[0][0], inkR = hit[hit.length - 1][1] + 1;
    out.push({ w, dl: +((L - inkL) / k).toFixed(1), dr: +((R - inkR) / k).toFixed(1), h: +c.height.toFixed(1), wpx: +(c.width).toFixed(1) });
  }
  return out;
};`;
