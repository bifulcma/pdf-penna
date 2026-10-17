// Test "da iPad": API JavaScript moderne tolte (come un Safari più vecchio), PDF veri con font e immagini,
// tocchi su ogni pulsante con eventi touch, penna con pointerType "pen", pannello colore/spessore, iPhone, tema scuro.
// Uso: node tests/ipad.mjs   (server statico su http://localhost:8088 nella cartella del progetto)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, sleep, OUT } from './cdp.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const APP = process.env.APP || 'http://localhost:8088/index.html';
const SHOTS = OUT + '/shots'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (!cond && extra !== '' ? '  — ' + extra : '')); };

// ---------- API che Safari 16.4/17 non ha: le tolgo prima di ogni script (pagina e worker) ----------
const STRIP = `(function(g){const del=(o,k)=>{try{delete o[k]}catch(e){}};
del(Promise,'withResolvers');del(Promise,'try');
const IP=Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
for(const k of ['map','filter','take','drop','flatMap','reduce','toArray','forEach','some','every','find'])del(IP,k);del(g,'Iterator');
for(const k of ['toHex','toBase64','setFromHex','setFromBase64'])del(Uint8Array.prototype,k);del(Uint8Array,'fromHex');del(Uint8Array,'fromBase64');
del(g,'Float16Array');del(Math,'f16round');del(Math,'sumPrecise');
for(const C of [Map,WeakMap]){del(C.prototype,'getOrInsert');del(C.prototype,'getOrInsertComputed');}
del(URL,'parse');del(RegExp,'escape');del(ArrayBuffer.prototype,'transfer');del(ArrayBuffer.prototype,'transferToFixedLength');
del(Object,'groupBy');del(Map,'groupBy');if(g.AbortSignal)del(AbortSignal,'any');del(Error,'isError');
for(const k of ['union','intersection','difference','symmetricDifference','isSubsetOf','isSupersetOf','isDisjointFrom'])del(Set.prototype,k);
if(g.ReadableStream){del(ReadableStream.prototype,Symbol.asyncIterator);del(ReadableStream.prototype,'values');del(ReadableStream,'from');}
for(const C of [g.Response,g.Request,g.Blob])if(C)del(C.prototype,'bytes');del(g,'ImageDecoder');g.__stripped=true;})(typeof self!=='undefined'?self:globalThis);\n`;

// Browser con le richieste di polyfills.js intercettate: 'strip' = API tolte + nostri polyfill; 'nopoly' = API tolte e basta
async function browser(port, mode) {
  const P = await launch(port); await P.init();
  P.polyHits = 0;
  if (mode) {
    await P.send('Network.setBypassServiceWorker', { bypass: true });
    await P.send('Fetch.enable', { patterns: [{ urlPattern: '*polyfills.js*', requestStage: 'Response' }] });
    const orig = fs.readFileSync(new URL('../polyfills.js', import.meta.url), 'utf8');
    P.handlers.push(async (d) => {
      if (d.method !== 'Fetch.requestPaused') return;
      P.polyHits++;
      const body = STRIP + (mode === 'nopoly' ? '' : orig);
      await P.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(body).toString('base64') });
    });
  }
  // UA=ipad: mi presento come Safari su iPad (attiva i limiti di memoria pensati per iPad/iPhone)
  if (process.env.UA === 'ipad') await P.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1', platform: 'iPad' });
  await P.send('Page.setInterceptFileChooserDialog', { enabled: true });
  P.chooser = 0;
  P.handlers.push((d) => { if (d.method === 'Page.fileChooserOpened') P.chooser++; });
  return P;
}
async function device(P, w, h, dpr = 2) {
  await P.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
  await P.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(300);
}
const rect = (P, sel) => P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}`);
const touch = (P, type, x, y) => P.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
async function tapXY(P, x, y) { await touch(P, 'touchStart', x, y); await sleep(50); await touch(P, 'touchEnd', x, y); await sleep(220); }
async function tap(P, sel) { const r = await rect(P, sel); if (!r) throw new Error('manca ' + sel); await tapXY(P, r.cx, r.cy); }
// il punto centrale del pulsante deve essere davvero il pulsante (non coperto da canvas/barre)
const reachable = (P, sel) => P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!h && (h===e || e.contains(h))`);
async function pen(P, pts) {
  const [x0, y0] = pts[0];
  await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
  for (const [x, y] of pts.slice(1)) { await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 }); await sleep(6); }
  const [xl, yl] = pts[pts.length - 1];
  await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xl, y: yl, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await sleep(120);
}
async function shot(P, name) { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); }
const strokes = (P, i = 0) => P.eval(`return __penna.nb.pages[${i}].rec.strokes.length`);
const small = (P) => P.eval(`return [...document.querySelectorAll('button, label.pill, label.ib, .slider')].filter(e=>{const r=e.getBoundingClientRect(); if(!r.width||!r.height||!e.offsetParent) return false; if(getComputedStyle(e).visibility==='hidden') return false; return r.width<43.5||r.height<43.5}).map(e=>(e.id||e.className)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))`);
// pixel scuri e colorati su un canvas (per capire se il PDF è stato disegnato davvero)
const pixels = (P, sel) => P.eval(`const c=document.querySelector(${JSON.stringify(sel)}); if(!c||!c.width) return {dark:0,color:0}; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let dark=0,color=0; for(let i=0;i<d.length;i+=16){const r=d[i],g=d[i+1],b=d[i+2]; if(r<90&&g<90&&b<90)dark++; if(Math.max(r,g,b)-Math.min(r,g,b)>70)color++;} return {dark,color}`);

// ---------- PDF di prova: 5 pagine stampate da Chrome (font veri, foto JPEG, grafica vettoriale), una ruotata ----------
async function makeFixtures(P) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:16mm} body{font:12pt/1.5 Georgia,serif;color:#222} h1{font:600 22pt 'Helvetica Neue',Helvetica,sans-serif;color:#C2664A;margin:0 0 8px}
.mono{font-family:Courier,monospace} .pb{break-before:page} img{display:block;margin:12px 0;border-radius:8px}</style></head><body>
<h1>Esercizi spirituali · pagina 1</h1><p>Accenti e simboli: àèéìòù «virgolette» € 12,50 — <b>grassetto</b>, <i>corsivo</i>, <span class="mono">monospace</span>.</p>
<img id="ph" width="420" height="260"><svg width="420" height="90"><rect x="2" y="2" width="200" height="80" rx="14" fill="#2a9d4a"/><circle cx="300" cy="45" r="40" fill="#1f5fd1"/></svg>
${[2, 3, 4, 5].map((n) => `<div class="pb"><h1>Pagina ${n}</h1>${Array.from({ length: 22 }, (_, i) => `<p>Riga ${i + 1}: Prendi, Signore, e ricevi tutta la mia libertà, la mia memoria, il mio intelletto e tutta la mia volontà.</p>`).join('')}</div>`).join('')}
<script>const c=document.createElement('canvas');c.width=840;c.height=520;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,840,520);g.addColorStop(0,'#f3a65a');g.addColorStop(.5,'#c2664a');g.addColorStop(1,'#3b6ea5');x.fillStyle=g;x.fillRect(0,0,840,520);for(let i=0;i<300;i++){x.fillStyle='hsla('+(i*7%360)+',70%,60%,.5)';x.beginPath();x.arc(Math.random()*840,Math.random()*520,6+Math.random()*30,0,7);x.fill()}document.getElementById('ph').src=c.toDataURL('image/jpeg',.88)</script></body></html>`;
  fs.writeFileSync(OUT + '/fixture.html', html);
  await P.goto('file://' + OUT + '/fixture.html'); await sleep(600);
  const r = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const doc = await PDFLib.PDFDocument.load(Buffer.from(r.data, 'base64'));
  doc.getPage(2).setRotation(PDFLib.degrees(90));
  fs.writeFileSync(OUT + '/multi.pdf', await doc.save());
  // PDF con font standard NON incorporati (pdf.js deve scaricare lib/standard_fonts)
  const std = await PDFLib.PDFDocument.create();
  const fonts = [PDFLib.StandardFonts.Helvetica, PDFLib.StandardFonts.TimesRomanBold, PDFLib.StandardFonts.Courier];
  const pg = std.addPage([420, 595]);
  for (let i = 0; i < fonts.length; i++) pg.drawText('Font standard ' + (i + 1) + ': Ad maiorem Dei gloriam', { x: 30, y: 520 - i * 60, size: 18, font: await std.embedFont(fonts[i]) });
  fs.writeFileSync(OUT + '/std.pdf', await std.save());
  return doc.getPageCount();
}

async function openPdfTest(mode, port) {
  const P = await browser(port, mode);
  try {
    const nPages = await makeFixtures(P);
    await device(P, 1024, 768);
    await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
    ok(`[${mode}] API moderne tolte all'avvio`, await P.eval(mode === 'nopoly' ? 'return window.__stripped===true && typeof Promise.withResolvers==="undefined" && typeof Uint8Array.prototype.toHex==="undefined"'
      : 'return window.__stripped===true && typeof Promise.withResolvers==="function" && !/native code/.test(Promise.withResolvers.toString())'));
    await P.setFiles('#pdf-input', [OUT + '/multi.pdf']);
    await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===${nPages} || !document.getElementById('errbox').hidden`, 30000, 'PDF aperto');
    ok(`[${mode}] PDF reale a ${nPages} pagine importato`, await P.eval(`return __penna.nb.pages.length===${nPages}`), await P.eval('return document.getElementById("err-msg").textContent'));
    ok(`[${mode}] il worker ha ricevuto i polyfill/strip (2 richieste intercettate)`, P.polyHits >= 2, 'richieste=' + P.polyHits);
    await P.waitFor('document.querySelector(".page[data-rendered]")', 20000, 'pagina disegnata');
    await sleep(800);
    const px = await pixels(P, '.page canvas.bg');
    ok(`[${mode}] pagina 1: testo e foto JPEG disegnati`, px.dark > 300 && px.color > 300, JSON.stringify(px));
    // pagina 3 ruotata
    await P.eval(`viewer.scrollTop = __penna.nb.pages[2].wrap.offsetTop - 60; return 1`).catch(() => P.eval(`document.getElementById('viewer').scrollTop = __penna.nb.pages[2].wrap.offsetTop - 60; return 1`));
    await P.waitFor(`__penna.nb.pages[2].wrap.dataset.rendered==="1"`, 15000, 'pagina 3');
    const p3 = await P.eval(`const p=__penna.nb.pages[2]; return {aspect:p.aspect}`);
    ok(`[${mode}] pagina ruotata in orizzontale`, p3.aspect < 1, JSON.stringify(p3));
    ok(`[${mode}] nessun errore a schermo`, await P.eval('return document.getElementById("errbox").hidden'), await P.eval('return document.getElementById("err-msg").textContent'));
    const n = await P.eval('const b=await __penna.exportBytes(); return b.length');
    ok(`[${mode}] esporta il PDF annotato`, n > 10000, n);
    await P.setFiles('#pdf-input', [OUT + '/std.pdf']);
    await P.waitFor(`__penna.nb.node && __penna.nb.node.name==='std' && document.querySelector('.page[data-rendered]')`, 20000, 'std.pdf');
    await sleep(600);
    const ps = await pixels(P, '.page canvas.bg');
    ok(`[${mode}] PDF con font standard non incorporati: testo visibile`, ps.dark > 200, JSON.stringify(ps));
    await P.eval(`const n=(await __penna.D.all('nodes')).find(n=>n.name==='multi'); await __penna.openNotebook(n.id); return 1`);
    await P.waitFor('document.querySelector(".page[data-rendered]")', 15000);
    return P;
  } catch (e) { fail++; console.log(`FAIL [${mode}] eccezione`, e.message); try { await shot(P, 'fail-' + mode); } catch {} return P; }
}

// ======================= 1) controprova: senza i nostri polyfill pdf.js (anche "legacy") non apre il PDF =======================
{
  const P = await browser(9341, 'nopoly');
  await makeFixtures(P); await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  ok('[controprova] API tolte e nessun polyfill', await P.eval('return window.__stripped===true && typeof Promise.withResolvers==="undefined"'));
  await P.setFiles('#pdf-input', [OUT + '/multi.pdf']);
  await P.waitFor('!document.getElementById("errbox").hidden || !document.getElementById("notebook").hidden', 20000).catch(() => {});
  const msg = await P.eval('return document.getElementById("errbox").hidden ? "" : document.getElementById("err-msg").textContent');
  ok('[controprova] senza polyfill il PDF NON si apre e l\'errore è a schermo (withResolvers)', /withResolvers/.test(msg), msg.slice(0, 120));
  P.close();
}

// ======================= 2) test completo da iPad con API tolte + polyfill =======================
const P = await openPdfTest('strip', 9342);
try {
  const S = '__penna.S';
  await P.eval(`document.getElementById('viewer').scrollTop = 0; return 1`); await sleep(500);
  await shot(P, 'ipad-editor-pdf');
  // ogni pulsante della barra: raggiungibile (non coperto) e >= 44px
  for (const sel of ['#btn-back', '#btn-pages', '#tool-pen', '#tool-hl', '#tool-eraser', '#tool-text', '#btn-color', '#btn-undo', '#btn-redo', '#btn-export', 'label.ib.filebtn'])
    ok('iPad: ' + sel + ' raggiungibile al tocco', await reachable(P, sel));
  ok('iPad editor: tutti i comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));

  // evidenziatore: tocco, secondo tocco = pannello
  await tap(P, '#tool-hl'); ok('tocco evidenziatore → strumento attivo', (await P.eval(`return ${S}.tool`)) === 'hl');
  await tap(P, '#tool-hl'); ok('secondo tocco → pannello colore/spessore', await P.eval(`return !document.getElementById('pop').hidden`));
  const popR = await rect(P, '#pop');
  ok('pannello dentro lo schermo, sotto la barra', popR.y > 60 && popR.x >= 0 && popR.x + popR.w <= 1024 && popR.y + popR.h <= 768, JSON.stringify(popR));
  ok('evidenziatore: riga opacità visibile', await P.eval(`return !document.getElementById('row-alpha').hidden`));
  await tap(P, '#pop .color[data-color="#7fd35b"]'); ok('tocco colore verde → colore evidenziatore', (await P.eval(`return ${S}.hl.color`)) === '#7fd35b');
  const sl = await rect(P, '#sl-size'); const s0 = await P.eval(`return ${S}.hl.size`);
  await touch(P, 'touchStart', sl.x + 30, sl.cy); await touch(P, 'touchMove', sl.x + sl.w * 0.5, sl.cy); await touch(P, 'touchMove', sl.x + sl.w - 6, sl.cy); await touch(P, 'touchEnd', 0, 0); await sleep(150);
  const s1 = await P.eval(`return ${S}.hl.size`);
  ok('trascinare lo spessore col dito', s1 === 10 && s0 !== 10, s0 + '→' + s1);
  ok('anteprima del tratto disegnata', (await pixels(P, '#pop-preview')).color > 50);
  const sa = await rect(P, '#sl-alpha'); const a0 = await P.eval(`return ${S}.hl.alpha`);
  await tapXY(P, sa.x + sa.w * 0.75, sa.cy);
  const a1 = await P.eval(`return ${S}.hl.alpha`);
  ok('tocco sullo slider opacità', a1 !== a0 && a1 > 0.6, a0 + '→' + a1);
  await shot(P, 'ipad-popover-hl');
  await tapXY(P, 600, 600); ok('tocco fuori chiude il pannello', await P.eval(`return document.getElementById('pop').hidden`));
  ok('il tocco fuori non disegna', (await strokes(P)) === 0);

  // penna: dal pulsante colore
  await tap(P, '#tool-pen'); ok('tocco penna', (await P.eval(`return ${S}.tool`)) === 'pen');
  await tap(P, '#btn-color'); ok('pulsante colore apre il pannello', await P.eval(`return !document.getElementById('pop').hidden && document.getElementById('row-alpha').hidden`));
  await tap(P, '#pop .color[data-color="#1f5fd1"]');
  const sp = await rect(P, '#sl-size'); await tapXY(P, sp.x + sp.w * 0.55, sp.cy);
  ok('penna: blu + spessore cambiati', (await P.eval(`return ${S}.pen.color`)) === '#1f5fd1' && (await P.eval(`return ${S}.pen.size`)) >= 5);
  ok('colori penna ed evidenziatore separati', (await P.eval(`return ${S}.hl.color`)) === '#7fd35b');
  await shot(P, 'ipad-popover-pen');
  await tap(P, '#btn-color'); ok('secondo tocco sul colore chiude', await P.eval(`return document.getElementById('pop').hidden`));

  // scrivere con la penna; il dito non scrive
  const pg = await rect(P, '.page');
  const wave = []; for (let i = 0; i <= 36; i++) wave.push([pg.x + 120 + i * 9, pg.y + 520 + Math.sin(i / 3) * 26]);
  await pen(P, wave);
  ok('Apple Pencil (pointer pen): tratto salvato', (await strokes(P)) === 1);
  const st = await P.eval(`return __penna.nb.pages[0].rec.strokes[0]`);
  ok('il tratto ha colore e spessore scelti', st.c === '#1f5fd1' && st.w > 0.003, JSON.stringify({ c: st.c, w: st.w }));
  await touch(P, 'touchStart', pg.x + 300, pg.y + 620); await touch(P, 'touchMove', pg.x + 340, pg.y + 560); await touch(P, 'touchEnd', 0, 0); await sleep(150);
  ok('il dito non scrive (scorre)', (await strokes(P)) === 1);
  ok('annulla attivo', await P.eval(`return !document.getElementById('btn-undo').disabled`));
  await tap(P, '#btn-undo'); ok('tocco annulla', (await strokes(P)) === 0);
  await tap(P, '#btn-redo'); ok('tocco ripeti', (await strokes(P)) === 1);
  await tap(P, '#tool-hl'); await sleep(600);
  const pg2 = await rect(P, '.page'); // dopo lo scorrimento col dito la pagina si è spostata
  await pen(P, Array.from({ length: 20 }, (_, i) => [pg2.x + 140 + i * 12, pg2.y + 300]));
  ok('evidenziatore: tratto trasparente verde', await P.eval(`const s=__penna.nb.pages[0].rec.strokes; return s.length===2 && s[1].t==='hl' && s[1].c==='#7fd35b' && s[1].a>0.6`));
  await tap(P, '#tool-eraser'); ok('tocco gomma', (await P.eval(`return ${S}.tool`)) === 'eraser');
  ok('pulsante colore disattivo con la gomma', await P.eval(`return document.getElementById('btn-color').disabled`));
  await sleep(600); // lo scorrimento col dito può avere ancora inerzia: rileggo la posizione della pagina
  const hlPts = await P.eval(`const c=document.querySelector('.page canvas.draw').getBoundingClientRect(); return __penna.nb.pages[0].rec.strokes[1].pts.filter((q,i)=>i%4===0).map(q=>[c.x+q[0]*c.width, c.y+q[1]*c.height])`);
  await pen(P, hlPts);
  ok('la gomma cancella solo il tratto toccato', await P.eval(`const s=__penna.nb.pages[0].rec.strokes; return s.length===1 && s[0].t==='pen'`));
  await tap(P, '#tool-text'); ok('tocco testo → barra testo', await P.eval(`return !document.getElementById('text-tools').hidden`));
  ok('barra testo raggiungibile', await reachable(P, '[data-add="todo"]'));
  await tap(P, '[data-add="todo"]'); ok('aggiungi checklist', (await P.eval(`return __penna.nb.pages[0].rec.blocks.length`)) === 1);
  await P.type('Rileggere il capitolo'); await sleep(400);
  await tap(P, '#tool-pen');

  // barra pagine
  await tap(P, '#btn-pages'); await sleep(400);
  ok('tocco pagine → barra laterale aperta', await P.eval(`return document.getElementById('notebook').classList.contains('side-open')`));
  await P.waitFor(`document.querySelectorAll('#page-list img.th.ok').length>=3`, 15000, 'miniature');
  ok('miniature delle pagine caricate', true);
  ok('pagine spostate a destra (barra fissa su iPad orizzontale)', (await rect(P, '.page')).x > 230, JSON.stringify(await rect(P, '.page')));
  await shot(P, 'ipad-sidebar');
  await P.eval(`document.querySelector('#page-list li:nth-child(4)').scrollIntoView({block:'center'}); return 1`); await sleep(300);
  await tap(P, '#page-list li:nth-child(4) .go'); await sleep(700);
  ok('tocco miniatura 4 → va alla pagina 4', /^4 \//.test(await P.eval(`return document.getElementById('page-ind').textContent`)), await P.eval(`return document.getElementById('page-ind').textContent`));
  ok('azioni sulla pagina corrente visibili', await P.eval(`const a=document.querySelector('#page-list li.cur .acts'); return !!a && a.offsetHeight>0`));
  await tap(P, '#btn-add-page'); await sleep(300);
  ok('aggiungi pagina → finestra con i tipi di foglio', await P.eval(`return document.getElementById('dlg').open && document.querySelectorAll('#dlg .paper-opt').length===3`));
  await shot(P, 'ipad-add-page');
  const before = await P.eval(`return __penna.nb.pages.length`);
  await tap(P, '#dlg .paper-opt:nth-child(2)'); await sleep(700);
  ok('tocco "Righe" → pagina aggiunta dopo la 4', await P.eval(`return __penna.nb.pages.length===${before + 1} && __penna.nb.pages[4].rec.type==='lined'`));
  await tap(P, '#btn-pages'); await sleep(300);
  ok('secondo tocco chiude la barra', await P.eval(`return !document.getElementById('notebook').classList.contains('side-open')`));

  // immagine e condividi
  const ch = P.chooser; await tap(P, 'label.ib.filebtn'); await sleep(300);
  ok('tocco "Inserisci immagine" apre il selettore file', P.chooser === ch + 1);
  // il menu Condividi di iOS non esiste in Chrome: lo simulo e controllo cosa riceve
  await P.eval(`window.__shared=null; navigator.canShare=()=>true; navigator.share=async(d)=>{ const f=d.files[0]; const b=new Uint8Array(await f.arrayBuffer()); window.__shared={name:f.name, type:f.type, size:f.size, head:String.fromCharCode(...b.slice(0,5))}; }; return 1`);
  await tap(P, '#btn-export'); await P.waitFor(`window.__shared`, 20000, 'condivisione');
  const sh = await P.eval(`return window.__shared`);
  ok('tocco condividi → menu Condividi riceve un PDF valido', sh.type === 'application/pdf' && sh.head === '%PDF-' && sh.size > 10000 && sh.name === 'multi.pdf', JSON.stringify(sh));
  ok('dopo la condivisione: niente avvisi bloccati, pulsante attivo', await P.eval(`return document.getElementById('toast').hidden && !document.getElementById('btn-export').disabled`));

  // libreria
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);
  await P.waitFor(`document.querySelector('.card .sheet img.ok')`, 15000, 'copertina');
  ok('copertina con anteprima della prima pagina', true);
  for (const sel of ['#btn-new-folder', '#btn-settings', 'label.pill.filebtn', '#btn-new-nb', '.card .more', '#btn-status'])
    ok('libreria: ' + sel + ' raggiungibile', await reachable(P, sel));
  const c2 = P.chooser; await tap(P, 'label.pill.filebtn'); await sleep(300);
  ok('tocco "Importa PDF" apre il selettore file', P.chooser === c2 + 1);
  await tap(P, '#btn-settings'); await sleep(300);
  ok('tocco impostazioni → finestra OneDrive', await P.eval(`return document.getElementById('settings').open`));
  await shot(P, 'ipad-settings');
  await tap(P, '#set-close'); ok('chiudi impostazioni', await P.eval(`return !document.getElementById('settings').open`));
  await tap(P, '.card .more'); await sleep(300);
  ok('tocco ⋯ → menu del quaderno', await P.eval(`return document.getElementById('dlg').open && document.querySelectorAll('#dlg .opt').length===5`));
  await shot(P, 'ipad-menu');
  await tap(P, '#dlg-cancel'); await sleep(200);
  await tap(P, '#btn-new-nb'); await sleep(300);
  await shot(P, 'ipad-new-nb');
  await P.eval(`document.getElementById('dlg-input').value='Diario del ritiro'; return 1`);
  await tap(P, '#dlg .paper-opt:nth-child(2)');
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].rec.type==='grid'`, 8000, 'nuovo quaderno');
  ok('nuovo quaderno a quadretti creato col tocco', true);
  await pen(P, Array.from({ length: 30 }, (_, i) => [300 + i * 10, 300 + Math.cos(i / 4) * 30]));
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);
  await tap(P, '#btn-new-folder'); await sleep(300);
  await P.eval(`document.getElementById('dlg-input').value='Ritiri'; return 1`);
  await tap(P, '#dlg .opt.accent'); await sleep(500);
  ok('cartella creata col tocco', await P.eval(`return [...document.querySelectorAll('.card.folder b')].some(b=>b.textContent==='Ritiri')`));
  await P.eval(`const D=__penna.D; const n=await D.newNode('notebook','Appunti a righe',null); const p=D.blankPage(n.id,0,'lined'); p.blocks=[{id:'b1',type:'h',text:'Prima settimana'},{id:'b2',type:'p',text:'Il principio e fondamento: l’uomo è creato per lodare, riverire e servire Dio.'}]; await D.put('pages',p); await __penna.refreshLibrary(); return 1`);
  await sleep(1500);
  ok('libreria: tutti i comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-library');

  // ======================= iPhone =======================
  await device(P, 390, 844, 3); await sleep(800);
  await shot(P, 'iphone-library');
  ok('iPhone libreria: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await P.eval(`const n=(await __penna.D.all('nodes')).find(n=>n.name==='multi'); await __penna.openNotebook(n.id); return 1`);
  await P.waitFor('document.querySelector(".page[data-rendered]")', 15000); await sleep(800);
  const mid = await rect(P, '.pillbar.mid');
  ok('iPhone: strumenti in basso, dentro lo schermo', mid.y > 700 && mid.y + mid.h <= 844 && mid.x >= 0 && mid.x + mid.w <= 390, JSON.stringify(mid));
  for (const sel of ['#tool-pen', '#tool-hl', '#btn-color', '#btn-undo', '#btn-back', '#btn-export']) ok('iPhone: ' + sel + ' raggiungibile', await reachable(P, sel));
  ok('iPhone editor: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'iphone-editor');
  await tap(P, '#tool-hl'); await tap(P, '#tool-hl'); await sleep(250);
  const pr = await rect(P, '#pop');
  ok('iPhone: pannello sopra la barra e dentro lo schermo', !(await P.eval(`return document.getElementById('pop').hidden`)) && pr.x >= 0 && pr.x + pr.w <= 390 && pr.y >= 0 && pr.y + pr.h < mid.y, JSON.stringify(pr));
  ok('iPhone: colori >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'iphone-popover');
  await tapXY(P, 200, 300);
  await tap(P, '#btn-pages'); await sleep(400);
  await P.waitFor(`document.querySelectorAll('#page-list img.th.ok').length>=2`, 15000, 'miniature iPhone');
  await shot(P, 'iphone-sidebar');
  await tap(P, '#page-list li:nth-child(2) .go'); await sleep(500);
  ok('iPhone: tocco miniatura chiude la barra', await P.eval(`return !document.getElementById('notebook').classList.contains('side-open')`));
  await tap(P, '#tool-text'); await sleep(200);
  const sub = await rect(P, '#text-tools');
  ok('iPhone: barra testo sopra gli strumenti, dentro lo schermo', sub.x >= 0 && sub.x + sub.w <= 390 && sub.y + sub.h <= mid.y, JSON.stringify(sub));
  await shot(P, 'iphone-text');
  await tap(P, '#tool-pen');

  // ======================= tema scuro =======================
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await device(P, 1024, 768); await sleep(500);
  await tap(P, '#tool-pen'); await sleep(250);
  await shot(P, 'dark-editor-popover');
  await tapXY(P, 900, 600);
  await tap(P, '#btn-back'); await sleep(1200);
  await shot(P, 'dark-library');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  ok('nessun errore a schermo alla fine', await P.eval('return document.getElementById("errbox").hidden'), await P.eval('return document.getElementById("err-msg").textContent'));
  const errs = P.logs.filter((l) => /^(EXC|error)/.test(l));
  ok('nessun errore JS in console', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-6).join('\n')); }
P.close();
console.log(`\nRISULTATO: ${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
