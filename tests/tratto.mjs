// Test della v25 nel browser: la penna con posizioni intere (come Safari su iPad) non fa più la scaletta.
// Uso: server statico su http://localhost:8088, poi: node tests/tratto.mjs
import fs from 'node:fs';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, pen, rect, tap, strokes } from './touch.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? '  — ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600) : '')); };
const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>@page{size:A4;margin:22mm}</style><p>Pagina di prova.</p></html>`;
const P = await browser(9396, 'strip');
const q = (expr) => P.eval('return ' + expr);
// svolte tra un pezzo e l'altro, in gradi (90° percentile), misurate in punti dello schermo
const TURNS = `(pts, w, h) => { const a = []; for (let i = 1; i < pts.length - 1; i++) { const u = Math.atan2((pts[i][1]-pts[i-1][1])*h, (pts[i][0]-pts[i-1][0])*w), v = Math.atan2((pts[i+1][1]-pts[i][1])*h, (pts[i+1][0]-pts[i][0])*w); a.push(Math.abs(((v-u+3*Math.PI)%(2*Math.PI))-Math.PI)*180/Math.PI); } a.sort((x,y)=>x-y); return a[Math.floor(a.length*0.9)] || 0; }`;
try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/tratto.html', HTML); return OUT + '/tratto.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/Tratto.pdf', Buffer.from(pr.data, 'base64'));
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.setFiles('#pdf-input', [OUT + '/Tratto.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');
  ok('app v25 o successiva', +(await q(`__penna.version`)).slice(1) >= 25);
  const pg = await rect(P, '.page'); // lo strumento all'apertura è già la penna

  // 1. riga inclinata scritta un punto alla volta, sempre su posizioni intere: prima usciva una scaletta
  const line = []; for (let i = 0; i <= 240; i++) { const x = Math.round(pg.x + 100 + i), y = Math.round(pg.y + 200 + i / 6); const l = line[line.length - 1]; if (!l || l[0] !== x || l[1] !== y) line.push([x, y]); }
  // a metà tratto: la punta sta nel foglietto trasparente, il resto è già sulla pagina
  const [x0, y0] = line[0];
  await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
  for (const [x, y] of line.slice(1, 120)) await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 });
  await sleep(100);
  const mid = await q(`(() => { const p = __penna.nb.pages[0], t = p.wrap.querySelector('canvas.tail'); if (!t) return null; const r = t.getBoundingClientRect(), d = t.getContext('2d').getImageData(0, 0, t.width, t.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) ink++;
    const c = p.draw, m = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let main = 0; for (let i = 3; i < m.length; i += 16) if (m[i] > 40) main++;
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, ink, main, pe: getComputedStyle(t).pointerEvents, strokes: p.rec.strokes.length }; })()`);
  ok('mentre si scrive: il foglietto della punta c’è, è centrato sulla penna e ha inchiostro', mid && Math.abs(mid.cx - line[119][0]) < 2 && Math.abs(mid.cy - line[119][1]) < 2 && mid.ink > 5 && mid.pe === 'none', mid);
  ok('mentre si scrive: il resto del tratto è già sulla pagina; niente è ancora salvato', mid && mid.main > 50 && mid.strokes === 0, mid);
  for (const [x, y] of line.slice(120)) await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 });
  // poco prima di alzare la penna: pagina + punta, da confrontare con il tratto ridisegnato dopo
  const SNAP = `(() => { const p = __penna.nb.pages[0], c = p.draw, t = p.wrap.querySelector('canvas.tail'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(c, 0, 0);
    if (t) { const s = c.width / c.offsetWidth; x.drawImage(t, Math.round(parseFloat(t.style.left) * s), Math.round(parseFloat(t.style.top) * s)); } return o; })()`;
  await P.eval(`window.__before = ${SNAP}; return 1`);
  const [xl, yl] = line[line.length - 1];
  await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xl, y: yl, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await sleep(150);
  ok('alzata la penna: un tratto salvato, il foglietto della punta sparisce', (await strokes(P)) === 1 && (await q(`!document.querySelector('canvas.tail')`)));
  const st = await q(`(() => { const p = __penna.nb.pages[0], s = p.rec.strokes[0], T = ${TURNS}; return { s: s.s, n: s.pts.length, keys: Object.keys(s).sort().join(), p90: T(s.pts, p.cw, p.ch), first: [s.pts[0][0] * p.cw, s.pts[0][1] * p.ch], last: [s.pts.at(-1)[0] * p.cw, s.pts.at(-1)[1] * p.ch], dec: Math.max(...s.pts.map((q) => String(q[0]).length)) }; })()`);
  ok('il tratto salvato è liscio: segnato s: 1, svolte sotto 12° (la scaletta ne ha di 45°)', st.s === 1 && st.p90 < 12 && st.n > 150, st);
  ok('salvato pulito: solo a, c, pts, s, t, w (niente dati di lavoro), numeri corti', /^(a,)?c,pts,s,t,w$/.test(st.keys) && st.dec <= 8, st);
  ok('comincia e finisce dove la penna ha cominciato e finito', Math.hypot(st.first[0] - (line[0][0] - pg.x), st.first[1] - (line[0][1] - pg.y)) < 0.6 && Math.hypot(st.last[0] - (xl - pg.x), st.last[1] - (yl - pg.y)) < 0.6, st);
  const diff = await q(`(() => { const a = window.__before, b = __penna.nb.pages[0].draw; const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; let ink = 0, bad = 0; for (let i = 3; i < da.length; i += 4) { if (db[i] > 0 || da[i] > 0) ink++; if (Math.abs(da[i] - db[i]) > 96) bad++; } return { ink, bad }; })()`);
  ok('quello che vedi mentre scrivi è il tratto finale: nessuno scatto quando alzi la penna', diff.ink > 500 && diff.bad / diff.ink < 0.02, diff);

  // 2. un tratto vecchio a scaletta (salvato dalla v24): i dati restano, sullo schermo e nel PDF esce liscio
  const old = await q(`(() => { const p = __penna.nb.pages[0]; const pts = []; for (let i = 0; i <= 200; i++) pts.push([(120 + i) / p.cw, Math.round(420 + i / 5) / p.ch, 0.47]); p.rec.strokes.push({ t: 'pen', c: '#d62828', w: 0.0049, pts }); const T = ${TURNS};
    const X = __penna.strokePts(p.rec.strokes[1], p.ch / p.cw); return { raw: T(pts, p.cw, p.ch), drawn: T(X, p.cw, p.ch), same: p.rec.strokes[1].pts === pts && !p.rec.strokes[1].s }; })()`);
  ok('tratto vecchio: i punti salvati non cambiano, quelli disegnati sono lisci', old.same && old.raw >= 45 && old.drawn < 12, old);
  const bytes = await q(`(async () => { const b = await __penna.exportBytes(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); })()`);
  fs.writeFileSync(OUT + '/tratto-esportato.pdf', Buffer.from(bytes, 'base64'));
  ok('il PDF esportato si fa senza errori', Buffer.from(bytes, 'base64').subarray(0, 5).toString() === '%PDF-');

  // 3. il resto non cambia: evidenziatore non lisciato, annulla e gomma funzionano sui tratti nuovi
  await tap(P, '#tool-hl');
  await pen(P, Array.from({ length: 30 }, (_, i) => [Math.round(pg.x + 150 + i * 6), Math.round(pg.y + 560)]));
  ok('evidenziatore: salvato com’era (senza s)', await q(`(() => { const s = __penna.nb.pages[0].rec.strokes.at(-1); return s.t === 'hl' && !s.s && !s.raw; })()`));
  await P.eval(`__penna.undo(); return 1`); await sleep(100); await P.eval(`__penna.undo(); return 1`); await sleep(100);
  ok('annulla toglie l’evidenziatore e poi il tratto di penna', (await q(`__penna.nb.pages[0].rec.strokes.filter((s) => s.s).length`)) === 0);
  await P.eval(`__penna.redo(); return 1`); await sleep(100);
  ok('ripeti lo rimette', (await q(`__penna.nb.pages[0].rec.strokes.filter((s) => s.s).length`)) === 1);
  // 4. un tocco di penna (un punto solo) e un tratto cortissimo
  await tap(P, '#tool-pen');
  const n0 = await strokes(P);
  await pen(P, [[Math.round(pg.x + 300), Math.round(pg.y + 500)], [Math.round(pg.x + 301), Math.round(pg.y + 500)], [Math.round(pg.x + 302), Math.round(pg.y + 501)]]);
  ok('tratto di tre punti: salvato, senza errori', (await strokes(P)) === n0 + 1 && (await q(`document.getElementById('errbox').hidden`)) && (await q(`__penna.nb.pages[0].rec.strokes.at(-1).pts.every((q) => q.every(Number.isFinite))`)),
    await q(`JSON.stringify({ n: __penna.nb.pages[0].rec.strokes.length, tool: __penna.S.tool, pop: document.getElementById('pop').hidden, err: document.getElementById('err-msg').textContent, last: __penna.nb.pages[0].rec.strokes.at(-1) }).slice(0, 400)`) + ' n0=' + n0);
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e.stack || e));
} finally {
  try { await P.close(); } catch {}
  console.log('\nRISULTATO: ' + pass + '/' + (pass + fail) + ' ok');
  process.exit(fail ? 1 : 0);
}
