// 34 test della fase 2 (quaderni, note, ricerca, PDF, export, sync con finto OneDrive).
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/e2e.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, sleep, OUT } from './cdp.mjs';
import { startMock } from './mock.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const URL_APP = process.env.APP || 'http://localhost:8088/index.html';
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'OK ' : 'FAIL', name, extra]); console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

// PDF di prova: 3 pagine con testo; e uno grande (>4MB) per l'upload a pezzi
async function mkPdf(path, pages, bigBytes = 0) {
  const doc = await PDFLib.PDFDocument.create();
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const pg = doc.addPage([400, 560]); pg.drawText('Pagina di prova ' + (i + 1), { x: 40, y: 500, size: 28, font: f }); }
  if (bigBytes) { const b = new Uint8Array(bigBytes); for (let i = 0; i < b.length; i += 4) { const r = (Math.random() * 4294967296) >>> 0; b[i] = r; b[i + 1] = r >> 8; b[i + 2] = r >> 16; b[i + 3] = r >> 24; } await doc.attach(b, 'x.bin', { mimeType: 'application/octet-stream' }); }
  fs.writeFileSync(path, await doc.save());
}
await mkPdf(OUT + '/test3.pdf', 3);
await mkPdf(OUT + '/big.pdf', 1, 5 * 1024 * 1024);

const mock = await startMock(9000);
const A = await launch(9311); await A.init();
const B = await launch(9312); await B.init();

const click = (p, sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const stroke = (p, pageIdx, pts) => p.eval(`
  const c = document.querySelectorAll('.page canvas.draw')[${pageIdx}]; const r = c.getBoundingClientRect();
  const pts = ${JSON.stringify(pts)};
  const ev = (type, [x,y]) => c.dispatchEvent(new PointerEvent(type, {pointerId: 7, pointerType: 'pen', pressure: 0.6, clientX: r.left + x*r.width, clientY: r.top + y*r.height, bubbles: true, cancelable: true, isPrimary: true, button: 0}));
  ev('pointerdown', pts[0]); for (const q of pts.slice(1)) ev('pointermove', q); ev('pointerup', pts[pts.length-1]);
  return true;`);
const modalClickOpt = (p, label) => p.eval(`const b=[...document.querySelectorAll('#dlg-options button, #dlg-options label')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); b.click(); return !!b`);
const P = (p) => p.eval('return {nodes:(await __penna.D.all("nodes")).filter(n=>!n.deleted).map(n=>({id:n.id,name:n.name,kind:n.kind})), pages:(await __penna.D.all("pages")).filter(p=>!p.deleted).map(p=>({id:p.id,nb:p.nb,type:p.type,strokes:p.strokes.length,blocks:p.blocks.length,images:p.images.length,updated:p.updated,dirty:p.dirty})), blobs:(await __penna.D.all("blobs")).map(b=>({id:b.id,mime:b.mime,len:b.data.byteLength}))}');
const state = (p) => p.eval('return __penna.Sync.status.state');

try {
  // ---------- 1. Quaderno, nota, tratto, persistenza ----------
  await A.goto(URL_APP);
  await A.waitFor('document.getElementById("btn-new-nb")');
  await sleep(500);
  ok('Avvio senza Client ID: OneDrive disattivato', await A.eval('return document.getElementById("btn-onedrive").disabled && /Client ID/.test(document.getElementById("sync-help").textContent)'));
  await click(A, '#btn-new-nb'); await sleep(200);
  await A.eval('const i=document.getElementById("dlg-input"); i.value="Quaderno Prova"; return 1');
  await modalClickOpt(A, 'Righe');
  await A.waitFor('!document.getElementById("notebook").hidden && document.querySelector(".page[data-rendered]")', 8000, 'quaderno aperto');
  ok('Quaderno creato e aperto con 1 pagina a righe', await A.eval('return __penna.nb.pages.length===1 && __penna.nb.pages[0].rec.type==="lined"'));
  await stroke(A, 0, [[0.2, 0.2], [0.3, 0.25], [0.4, 0.22], [0.5, 0.3]]);
  await click(A, '#tool-text'); await click(A, '[data-add="h"]'); await sleep(100);
  await A.type('La mia lista');
  await click(A, '[data-add="todo"]'); await sleep(100);
  await A.type('comprare latte');
  await A.eval('const i=document.querySelector(".blk.todo input[type=text]"); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return 1'); await sleep(100);
  await A.type('pane');
  await click(A, '[data-add="ul"]'); await A.type('voce elenco');
  await click(A, '[data-add="p"]'); await A.type('Paragrafo di testo libero');
  await A.eval('document.querySelector(".blk.todo input[type=checkbox]").click(); return 1');
  await sleep(700);
  // immagine: genero un PNG dalla pagina
  const png = await A.eval('const c=document.createElement("canvas");c.width=120;c.height=80;const x=c.getContext("2d");x.fillStyle="#C2664A";x.fillRect(0,0,120,80);x.fillStyle="#fff";x.fillRect(20,20,40,40);return c.toDataURL("image/png").split(",")[1]');
  fs.writeFileSync(OUT + '/img.png', Buffer.from(png, 'base64'));
  await A.setFiles('#img-input', [OUT + '/img.png']); await sleep(700);
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  await A.shot(OUT + '/shot-ipad-notebook-text.png', 1024, 768);
  await click(A, '#tool-pen');
  let d = await P(A);
  ok('Stato prima del riavvio: 1 tratto, 4 blocchi, 1 immagine', d.pages[0].strokes === 1 && d.pages[0].blocks === 4 && d.pages[0].images === 1, JSON.stringify(d.pages[0]));
  await A.reload(); await A.waitFor('document.getElementById("btn-new-nb")');
  await sleep(500);
  d = await P(A);
  ok('Riavvio → persistenza (quaderno, tratto, blocchi, immagine)', d.nodes.length === 1 && d.pages[0].strokes === 1 && d.pages[0].blocks === 4 && d.pages[0].images === 1);
  await A.eval('const id=__penna.lib&&(await __penna.D.all("nodes"))[0].id; await __penna.openNotebook(id); return 1');
  await A.waitFor('document.querySelector(".page[data-rendered]")');
  ok('Riaperto: blocchi di testo e checklist ripristinati', await A.eval('return document.querySelectorAll(".blk").length===4 && document.querySelectorAll(".blk.todo .row.done").length===1 && document.querySelector(".blk.h textarea").value==="La mia lista"'));
  // aggiungo due pagine (quadretti, bianco) e riordino
  await click(A, '#btn-add-page'); await sleep(200); await modalClickOpt(A, 'Quadretti'); await sleep(500);
  await click(A, '#btn-add-page'); await sleep(200); await modalClickOpt(A, 'Foglio bianco'); await sleep(500);
  let types = await A.eval('return __penna.nb.pages.map(p=>p.rec.type).join(",")');
  ok('Aggiunta pagine (dopo quella corrente)', types.split(',').length === 3 && types.includes('grid') && types.includes('blank'), types);
  await A.eval('document.querySelectorAll("#page-list li")[0].querySelectorAll(".mini")[1].click(); return 1'); await sleep(600);
  const types2 = await A.eval('return __penna.nb.pages.map(p=>p.rec.type).join(",")');
  ok('Riordino pagine (▼)', types2 !== types, types + ' → ' + types2);
  // rinomina + colore dal menu della libreria
  await click(A, '#btn-back'); await sleep(300);
  await A.eval('document.querySelector(".card .more").click(); return 1'); await sleep(200);
  await modalClickOpt(A, 'Rinomina'); await sleep(200);
  await A.eval('document.getElementById("dlg-input").value="Quaderno Rinominato"; return 1'); await modalClickOpt(A, 'Salva'); await sleep(300);
  await A.eval('document.querySelector(".card .more").click(); return 1'); await sleep(200);
  await modalClickOpt(A, 'Cambia colore'); await sleep(200);
  await A.eval('document.querySelectorAll("#dlg-options .sw")[3].click(); return 1'); await sleep(300);
  ok('Rinomina e colore copertina', await A.eval('return document.querySelector(".card .info b").textContent==="Quaderno Rinominato" && document.querySelector(".card .cover").style.background.length>0'));
  // cartella
  await click(A, '#btn-new-folder'); await sleep(200);
  await A.eval('document.getElementById("dlg-input").value="Lavoro"; return 1'); await modalClickOpt(A, 'Crea'); await sleep(300);
  ok('Cartella creata', await A.eval('return [...document.querySelectorAll(".card .info b")].some(b=>b.textContent==="Lavoro")'));
  // sposta il quaderno nella cartella
  await A.eval('[...document.querySelectorAll(".card")].find(c=>c.querySelector("b").textContent==="Quaderno Rinominato").querySelector(".more").click(); return 1'); await sleep(200);
  await modalClickOpt(A, 'Sposta in'); await sleep(200); await modalClickOpt(A, 'Lavoro'); await sleep(300);
  ok('Sposta quaderno in cartella', await A.eval('return ![...document.querySelectorAll(".card .info b")].some(b=>b.textContent==="Quaderno Rinominato")'));
  await A.eval('[...document.querySelectorAll(".card")].find(c=>c.querySelector("b").textContent==="Lavoro").querySelector(".cover").click(); return 1'); await sleep(300);
  ok('Entra nella cartella e trova il quaderno', await A.eval('return [...document.querySelectorAll(".card .info b")].some(b=>b.textContent==="Quaderno Rinominato")'));
  // ricerca
  await A.eval('document.getElementById("btn-onedrive"); const s=document.getElementById("search"); s.value="latte"; s.dispatchEvent(new Event("input")); return 1'); await sleep(500);
  ok('Ricerca testo nelle note ("latte")', await A.eval('return document.querySelectorAll("#results .hit").length===1 && /pagina/.test(document.querySelector("#results .s").textContent) && !!document.querySelector("#results mark")'));
  await A.eval('const s=document.getElementById("search"); s.value="rinominato"; s.dispatchEvent(new Event("input")); return 1'); await sleep(500);
  ok('Ricerca per titolo quaderno', await A.eval('return document.querySelectorAll("#results .hit").length>=1'));
  await A.eval('const s=document.getElementById("search"); s.value=""; s.dispatchEvent(new Event("input")); return 1'); await sleep(400);
  await A.eval('document.querySelector("#crumbs button").click(); return 1'); await sleep(300);
  await A.shot(OUT + '/shot-ipad-library.png', 1024, 768);

  // ---------- 2. PDF importato ----------
  await A.setFiles('#pdf-input', [OUT + '/test3.pdf']);
  await A.waitFor('!document.getElementById("notebook").hidden && document.querySelectorAll(".page[data-rendered]").length>=1', 15000, 'PDF aperto');
  ok('PDF importato: 3 pagine nel quaderno', await A.eval('return __penna.nb.pages.length===3 && __penna.nb.pages.every(p=>p.rec.type==="pdf")'));
  await sleep(500);
  const nonWhite = await A.eval(`const c=document.querySelector(".page canvas.bg"); const x=c.getContext("2d"); const d=x.getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=4) if(d[i]<100&&d[i+1]<100) n++; return n`);
  ok('PDF renderizzato (pixel di testo presenti)', nonWhite > 200, 'pixel scuri=' + nonWhite);
  await stroke(A, 0, [[0.1, 0.1], [0.5, 0.15], [0.8, 0.1]]);
  await stroke(A, 1, [[0.1, 0.5], [0.6, 0.55]]);
  await sleep(600);
  const pdfBytesB64 = await A.eval('const b=await __penna.exportBytes(); let s=""; for(let i=0;i<b.length;i+=8192) s+=String.fromCharCode(...b.subarray(i,i+8192)); return btoa(s)');
  const exported = Buffer.from(pdfBytesB64, 'base64');
  fs.writeFileSync(OUT + '/export-pdf.pdf', exported);
  const ed = await PDFLib.PDFDocument.load(exported);
  ok('Export PDF (quaderno PDF): valido, 3 pagine', ed.getPageCount() === 3 && exported.slice(0, 5).toString() === '%PDF-');
  // export del quaderno con testo: controllo il testo con pdf.js
  const nbText = await A.eval(`
    const id=(await __penna.D.all("nodes")).find(n=>n.name==="Quaderno Rinominato").id; await __penna.openNotebook(id);
    await __penna.flush(); const b=await __penna.exportBytes();
    const pdfjs = await import('./lib/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc='./lib/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({data:b, standardFontDataUrl:'./lib/standard_fonts/'}).promise;
    const out={pages:doc.numPages, text:''}; for(let i=1;i<=doc.numPages;i++){ const t=await (await doc.getPage(i)).getTextContent(); out.text+=t.items.map(x=>x.str).join(' ')+'\\n'; } return out;`);
  ok('Export PDF quaderno note: 3 pagine con titolo, checklist e testo', nbText.pages === 3 && /La mia lista/.test(nbText.text) && /comprare latte/.test(nbText.text) && /Paragrafo di testo libero/.test(nbText.text), JSON.stringify(nbText).slice(0, 160));
  await click(A, '#btn-back'); await sleep(300);

  // ---------- 3. Sync ----------
  A.logs.length = 0;
  await A.eval(`__penna.Sync.useCustom({token:'fake', base:'http://localhost:9000/v1.0'}); return 1`);
  await A.waitFor('__penna.Sync.status.state==="idle"', 15000, 'A sync idle');
  await sleep(300);
  let st = await (await fetch('http://localhost:9000/__stats')).json();
  const dA = await P(A);
  ok('Sync A: upload di nodi, pagine e allegati su finto OneDrive', st.files.filter((f) => f.startsWith('n-')).length === dA.nodes.length && st.files.filter((f) => f.startsWith('p-')).length === dA.pages.length && st.files.filter((f) => f.startsWith('b-')).length === dA.blobs.length, JSON.stringify({ files: st.files.length, puts: st.puts }));
  ok('Sync A: indicatore "sincronizzato"', await A.eval('return /Sincronizzato/.test(document.getElementById("sync-text").textContent)'));
  const putsAfter1 = st.puts;
  await A.eval('__penna.Sync.syncNow(); return 1'); await A.waitFor('__penna.Sync.status.state==="idle"'); await sleep(200);
  st = await (await fetch('http://localhost:9000/__stats')).json();
  ok('Secondo sync senza modifiche: nessun nuovo upload', st.puts === putsAfter1, 'puts=' + st.puts);

  // dispositivo B
  await B.goto(URL_APP); await B.waitFor('document.getElementById("btn-new-nb")');
  await B.eval(`__penna.Sync.useCustom({token:'fake', base:'http://localhost:9000/v1.0'}); return 1`);
  await B.waitFor('__penna.Sync.status.state==="idle" && document.querySelectorAll(".card").length>0', 20000, 'B scarica');
  await sleep(500);
  const dB = await P(B);
  ok('Sync B (secondo dispositivo): scarica quaderni, pagine e allegati', dB.nodes.length === dA.nodes.length && dB.pages.length === dA.pages.length && dB.blobs.length === dA.blobs.length, `B nodi=${dB.nodes.length} pagine=${dB.pages.length} blob=${dB.blobs.length}`);
  const sumStrokes = (d) => d.pages.reduce((a, p) => a + p.strokes, 0);
  ok('B ha gli stessi tratti/testi/immagini di A', sumStrokes(dB) === sumStrokes(dA) && dB.pages.reduce((a, p) => a + p.blocks, 0) === dA.pages.reduce((a, p) => a + p.blocks, 0) && dB.pages.reduce((a, p) => a + p.images, 0) === dA.pages.reduce((a, p) => a + p.images, 0));
  // B apre il PDF sincronizzato e lo renderizza
  await B.eval('const n=(await __penna.D.all("nodes")).find(n=>n.name==="test3"); await __penna.openNotebook(n.id); return 1');
  await B.waitFor('document.querySelector(".page[data-rendered]")', 15000);
  await sleep(500);
  ok('B: PDF scaricato da OneDrive si apre e si vede', await B.eval(`const c=document.querySelector(".page canvas.bg"); const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=4) if(d[i]<100&&d[i+1]<100) n++; return n>200`));
  await B.eval('document.getElementById("btn-back").click(); return 1');

  // ---------- 4. Conflitto: vince l'ultima modifica ----------
  const target = (await P(A)).pages.find((p) => p.type === 'lined' || p.type === 'blank' || p.type === 'grid');
  const addStroke = (pg, tag) => pg.eval(`const p=await __penna.D.get("pages", ${JSON.stringify(target.id)}); p.strokes.push({t:"pen",c:"${tag}",w:0.002,pts:[[0.1,0.1,1],[0.2,0.2,1]]}); await __penna.D.savePage(p); return p.strokes.length`);
  // A modifica per prima (e sincronizza), poi B modifica DOPO senza aver sincronizzato → B (più recente) deve vincere
  const nA = await addStroke(A, '#aa0000'); await A.eval('await __penna.Sync.syncNow(); return 1'); await A.waitFor('__penna.Sync.status.state==="idle"');
  await sleep(50);
  const nB = await addStroke(B, '#0000bb');
  await B.eval('await __penna.Sync.syncNow(); return 1'); await B.waitFor('__penna.Sync.status.state==="idle"');
  const bRec = await B.eval(`const p=await __penna.D.get("pages", ${JSON.stringify(target.id)}); return {n:p.strokes.length, last:p.strokes[p.strokes.length-1].c, dirty:p.dirty}`);
  ok('Conflitto (B più recente): B mantiene la sua versione e la carica', bRec.last === '#0000bb' && !bRec.dirty, JSON.stringify(bRec));
  await A.eval('await __penna.Sync.syncNow(); return 1'); await A.waitFor('__penna.Sync.status.state==="idle"');
  const aRec = await A.eval(`const p=await __penna.D.get("pages", ${JSON.stringify(target.id)}); return {n:p.strokes.length, last:p.strokes[p.strokes.length-1].c, dirty:p.dirty}`);
  ok('Conflitto: A scarica la versione più recente di B', aRec.last === '#0000bb' && aRec.n === bRec.n && !aRec.dirty, JSON.stringify(aRec));
  // caso inverso: A modifica ora (più recente), B aveva modificato prima ma non ha sincronizzato
  await sleep(20);
  const bOld = await addStroke(B, '#111111');  // B modifica per prima, offline
  await sleep(50);
  await addStroke(A, '#222222');               // A modifica dopo e sincronizza
  await A.eval('await __penna.Sync.syncNow(); return 1'); await A.waitFor('__penna.Sync.status.state==="idle"');
  await B.eval('await __penna.Sync.syncNow(); return 1'); await B.waitFor('__penna.Sync.status.state==="idle"');
  const bRec2 = await B.eval(`const p=await __penna.D.get("pages", ${JSON.stringify(target.id)}); return {last:p.strokes[p.strokes.length-1].c, has111:p.strokes.some(s=>s.c==="#111111"), dirty:p.dirty}`);
  ok('Conflitto inverso (A più recente): B si adegua alla versione di A', bRec2.last === '#222222' && !bRec2.dirty && !bRec2.has111, JSON.stringify(bRec2));

  // ---------- 5. Offline → online ----------
  await A.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await A.eval('window.dispatchEvent(new Event("offline")); return 1');
  await addStroke(A, '#33aa33'); 
  await A.eval('await __penna.Sync.syncNow(); return 1'); await sleep(300);
  ok('Offline: stato "offline" e la modifica resta in locale', (await state(A)) === 'offline' && await A.eval('return /Offline/.test(document.getElementById("sync-text").textContent)'));
  const pendingLocal = await A.eval(`return (await __penna.D.get("pages", ${JSON.stringify(target.id)})).dirty`);
  ok('Offline: pagina marcata da sincronizzare', pendingLocal === 1);
  await A.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await A.eval('window.dispatchEvent(new Event("online")); return 1');
  await A.waitFor(`__penna.Sync.status.state==="idle"`, 15000);
  await sleep(300);
  const afterOnline = await A.eval(`return (await __penna.D.get("pages", ${JSON.stringify(target.id)})).dirty`);
  await B.eval('await __penna.Sync.syncNow(); return 1'); await B.waitFor('__penna.Sync.status.state==="idle"');
  const bRec3 = await B.eval(`const p=await __penna.D.get("pages", ${JSON.stringify(target.id)}); return p.strokes[p.strokes.length-1].c`);
  ok('Online di nuovo: sync automatico, B riceve la modifica fatta offline', !afterOnline && bRec3 === '#33aa33', 'B ultimo tratto=' + bRec3);

  // ---------- 6. Eliminazione propagata ----------
  const delId = (await P(A)).nodes.find((n) => n.name === 'test3').id;
  await A.eval(`const n=await __penna.D.get("nodes", ${JSON.stringify(delId)}); await __penna.D.deleteNode(n); await __penna.Sync.syncNow(); return 1`);
  await A.waitFor('__penna.Sync.status.state==="idle"');
  await B.eval('await __penna.Sync.syncNow(); return 1'); await B.waitFor('__penna.Sync.status.state==="idle"'); await sleep(200);
  ok('Eliminazione quaderno propagata a B', !(await P(B)).nodes.some((n) => n.name === 'test3') && !(await P(B)).pages.some((p) => p.nb === delId));

  // ---------- 7. Upload grande a pezzi ----------
  await A.setFiles('#pdf-input', [OUT + '/big.pdf']);
  await A.waitFor('!document.getElementById("notebook").hidden', 15000);
  await sleep(500); await click(A, '#btn-back');
  await A.eval('await __penna.Sync.syncNow(); return 1'); await A.waitFor('__penna.Sync.status.state==="idle"', 20000);
  st = await (await fetch('http://localhost:9000/__stats')).json();
  ok('Allegato grande (>4MB) caricato con sessione a pezzi', st.sessions >= 1, 'sessioni=' + st.sessions);
  await B.eval('await __penna.Sync.syncNow(); return 1'); await B.waitFor('__penna.Sync.status.state==="idle"', 20000);
  const bigA = (await P(A)).blobs.find((b) => b.len > 4e6), bigB = (await P(B)).blobs.find((b) => b.len > 4e6);
  ok('Allegato grande scaricato da B identico', bigA && bigB && bigA.len === bigB.len, bigA && bigB ? bigA.len + ' = ' + bigB.len : 'mancante');

  // ---------- 8. Errore token ----------
  // ---------- 9. Screenshot ----------
  await A.eval('document.getElementById("btn-back")?.click(); return 1');
  await A.eval('const n=(await __penna.D.all("nodes")).find(n=>n.name==="Quaderno Rinominato"); await __penna.openNotebook(n.id); return 1');
  await A.waitFor('document.querySelector(".page[data-rendered]")'); await sleep(500);
  await click(A, '#tool-pen');
  await A.shot(OUT + '/shot-ipad-notebook-sidebar.png', 1024, 768);
  await click(A, '#btn-back');
  await A.shot(OUT + '/shot-ipad-library2.png', 1024, 768);
  // iPhone
  await A.shot(OUT + '/shot-iphone-library.png', 390, 844, true);
  await A.eval('const n=(await __penna.D.all("nodes")).find(n=>n.name==="Quaderno Rinominato"); await __penna.openNotebook(n.id); return 1');
  await A.waitFor('document.querySelector(".page[data-rendered]")'); await sleep(600);
  await A.shot(OUT + '/shot-iphone-notebook.png', 390, 844, true);
  await click(A, '#btn-pages'); await sleep(400);
  await A.shot(OUT + '/shot-iphone-pages.png', 390, 844, true);
  await click(A, '#btn-pages');
  await click(A, '#tool-text'); await sleep(200);
  await A.shot(OUT + '/shot-iphone-text.png', 390, 844, true);
  ok('Nessun errore JS in console (A)', !A.logs.some((l) => l.startsWith('EXC') || l.startsWith('error')), A.logs.filter((l) => l.startsWith('EXC') || l.startsWith('error')).slice(0, 3).join(' | '));
  ok('Nessun errore JS in console (B)', !B.logs.some((l) => l.startsWith('EXC') || l.startsWith('error')), B.logs.filter((l) => l.startsWith('EXC') || l.startsWith('error')).slice(0, 3).join(' | '));
} catch (e) {
  console.log('ECCEZIONE', e.stack); results.push(['FAIL', 'eccezione', e.message]);
  console.log('LOG A', A.logs.slice(-8)); console.log('LOG B', B.logs.slice(-8));
  try { await A.shot(OUT + '/fail-A.png', 1024, 768); } catch {}
}
A.close(); B.close(); mock.srv.close();
console.log('\nRISULTATO:', results.filter((r) => r[0] === 'OK ').length + '/' + results.length, 'ok');
process.exit(0);
