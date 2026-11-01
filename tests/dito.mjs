// Modalità Dito (v19): con la manina accesa il dito traccia righe/strisce dritte; spenta, il dito non disegna.
// Uso: server statico su http://localhost:8088, poi: CHROME=... node tests/dito.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, touch, tap, strokes } from './touch.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const APP = process.env.APP || 'http://localhost:8088/index.html';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? '  — ' + extra : '')); };
const doc = await PDFLib.PDFDocument.create(); const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) { const pg = doc.addPage([595, 842]); for (let r = 0; r < 20; r++) pg.drawText('Riga ' + r + ' pagina ' + i, { x: 60, y: 780 - r * 30, size: 14, font: f }); }
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(OUT + '/dito.pdf', await doc.save());
const P = await browser(9352, 'strip');
const drag = async (x0, y0, x1, y1) => { await touch(P, 'touchStart', x0, y0); const n = 12; for (let i = 1; i <= n; i++) { await touch(P, 'touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n + (i % 2 ? 3 : -3)); await sleep(12); } await touch(P, 'touchEnd', x1, y1); await sleep(250); };
try {
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.setFiles('#pdf-input', [OUT + '/dito.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===3`, 30000, 'PDF aperto');
  await P.waitFor('document.querySelector(".page[data-rendered]")', 15000, 'pagina'); await sleep(500);
  const pr = await rect(P, '.page canvas.draw'); const y = pr.y + 200, xa = pr.x + 80, xb = pr.x + 360;
  const btn = await rect(P, '#btn-finger');
  ok('bottone Dito presente e >= 44px', !!btn && btn.w >= 44 && btn.h >= 44, JSON.stringify(btn));
  await drag(xa, y, xb, y);
  ok('Dito spento: il dito non disegna', (await strokes(P)) === 0, String(await strokes(P)));
  await tap(P, '#btn-finger');
  ok('Dito acceso: bottone attivo e body.finger', await P.eval(`return document.getElementById('btn-finger').classList.contains('active') && document.body.classList.contains('finger')`));
  await drag(xa, y, xb, y + 6);
  ok('penna+dito: una riga', (await strokes(P)) === 1, String(await strokes(P)));
  const s = await P.eval(`const s=__penna.nb.pages[0].rec.strokes[0]; return s && {t:s.t, n:s.pts.length, dy:Math.abs(s.pts[1][1]-s.pts[0][1]), dx:Math.abs(s.pts[1][0]-s.pts[0][0])}`);
  ok('la riga è dritta (stessa y) e lunga', !!s && s.t === 'pen' && s.n === 2 && s.dy === 0 && s.dx > 0.2, JSON.stringify(s));
  await tap(P, '#tool-hl');
  await drag(xa, y + 40, xb, y + 40);
  const h = await P.eval(`const s=__penna.nb.pages[0].rec.strokes[1]; return s && {t:s.t, n:s.pts.length}`);
  ok('evidenziatore+dito: striscia dritta', !!h && h.t === 'hl' && h.n === 2, JSON.stringify(h));
  await touch(P, 'touchStart', xa, y + 80); await sleep(40); await touch(P, 'touchEnd', xa, y + 80); await sleep(200);
  ok('un semplice tocco non lascia segni', (await strokes(P)) === 2, String(await strokes(P)));
  await drag(xa, y + 100, xa + 4, y + 260);
  ok('gesto verticale: non disegna', (await strokes(P)) === 2, String(await strokes(P)));
  await P.eval('__penna.flush && __penna.flush()'); await P.reload?.();
  ok('scelta Dito salvata', await P.eval(`return localStorage.getItem('penna.finger')==='1'`));
  ok('versione v19', await P.eval(`return __penna.version==='v19' || document.getElementById('app-ver').textContent==='v19'`));
} catch (e) { fail++; console.log('ERRORE', e.message); }
console.log(`\nRISULTATO: ${pass}/${pass + fail} ok`);
P.close?.(); process.exit(fail ? 1 : 0);
