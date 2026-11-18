// Test di smoothPts / strokePts (v25): il tratto di penna senza scaletta. Uso: node tests/tratto-unit.mjs
import { smoothPts, strokePts, penPieces } from '../pdfexport.js';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (!c && x !== '' ? '  — ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); };
const W = 968, ASP = 1.4142, px = 1 / W; // pagina larga 968 punti, come sull'iPad di Marco
// come scrive Safari su iPad: la penna va lungo f(t), ogni posizione è arrotondata al punto intero, un punto salvato a ogni cambio
function quantized(f, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) { const [x, y] = f(i / steps); const q = [Math.round(x), Math.round(y)]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
  return out.map(([x, y]) => [x * px, y * px / ASP, 0.47]);
}
const turns = (pts) => { const a = []; for (let i = 1; i < pts.length - 1; i++) { const u = Math.atan2((pts[i][1] - pts[i - 1][1]) * ASP, pts[i][0] - pts[i - 1][0]), v = Math.atan2((pts[i + 1][1] - pts[i][1]) * ASP, pts[i + 1][0] - pts[i][0]); a.push(Math.abs(((v - u + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI); } return a.sort((x, y) => x - y); };
const p90 = (a) => a[Math.floor(a.length * 0.9)];
const toPx = (q) => [q[0] * W, q[1] * W * ASP];

// 1. riga quasi orizzontale (sale di 1 ogni 6): scaletta prima, quasi dritta dopo
const line = quantized((t) => [100 + 300 * t, 200 + 50 * t], 3000), ls = smoothPts(line, ASP);
const dev = (pts) => Math.max(...pts.slice(8, -8).map((q) => { const [x, y] = toPx(q); return Math.abs((y - 200) - (x - 100) / 6) / Math.hypot(1, 1 / 6); }));
ok('riga inclinata: prima è una scaletta (svolte di 45°)', p90(turns(line)) >= 45 && dev(line) > 0.4, [p90(turns(line)), dev(line)]);
ok('riga inclinata: dopo, svolte sotto 12° e a meno di 0,25 punti dalla riga vera', p90(turns(ls)) < 12 && dev(ls) < 0.25, [p90(turns(ls)), dev(ls)]);
ok('stesso numero di punti, pressione intatta, estremità ferme', ls.length === line.length && ls.every((q, i) => q[2] === line[i][2]) && ls[0][0] === line[0][0] && ls[0][1] === line[0][1] && ls.at(-1)[0] === line.at(-1)[0] && ls.at(-1)[1] === line.at(-1)[1]);
ok('i punti originali non vengono toccati', line.every((q) => Number.isInteger(Math.round(q[0] * W * 1e6) / 1e6)));

// 2. cerchio piccolo (raggio 12 punti, come una lettera): resta un cerchio, non si restringe
const circ = quantized((t) => [300 + 12 * Math.cos(2 * Math.PI * t), 300 + 12 * Math.sin(2 * Math.PI * t)], 2000), cs = smoothPts(circ, ASP);
const radii = (pts) => pts.slice(6, -6).map((q) => { const [x, y] = toPx(q); return Math.hypot(x - 300, y - 300); });
const rr = radii(cs), rmean = rr.reduce((a, b) => a + b, 0) / rr.length;
ok('cerchio di raggio 12: raggio medio tra 11,3 e 12,1 (non si restringe), ondulazione sotto 0,35 punti', rmean > 11.3 && rmean < 12.1 && Math.max(...rr) - Math.min(...rr) < 0.7, [rmean, Math.min(...rr), Math.max(...rr)]);
ok('cerchio: svolte regolari (prima 45°/90°, dopo sotto 15°)', p90(turns(circ)) >= 45 && p90(turns(cs)) < 15, [p90(turns(circ)), p90(turns(cs))]);

// 3. angolo vero (una «L» di 40 punti per lato): l'angolo resta al suo posto, arrotondato di poco
const ell = quantized((t) => (t < 0.5 ? [400, 100 + 80 * t] : [400 + 80 * (t - 0.5), 140]), 2000), es = smoothPts(ell, ASP);
const corner = Math.min(...es.map((q) => { const [x, y] = toPx(q); return Math.hypot(x - 400, y - 140); }));
ok('angolo retto: il tratto passa a meno di 1,5 punti dall’angolo', corner < 1.5, corner);

// 4. tratti che non devono cambiare
const sparse = Array.from({ length: 12 }, (_, i) => [0.1 + i * 0.03, 0.2 + (i % 2) * 0.02, 1]);
ok('punti lontani (riga veloce, mouse): identici', smoothPts(sparse, ASP).every((q, i) => q[0] === sparse[i][0] && q[1] === sparse[i][1]));
const tiny = [[0.1, 0.1, 1], [0.2, 0.2, 1], [0.3, 0.1, 1]];
ok('meno di 4 punti: lo stesso tratto', smoothPts(tiny, ASP) === tiny);
const same = Array.from({ length: 6 }, () => [0.5, 0.5, 1]);
ok('punti tutti uguali: nessun errore, nessun NaN', smoothPts(same, ASP).every((q) => q[0] === 0.5 && q[1] === 0.5));
ok('raggio dato a mano (mentre si scrive): R = 0 non cambia niente, R grande liscia di più', smoothPts(line, ASP, 0) === line && p90(turns(smoothPts(line, ASP, 8 * px))) <= p90(turns(ls)));

// 5. strokePts: quali tratti si lisciano quando si disegnano
ok('tratto vecchio di penna: lisciato, e la seconda volta è lo stesso risultato (memoria)', (() => { const s = { t: 'pen', pts: line }; const a = strokePts(s, ASP); return a !== line && a === strokePts(s, ASP) && p90(turns(a)) < 12; })());
ok('tratto nuovo (s: 1, già liscio): così com’è', strokePts({ t: 'pen', s: 1, pts: line }, ASP) === line);
ok('evidenziatore: così com’è', strokePts({ t: 'hl', pts: line }, ASP) === line);
ok('tratto vecchio a cui si aggiungono punti: ricalcolato', (() => { const pts = line.slice(0, 50), s = { t: 'pen', pts }; const a = strokePts(s, ASP); pts.push(line[50]); return strokePts(s, ASP).length === 51 && a.length === 50; })());
ok('penPieces sui punti lisciati: tanti pezzi quanti prima', penPieces(ls).length === penPieces(line).length);
// 6. mentre si scrive: i punti a più di R dalla punta non cambiano più quando il tratto si allunga
{
  const R = 4 * px; let stable = true;
  for (let n = 30; n < line.length; n += 7) {
    const a = smoothPts(line.slice(0, n), ASP, R), b = smoothPts(line.slice(0, n + 7), ASP, R);
    let tail = 0, F = n - 1; while (F > 0 && tail < R) { tail += Math.hypot(line[F][0] - line[F - 1][0], (line[F][1] - line[F - 1][1]) * ASP); F--; }
    for (let i = 0; i <= F; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) stable = false;
  }
  ok('i punti già disegnati sulla pagina non si spostano quando il tratto continua', stable);
}
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
