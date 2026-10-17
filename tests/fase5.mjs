// Test della fase 5: libro/contratto da 300 pagine. Vai a pagina (tastierino), pagina precedente/successiva, barra rapida,
// disegno solo delle pagine visibili, tasto Salva con stato, esporta PDF, salva copia, riprende l'ultima pagina, segnalibri,
// ricerca nel testo del PDF. Browser "da iPad": API moderne tolte + polyfill, tocchi veri, penna con pointerType pen.
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase5.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, touch, tapXY, tap, reachable, pen, small, pixels } from './touch.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const APP = process.env.APP || 'http://localhost:8088/index.html';
const SHOTS = OUT + '/shots5'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };
const N = 300;

// ---------- PDF di prova: 300 pagine A4 con testo vero (parole da cercare su alcune pagine) ----------
async function makeBook(path) {
  const doc = await PDFLib.PDFDocument.create();
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica), fb = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const special = { 7: 'Articolo speciale: clausola penale in caso di ritardo.', 42: 'La liberta e la memoria: Liberta di scelta.', 150: 'Clausola rescissoria: il contratto si scioglie se.', 233: 'Altra clausola penale per inadempimento.' };
  for (let i = 1; i <= N; i++) {
    const pg = doc.addPage([595, 842]);
    pg.drawText('Pagina ' + i, { x: 60, y: 760, size: 34, font: fb });
    for (let r = 0; r < 18; r++) pg.drawText('Riga ' + (r + 1) + ' del testo di prova, pagina ' + i + ', con parole comuni per riempire.', { x: 60, y: 700 - r * 26, size: 13, font: f });
    if (special[i]) pg.drawText(special[i], { x: 60, y: 200, size: 16, font: fb });
  }
  fs.writeFileSync(path, await doc.save());
}
await makeBook(OUT + '/contratto300.pdf');
const origSize = fs.statSync(OUT + '/contratto300.pdf').size;

process.env.UA = 'ipad';
const P = await browser(9351, 'strip');
const cur = () => P.eval('return __penna.curIndex()+1');
const ind = () => P.eval('return document.getElementById("page-ind").innerText.replace(/\\s+/g," ").trim()');
const stats = () => P.eval('return __penna.stats()');
const dlgOpt = (label) => P.eval(`const b=[...document.querySelectorAll('#dlg-options button, #dlg-options label')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
async function tapOpt(label) { const c = await dlgOpt(label); if (!c) throw new Error('opzione mancante: ' + label); await tapXY(P, c.x, c.y); }
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

try {
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  ok('Safari vecchio emulato: API moderne tolte, polyfill attivi', await P.eval('return window.__stripped===true && !!ReadableStream.prototype[Symbol.asyncIterator]'));

  // ======================= import di un PDF da 300 pagine =======================
  let t0 = Date.now();
  await P.setFiles('#pdf-input', [OUT + '/contratto300.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===${N} || !document.getElementById('errbox').hidden`, 60000, 'PDF 300 pagine aperto');
  const tImport = Date.now() - t0;
  ok(`PDF da ${N} pagine importato (${(tImport / 1000).toFixed(1)} s)`, await P.eval(`return __penna.nb.pages.length===${N}`), await P.eval('return document.getElementById("err-msg").textContent'));
  await P.waitFor('document.querySelector(".page[data-rendered]")', 15000, 'prima pagina').catch(async (e) => { console.log(await P.eval('return JSON.stringify({st:__penna.stats(), top:document.getElementById("viewer").scrollTop, ch:document.getElementById("viewer").clientHeight, w:__penna.want.size, r:[...__penna.want].map(p=>p.rendered+":"+!!p.task)})')); throw e; });
  await sleep(600);
  ok('barra pagine: "Pagina 1 di 300"', (await ind()) === 'Pagina 1 di 300', await ind());
  let st = await stats();
  ok('solo le pagine vicine sono disegnate (memoria)', st.drawn >= 1 && st.drawn <= 4, JSON.stringify(st));
  for (const sel of ['#btn-find', '#btn-prev', '#page-ind', '#btn-next', '#btn-bm', '#btn-save', '#btn-save-menu'])
    ok('iPad: ' + sel + ' raggiungibile al tocco', await reachable(P, sel));
  ok('iPad editor: tutti i comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  const rows = await P.eval(`return ['.pillbar.left','.pillbar.mid','.pillbar.right','#pagebar'].map(s=>{const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}})`);
  ok('iPad: le barre non si sovrappongono', !overlap(rows[0], rows[1]) && !overlap(rows[1], rows[2]) && rows[3].y > 650, JSON.stringify(rows));
  ok('stato salvataggio visibile: "Salvato"', await P.eval(`return document.getElementById('save-state').dataset.state==='saved' && document.querySelector('#save-state .short').textContent==='Salvato' && document.querySelector('#save-state .short').offsetWidth>0`));
  ok('iPad orizzontale: strumenti esattamente al centro', Math.abs(rows[1].x + rows[1].w / 2 - 512) < 3, JSON.stringify(rows[1]));
  await shot(P, 'ipad-editor-300');

  // ======================= vai a pagina 150 con il tastierino =======================
  await tap(P, '#page-ind'); await sleep(250);
  ok('tocco "Pagina 1 di 300" → tastierino', await P.eval(`return !document.getElementById('goto').hidden`));
  const gr = await rect(P, '#goto');
  ok('tastierino sopra la barra e dentro lo schermo', gr.y >= 0 && gr.y + gr.h < rows[3].y && gr.x >= 0 && gr.x + gr.w <= 1024, JSON.stringify(gr));
  ok('tastierino: tasti >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  for (const k of ['1', '5', '0']) await tap(P, `#goto .key[data-k="${k}"]`);
  ok('digitato 150', (await P.eval(`return document.getElementById('goto-val').textContent`)) === '150');
  await shot(P, 'ipad-goto-keypad');
  t0 = Date.now();
  await tap(P, '#goto .key[data-k="go"]');
  await P.waitFor(`__penna.nb.pages[149].wrap.dataset.rendered==="1"`, 15000, 'pagina 150 disegnata');
  const tGoto = Date.now() - t0;
  ok(`Invio → pagina 150 (disegnata in ${tGoto} ms)`, (await cur()) === 150 && (await ind()) === 'Pagina 150 di 300' && tGoto < 4000, (await ind()) + ' ' + tGoto);
  ok('tastierino chiuso dopo il salto', await P.eval(`return document.getElementById('goto').hidden`));
  await sleep(300);
  ok('pagina 150: testo del PDF visibile', (await pixels(P, '.page[data-id="' + (await P.eval('return __penna.nb.pages[149].rec.id')) + '"] canvas.bg')).dark > 100);
  st = await stats();
  ok('dopo il salto: ancora poche pagine disegnate', st.drawn <= 4, JSON.stringify(st));
  // pagina inesistente
  await tap(P, '#page-ind'); await sleep(200);
  for (const k of ['9', '9', '9']) await tap(P, `#goto .key[data-k="${k}"]`);
  await tap(P, '#goto .key[data-k="go"]'); await sleep(200);
  ok('pagina 999 → avviso "Scegli da 1 a 300", resta su 150', await P.eval(`return !document.getElementById('goto').hidden && /da 1 a 300/.test(document.getElementById('goto-sub').textContent)`) && (await cur()) === 150);
  await tap(P, '#goto .key[data-k="del"]'); // campo già vuoto: nessun problema
  await tapXY(P, 900, 400); await sleep(150);
  ok('tocco fuori chiude il tastierino senza disegnare', await P.eval(`return document.getElementById('goto').hidden && __penna.nb.pages.every(p=>!p.rec.strokes.length)`));
  // tastiera fisica
  await tap(P, '#page-ind'); await sleep(150);
  for (const k of ['2', '0', '0']) await P.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
  await P.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(300);
  ok('tastiera fisica: 200 + Invio', (await cur()) === 200, await cur());
  // precedente / successiva
  await P.eval('__penna.goToPage(149); return 1'); await sleep(200);
  await tap(P, '#btn-next'); await sleep(200);
  const afterNext = await cur();
  await tap(P, '#btn-prev'); await sleep(200);
  ok('pagina successiva / precedente', afterNext === 151 && (await cur()) === 150, afterNext + ' → ' + (await cur()));

  // ======================= barra rapida (trascinamento) =======================
  await P.eval(`document.getElementById('viewer').scrollBy(0, 40); return 1`); await sleep(250);
  ok('scorrendo compare la barra rapida', await P.eval(`return document.getElementById('scrub').classList.contains('show')`));
  const th = await rect(P, '#scrub-thumb'), tr = await rect(P, '#scrub');
  await P.eval(`window.__long=[]; try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) __long.push(Math.round(e.duration))}).observe({entryTypes:['longtask']}); }catch(e){} return 1`);
  await touch(P, 'touchStart', th.cx, th.cy);
  const y1 = tr.y + (tr.h - th.h) * 0.25 + th.h / 2;
  for (let k = 1; k <= 12; k++) { await touch(P, 'touchMove', th.cx, th.cy + (y1 - th.cy) * k / 12); await sleep(30); }
  await sleep(150);
  ok('trascinando compare il numero di pagina', await P.eval(`return document.getElementById('scrub').classList.contains('drag') && /Pagina \\d+/.test(document.getElementById('scrub-tip').textContent)`));
  await shot(P, 'ipad-scrub-drag');
  await touch(P, 'touchEnd', 0, 0); await sleep(200);
  const sc = await cur();
  ok('barra rapida: trascinata a 1/4 → circa pagina 75', sc > 60 && sc < 92, 'pagina ' + sc);
  await P.waitFor(`__penna.nb.pages[__penna.curIndex()].wrap.dataset.rendered==="1"`, 15000, 'pagina dopo la barra rapida');
  const longs = await P.eval('return window.__long');
  ok('scorrimento fluido: nessun blocco > 250 ms durante il trascinamento (Chrome)', !longs.length || Math.max(...longs) < 250, JSON.stringify(longs));
  st = await stats();
  ok('dopo aver attraversato 75 pagine: poche pagine in memoria', st.drawn <= 4, JSON.stringify(st));

  // ======================= salva =======================
  await P.eval('__penna.goToPage(149); __penna.S.pen.color="#d62828"; __penna.S.pen.size=6; return 1'); await sleep(700);
  const pg = await P.eval(`const r=__penna.nb.pages[149].wrap.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width}`);
  await pen(P, Array.from({ length: 30 }, (_, i) => [pg.x + 150 + i * 10, Math.max(pg.y, 80) + 260 + Math.sin(i / 3) * 20]));
    ok('tratto con la penna → "Modifiche non salvate" ("Non salvato" sulla barra a 1024 px)', await P.eval(`return document.getElementById('save-state').dataset.state==='dirty' && document.querySelector('#save-state .long').textContent==='Modifiche non salvate' && document.querySelector('#save-state .short').textContent==='Non salvato'`),
    await P.eval(`return document.getElementById('save-state').textContent`));
  ok('cambiando stato la barra non si sposta', Math.abs((await rect(P, '.pillbar.mid')).x - rows[1].x) < 1, JSON.stringify(await rect(P, '.pillbar.mid')));
  await shot(P, 'ipad-unsaved');
  await tap(P, '#btn-save'); await sleep(250);
  const toastTxt = await P.eval(`return document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent`);
  ok('tasto Salva → conferma "Salvato ✓ alle HH:MM"', /^Salvato ✓ alle \d\d:\d\d$/.test(toastTxt), toastTxt);
  ok('stato in barra: "Salvato" (e "Salvato alle HH:MM" sugli schermi larghi)', await P.eval(`return document.getElementById('save-state').dataset.state==='saved' && document.querySelector('#save-state .short').textContent==='Salvato' && /^Salvato alle \\d\\d:\\d\\d$/.test(document.querySelector('#save-state .long').textContent)`));
  ok('salvato davvero nell\'archivio (pagina 150 con 1 tratto)', await P.eval(`const p=(await __penna.D.pagesOf(__penna.nb.node.id))[149]; return p.strokes.length===1 && p.strokes[0].c==='#d62828'`));
  await shot(P, 'ipad-saved');

  // ======================= segnalibri =======================
  await tap(P, '#btn-bm'); await sleep(300);
  ok('tocco segnalibro → finestra con nome proposto "Pagina 150"', await P.eval(`return document.getElementById('dlg').open && document.getElementById('dlg-input').value==='Pagina 150'`));
  await P.type('Clausola rescissoria');
  await shot(P, 'ipad-bookmark-add');
  await tapOpt('Aggiungi segnalibro'); await sleep(900);
  ok('segnalibro con nome salvato sulla pagina 150', await P.eval(`const p=(await __penna.D.pagesOf(__penna.nb.node.id))[149]; return !!p.bm && p.bm.name==='Clausola rescissoria'`));
  ok('nastrino sulla pagina e pulsante segnalibro acceso', await P.eval(`return __penna.nb.pages[149].wrap.classList.contains('bm') && document.getElementById('btn-bm').classList.contains('on')`));
  await P.eval('__penna.goToPage(7); return 1'); await sleep(200);
  await tap(P, '#btn-bm'); await sleep(300); await tapOpt('Aggiungi segnalibro'); await sleep(300); // nome proposto "Pagina 8"
  await P.eval('__penna.goToPage(0); return 1'); await sleep(300);
  await tap(P, '#btn-pages'); await sleep(400);
  await tap(P, '#sidebar .seg button[data-tab="marks"]'); await sleep(250);
  ok('scheda Segnalibri: 2 segnalibri in ordine di pagina', await P.eval(`const t=[...document.querySelectorAll('#bm-list .row-go')].map(b=>b.textContent); return t.length===2 && t[0]==='Pagina 8' && /Clausola rescissoria/.test(t[1]) && /Pagina 150/.test(t[1])`),
    await P.eval(`return [...document.querySelectorAll('#bm-list .row-go')].map(b=>b.textContent).join(' | ')`));
  ok('pagine spostate a destra con la barra aperta (iPad orizzontale)', (await rect(P, '.page')).x > 270);
  await shot(P, 'ipad-sidebar-bookmarks');
  await tap(P, '#bm-list li:nth-child(2) .row-go'); await sleep(400);
  ok('tocco sul segnalibro → pagina 150', (await cur()) === 150, await cur());
  await tap(P, '#sidebar .seg button[data-tab="pages"]'); await sleep(500);
  ok('scheda Pagine: miniatura della pagina corrente (150) in vista', await P.eval(`const ol=document.getElementById('page-list'), li=ol.querySelector('li.cur'); if(!li) return false; const a=ol.getBoundingClientRect(), b=li.getBoundingClientRect(); return b.top>=a.top-2 && b.bottom<=a.bottom+2 && li.querySelector('.num').textContent==='150'`));
  await P.waitFor(`document.querySelector('#page-list li.cur img.th.ok')`, 15000, 'miniatura 150');
  ok('miniature lontane non tenute in memoria', await P.eval(`return document.querySelectorAll('#page-list img.th.ok').length < 30`), await P.eval(`return document.querySelectorAll('#page-list img.th.ok').length`));
  await shot(P, 'ipad-sidebar-pages-150');

  // ======================= ricerca nel testo =======================
  await tap(P, '#btn-find'); await sleep(300);
  ok('tocco cerca → scheda Cerca con il campo pronto', await P.eval(`return !document.getElementById('tab-find').hidden && document.activeElement===document.getElementById('find-input')`));
  t0 = Date.now();
  await P.type('rescissoria');
  await P.waitFor(`/risultat|Nessun/.test(document.getElementById('find-status').textContent)`, 60000, 'ricerca 1');
  const tFind1 = Date.now() - t0;
  ok(`cerca "rescissoria" in 300 pagine → 1 risultato a pagina 150 (${(tFind1 / 1000).toFixed(1)} s)`, await P.eval(`const h=document.querySelectorAll('#find-list .fhit'); return h.length===1 && /Pagina 150/.test(h[0].textContent) && !!h[0].querySelector('mark')`),
    await P.eval(`return document.getElementById('find-status').textContent`));
  await P.eval(`const i=document.getElementById('find-input'); i.select(); return 1`);
  t0 = Date.now();
  await P.type('liberta');
  await P.waitFor(`/risultat|Nessun/.test(document.getElementById('find-status').textContent) && document.getElementById('find-input').value==='liberta' && !/Cerco/.test(document.getElementById('find-status').textContent)`, 30000, 'ricerca 2');
  const tFind2 = Date.now() - t0;
  ok(`seconda ricerca immediata (testo già letto): ${tFind2} ms`, tFind2 < 2500, tFind2);
  ok('"liberta" trova anche "Liberta" (maiuscole/accenti non contano): 2 risultati a pagina 42', await P.eval(`const h=[...document.querySelectorAll('#find-list .fhit')]; return h.length===2 && h.every(x=>/Pagina 42/.test(x.textContent))`),
    await P.eval(`return document.getElementById('find-status').textContent`));
  await P.eval(`const i=document.getElementById('find-input'); i.select(); return 1`);
  await P.type('clausola');
  await P.waitFor(`document.getElementById('find-input').value==='clausola' && /risultat/.test(document.getElementById('find-status').textContent) && !/Cerco/.test(document.getElementById('find-status').textContent)`, 30000, 'ricerca 3');
  ok('"clausola" → pagine 7, 150, 233', await P.eval(`const t=[...document.querySelectorAll('#find-list .fhit b')].map(b=>b.textContent); return t.join(',')==='Pagina 7,Pagina 150,Pagina 233'`),
    await P.eval(`return [...document.querySelectorAll('#find-list .fhit b')].map(b=>b.textContent).join(',')`));
  await tap(P, '#find-list li:nth-child(3) .fhit'); await sleep(700);
  ok('tocco sul risultato → pagina 233', (await cur()) === 233, await cur());
  const mk = await P.eval(`const m=document.querySelector('.find-mark'); if(!m) return null; const p=m.parentElement.getBoundingClientRect(), r=m.getBoundingClientRect(); const c=document.createElement('canvas').getContext('2d'); c.font='bold 16px Helvetica, Arial, sans-serif'; const W=(t)=>c.measureText(t).width;
    return {page: __penna.nb.pages.findIndex(x=>x.wrap===m.parentElement)+1, top:(r.top-p.top)/p.height, left:(r.left-p.left)/p.width, wf:r.width/p.width, expL:(60+W('Altra '))/595, expW:W('clausola')/595, vis: r.top>0 && r.bottom<innerHeight}`);
  // la riga speciale è a y=200 su 842 punti (dal basso) → circa 0.75 della pagina dall'alto; "clausola" inizia dopo "Altra " ≈ 0.18
  ok('parola evidenziata sulla pagina, nel punto giusto e in vista', mk && mk.page === 233 && Math.abs(mk.top - 0.745) < 0.05 && Math.abs(mk.left - mk.expL) < 0.012 && Math.abs(mk.wf - mk.expW) < 0.015 && mk.vis, JSON.stringify(mk));
  await shot(P, 'ipad-search-results');
  ok('iPad con barra aperta: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));

  // ======================= menu Salva: esporta e salva copia =======================
  await tap(P, '#btn-pages'); await sleep(300);
  await tap(P, '#btn-save-menu'); await sleep(300);
  ok('menu Salva: Salva ora / Esporta PDF con annotazioni / Salva una copia', await P.eval(`const t=[...document.querySelectorAll('#dlg-options .opt')].map(b=>b.textContent.trim()); return t.join('|')==='Salva ora|Esporta PDF con annotazioni|Salva una copia del quaderno'`),
    await P.eval(`return [...document.querySelectorAll('#dlg-options .opt')].map(b=>b.textContent.trim()).join('|')`));
  await shot(P, 'ipad-save-menu');
  await P.eval(`window.__shared=null; navigator.canShare=()=>true; navigator.share=async(d)=>{ const f=d.files[0]; const b=new Uint8Array(await f.arrayBuffer()); let s=''; for(let i=0;i<b.length;i+=8192) s+=String.fromCharCode(...b.subarray(i,i+8192)); window.__shared={name:f.name,type:f.type,size:f.size,b64:btoa(s)}; }; return 1`);
  await tapOpt('Esporta PDF con annotazioni');
  await P.waitFor(`window.__shared || (document.getElementById('dlg').open && /pronto/.test(document.getElementById('dlg-title').textContent))`, 60000, 'export');
  if (!(await P.eval('return !!window.__shared'))) {
    await shot(P, 'ipad-export-ready');
    await tapOpt('Condividi o salva in File');
    await P.waitFor('window.__shared', 20000, 'condivisione');
  }
  const sh = await P.eval(`const s=window.__shared; return {name:s.name,type:s.type,size:s.size,b64:s.b64}`);
  const exp = Buffer.from(sh.b64, 'base64');
  fs.writeFileSync(OUT + '/export300.pdf', exp);
  const ed = await PDFLib.PDFDocument.load(exp);
  ok(`Esporta PDF: 300 pagine, ${(exp.length / 1024).toFixed(0)} KB (originale ${(origSize / 1024).toFixed(0)} KB)`, ed.getPageCount() === N && sh.type === 'application/pdf' && sh.name === 'contratto300.pdf' && exp.length < origSize * 3, JSON.stringify({ n: ed.getPageCount(), size: exp.length }));
  const red = await P.eval(`const s=window.__shared; const bin=atob(s.b64); const b=new Uint8Array(bin.length); for(let i=0;i<b.length;i++) b[i]=bin.charCodeAt(i);
    const pdfjs=await __penna.pdfjs(); const task=pdfjs.getDocument({data:b, standardFontDataUrl:'./lib/standard_fonts/'}); const doc=await task.promise;
    const out=[]; for (const n of [149,150]) { const pg=await doc.getPage(n); const vp=pg.getViewport({scale:1}); const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height; await pg.render({canvas:c, canvasContext:c.getContext('2d'), viewport:vp}).promise;
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let r=0; for(let i=0;i<d.length;i+=4) if(d[i]>180&&d[i+1]<90&&d[i+2]<90) r++; out.push(r); } task.destroy(); return out`);
  ok('nel PDF esportato il tratto rosso è sulla pagina 150 (e non sulla 149)', red[1] > 100 && red[0] === 0, JSON.stringify(red));
  await tap(P, '#btn-save-menu'); await sleep(300);
  await tapOpt('Salva una copia del quaderno'); await sleep(300);
  ok('Salva copia: nome proposto "contratto300 (copia)"', await P.eval(`return document.getElementById('dlg-input').value==='contratto300 (copia)'`));
  await tapOpt('Salva copia');
  await P.waitFor(`document.getElementById('toast').textContent.includes('Copia salvata')`, 10000, 'copia');
  const cp = await P.eval(`const n=(await __penna.D.all('nodes')).find(n=>n.name==='contratto300 (copia)' && !n.deleted); if(!n) return null; const ps=await __penna.D.pagesOf(n.id); return {n:ps.length, s:ps[149].strokes.length, bm:ps[149].bm&&ps[149].bm.name, open:__penna.nb.node.name}`);
  ok('copia nella libreria: 300 pagine, tratto e segnalibro copiati; resto nel quaderno originale', cp && cp.n === N && cp.s === 1 && cp.bm === 'Clausola rescissoria' && cp.open === 'contratto300', JSON.stringify(cp));

  // ======================= riprende dall'ultima pagina =======================
  await P.eval('__penna.goToPage(149); return 1'); await sleep(1000);
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);
  await sleep(300);
  await P.eval(`const c=[...document.querySelectorAll('.card')].find(c=>c.querySelector('b').textContent==='contratto300'); c.querySelector('.cover').click(); return 1`);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===${N} && __penna.nb.pages[149].wrap.dataset.rendered==="1"`, 15000, 'riapertura');
  await sleep(200);
  ok('riaperto il quaderno → riprende da pagina 150', (await cur()) === 150 && /Riprendi da pagina 150/.test(await P.eval(`return document.getElementById('toast').textContent`)), (await cur()) + ' ' + await P.eval(`return document.getElementById('toast').textContent`));
  await sleep(800);
  await P.reload();
  await P.waitFor(`window.__penna && !document.getElementById('notebook').hidden && __penna.nb.pages.length===${N} && __penna.nb.pages[149].wrap.dataset.rendered==="1"`, 20000, 'riavvio app');
  ok('app chiusa e riaperta → torna nel quaderno a pagina 150', (await cur()) === 150, await cur());
  ok('dopo il riavvio: segnalibri e tratto ci sono ancora', await P.eval(`return __penna.nb.pages[149].rec.bm.name==='Clausola rescissoria' && __penna.nb.pages[149].rec.strokes.length===1 && __penna.nb.pages[149].wrap.classList.contains('bm')`));

  // ======================= iPad verticale =======================
  const before = await cur();
  await device(P, 768, 1024); await sleep(600);
  ok('girando l\'iPad resta sulla stessa pagina (' + before + ')', (await cur()) === before, before + ' → ' + (await cur()));
  const vr = await P.eval(`return ['.pillbar.left','.pillbar.mid','.pillbar.right','#pagebar'].map(s=>{const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}})`);
  ok('iPad verticale: barre dentro lo schermo e senza sovrapposizioni', vr.every((r) => r.x >= 0 && r.x + r.w <= 768) && !overlap(vr[0], vr[1]) && !overlap(vr[1], vr[2]), JSON.stringify(vr));
  ok('iPad verticale: stato salvataggio (breve) visibile', await P.eval(`return document.querySelector('#save-state .short').offsetWidth>0`));
  ok('iPad verticale: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-portrait-editor');
  await device(P, 744, 1133); await sleep(400);
  const mr = await P.eval(`return ['.pillbar.left','.pillbar.mid','.pillbar.right'].map(s=>{const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}})`);
  ok('iPad mini verticale (744): nessuna sovrapposizione', mr.every((r) => r.x >= 0 && r.x + r.w <= 744) && !overlap(mr[0], mr[1]) && !overlap(mr[1], mr[2]), JSON.stringify(mr));

  // ======================= iPhone =======================
  await device(P, 390, 844, 3); await sleep(700);
  const top = await rect(P, '#page-ind'), mid = await rect(P, '.pillbar.mid');
  ok('iPhone: "150 di 300" in alto al centro', top.y < 70 && top.x > 100 && top.x + top.w < 290 && (await ind()) === '150 di 300', JSON.stringify(top) + ' ' + await ind());
  for (const sel of ['#btn-back', '#btn-pages', '#page-ind', '#btn-save', '#btn-save-menu', '#tool-pen', '#btn-undo']) ok('iPhone: ' + sel + ' raggiungibile', await reachable(P, sel));
  ok('iPhone: barre in alto senza sovrapposizioni', await P.eval(`const r=['.pillbar.left','#pagebar','.pillbar.right'].map(s=>document.querySelector(s).getBoundingClientRect()); return r[0].right<=r[1].left && r[1].right<=r[2].left && r[2].right<=390`));
  ok('iPhone editor: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'iphone-editor-300');
  await tap(P, '#page-ind'); await sleep(250);
  const g2 = await rect(P, '#goto');
  ok('iPhone: tastierino sotto la barra, dentro lo schermo, con Precedente/Successiva', g2.y > top.y + top.h && g2.x >= 0 && g2.x + g2.w <= 390 && g2.y + g2.h < mid.y && await P.eval(`return document.querySelector('.goto-nav').offsetHeight>0`), JSON.stringify(g2));
  ok('iPhone tastierino: tasti >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await tap(P, '#goto .key[data-k="1"]'); await tap(P, '#goto .key[data-k="0"]');
  await shot(P, 'iphone-goto');
  await tap(P, '#goto .key[data-k="go"]'); await sleep(400);
  ok('iPhone: vai a pagina 10', (await cur()) === 10, await cur());
  await tap(P, '#btn-pages'); await sleep(400);
  await tap(P, '#sidebar .seg button[data-tab="find"]'); await sleep(200);
  await tap(P, '#find-input'); await P.type('penale');
  await P.waitFor(`document.getElementById('find-input').value==='penale' && /risultat/.test(document.getElementById('find-status').textContent) && !/Cerco/.test(document.getElementById('find-status').textContent)`, 30000, 'ricerca iPhone');
  ok('iPhone: ricerca "penale" → 2 risultati', await P.eval(`return document.querySelectorAll('#find-list .fhit').length===2`));
  await P.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
  await shot(P, 'iphone-search');
  await tap(P, '#find-list li:nth-child(1) .fhit'); await sleep(600);
  ok('iPhone: tocco risultato → pagina 7 e barra chiusa', (await cur()) === 7 && await P.eval(`return !document.getElementById('notebook').classList.contains('side-open')`));
  await shot(P, 'iphone-search-hit');

  // ======================= tema scuro =======================
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await device(P, 1024, 768); await sleep(500);
  await tap(P, '#page-ind'); await sleep(250);
  await shot(P, 'dark-goto');
  await tapXY(P, 900, 400);
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  ok('nessun errore a schermo', await P.eval('return document.getElementById("errbox").hidden'), await P.eval('return document.getElementById("err-msg").textContent'));
  const errs = P.logs.filter((l) => /^(EXC|error)/.test(l));
  ok('nessun errore JS in console', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\nTEMPI: import ${tImport} ms · vai a pagina 150 ${tGoto} ms · prima ricerca ${tFind1} ms · seconda ${tFind2} ms`);
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-8).join('\n')); }
P.close();
console.log(`\nRISULTATO: ${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
