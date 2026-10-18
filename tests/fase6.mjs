// Test della fase 6: strumento Seleziona sul testo del PDF. Livello di testo allineato alle lettere (PDF vero con font
// incorporati e accenti), menu Copia · Evidenzia · Commenta · Copia con commento, appunti (anche col vecchio metodo),
// pannello Commenti, Markdown per Claude Code (copia e .md), annulla/ripeti, riavvio, export PDF, OneDrive finto,
// PDF scansionato, libro da 300 pagine (livello di testo solo per le pagine visibili), iPhone, tema scuro.
// Browser "da iPad": API moderne tolte + polyfill, user agent Safari, tocchi veri.
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase6.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, touch, tapXY, tap, reachable, pen, small } from './touch.mjs';
import { ALIGN_FN } from './align.mjs';
import { startMock } from './mock.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
const SHOTS = OUT + '/shots6'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };

// ---------- PDF di prova ----------
// 1) PDF "vero": stampato da Chrome con Georgia e Helvetica Neue incorporati, testo giustificato, accenti, legature, corsivo
const REAL_HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 13pt; line-height: 1.5; color: #111; }
h1 { font-family: "Helvetica Neue", Helvetica, sans-serif; font-size: 22pt; margin: 0 0 10pt; } p { margin: 0 0 9pt; text-align: justify; }
.s { font-family: "Helvetica Neue", Helvetica, sans-serif; font-size: 11pt; } .big { font-size: 17pt; }
</style><h1>Capitolo primo — Della libertà</h1>
<p>La libertà è il dono più grande: perché la città possa crescere, serve virtù e pazienza. Così diceva il saggio, già ottantenne, all'università.</p>
<p class="s">Questo paragrafo è scritto con un carattere senza grazie, più piccolo: qualità, verità, perché, poiché, né, sé, è.</p>
<p class="big">Un titolo grande con l'àncora e l'isola d'Elba.</p>
<p><i>Corsivo:</i> efficienza, affinità, fiducia e flessibilità nella città di Forlì.</p>
${Array.from({ length: 14 }, (_, i) => `<p>Riga ${i + 1}: il contratto prevede che la parte acquirente versi il prezzo entro trenta giorni dalla consegna della merce.</p>`).join('')}
<p style="page-break-before: always">Seconda pagina: la carità e l'umiltà sono virtù cardinali? No, teologali.</p>
</html>`;
// 2) libro da 300 pagine (come la fase 5)
async function makeBook(path, N) {
  const doc = await PDFLib.PDFDocument.create();
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica), fb = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  for (let i = 1; i <= N; i++) {
    const pg = doc.addPage([595, 842]);
    pg.drawText('Pagina ' + i, { x: 60, y: 760, size: 34, font: fb });
    for (let r = 0; r < 18; r++) pg.drawText('Riga ' + (r + 1) + ' del testo di prova, pagina ' + i + ', con parole comuni per riempire.', { x: 60, y: 700 - r * 26, size: 13, font: f });
    if (i === 150) pg.drawText('Clausola rescissoria: il contratto si scioglie se.', { x: 60, y: 200, size: 16, font: fb });
  }
  fs.writeFileSync(path, await doc.save());
}

process.env.UA = 'ipad';
const P = await browser(9371, 'strip');
const toastTxt = () => P.eval(`return document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent`);
const dlgOpt = (label) => P.eval(`const b=[...document.querySelectorAll('#dlg-options button, #dlg-options label')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
async function tapOpt(label) { const c = await dlgOpt(label); if (!c) throw new Error('opzione mancante: ' + label); await tapXY(P, c.x, c.y); }
const menuOpen = () => P.eval(`return !document.getElementById('selmenu').hidden`);
// seleziona una frase nel livello di testo (come farebbero le maniglie): '\n' = a capo tra due righe
const SEL_FN = `window.__sel = function (pi, phrase, nth = 0) {
  const p = __penna.nb.pages[pi], tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => n.nodeType === 3 || n.nodeName === 'BR' ? 1 : 3 });
  const parts = []; let all = '';
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const t = n.nodeType === 3 ? n.data : '\\n'; parts.push([n, all.length, t.length]); all += t; }
  let i = -1; for (let k = 0; k <= nth; k++) { i = all.indexOf(phrase, i + 1); if (i < 0) return false; }
  const j = i + phrase.length;
  const a = parts.find(([n, s, l]) => n.nodeType === 3 && i >= s && i < s + l), b = parts.find(([n, s, l]) => n.nodeType === 3 && j > s && j <= s + l);
  const r = document.createRange(); r.setStart(a[0], i - a[1]); r.setEnd(b[0], j - b[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; };`;
async function select(pi, phrase, nth = 0) {
  if (!(await P.eval(`return __sel(${pi}, ${JSON.stringify(phrase)}, ${nth})`))) throw new Error('frase non trovata: ' + phrase);
  await P.waitFor(`!document.getElementById('selmenu').hidden && document.getElementById('selmenu').style.visibility!=='hidden'`, 3000, 'menu selezione');
  await sleep(120);
}
async function tapMenu(act) { await tap(P, `#selmenu button[data-act="${act}"]`); await sleep(250); }
// appunti: quelli veri del sistema (permesso concesso a Chrome) e, come riserva, l'ultima scrittura vista
let sysReads = 0, spyReads = 0;
async function readClip() {
  try { const t = await P.eval('return await navigator.clipboard.readText()'); if (typeof t === 'string') { sysReads++; return t; } } catch {}
  spyReads++;
  return P.eval('return window.__clip');
}
const mock = await startMock(9010);

try {
  // PDF di prova
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/reale.html', REAL_HTML); return OUT + '/reale.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/reale.pdf', Buffer.from(pr.data, 'base64'));
  await makeBook(OUT + '/libro300.pdf', 300);

  let clipOk = true;
  try { await P.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch { clipOk = false; }
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{ const c=navigator.clipboard; if(c&&c.writeText){ const o=c.writeText.bind(c); c.writeText=(t)=>{ window.__clip=t; return o(t); }; }
    document.addEventListener('copy',(e)=>{ const t=e.target; window.__copyEv=(t&&t.tagName==='TEXTAREA')? t.value.slice(t.selectionStart,t.selectionEnd) : (e.clipboardData&&e.clipboardData.getData('text/plain'))||''; }, true); });` });
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(SEL_FN + ALIGN_FN + '; return 1');
  ok('Safari vecchio emulato (API moderne tolte, polyfill attivi) · versione ' + await P.eval('return __penna.version'), await P.eval('return window.__stripped===true && +__penna.version.slice(1) >= 7'));

  // scansione: una pagina che è solo una foto di testo (preparata nel browser)
  const png = await P.eval(`const c=document.createElement('canvas'); c.width=1240; c.height=1754; const x=c.getContext('2d'); x.fillStyle='#f4f1ea'; x.fillRect(0,0,c.width,c.height); x.fillStyle='#222'; x.font='48px Georgia'; for(let i=0;i<20;i++) x.fillText('Testo fotografato, riga '+(i+1)+': non si può selezionare.', 110, 200+i*70); return c.toDataURL('image/png').split(',')[1]`);
  const sdoc = await PDFLib.PDFDocument.create(); const simg = await sdoc.embedPng(Buffer.from(png, 'base64'));
  sdoc.addPage([595, 842]).drawImage(simg, { x: 0, y: 0, width: 595, height: 842 });
  fs.writeFileSync(OUT + '/scansione.pdf', await sdoc.save());

  // ======================= PDF vero: strumento Seleziona =======================
  await P.setFiles('#pdf-input', [OUT + '/reale.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF vero aperto');
  ok('PDF vero (Georgia + Helvetica incorporati) aperto', await P.eval(`return __penna.nb.pages.length>=2 && document.getElementById('errbox').hidden`));
  ok('nessun livello di testo finché non si sceglie Seleziona (penna: zero lavoro in più)', (await P.eval('return __penna.stats().textLayers')) === 0);
  ok('pulsante Seleziona nella barra, raggiungibile e >= 44px', await reachable(P, '#tool-select') && (await small(P)).length === 0, JSON.stringify(await small(P)));
  ok('iPad orizzontale: strumenti ancora esattamente al centro', await P.eval(`const r=document.querySelector('.pillbar.mid').getBoundingClientRect(); return Math.abs(r.x+r.width/2-512)<3`));
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  await sleep(300);
  ok('tocco Seleziona → strumento attivo (terracotta), livello di testo pronto', await P.eval(`return __penna.S.tool==='select' && document.getElementById('tool-select').classList.contains('active') && document.getElementById('notebook').classList.contains('mode-select')`));
  ok('testo del PDF nel livello di testo (con accenti)', await P.eval(`const t=__penna.nb.pages[0].tl.div.textContent; return t.includes('libertà') && t.includes('perché') && t.includes('Forlì.')`));
  ok('livello di testo: lettere trasparenti, selezionabili (user-select: text)', await P.eval(`const s=__penna.nb.pages[0].tl.div.querySelector('span.w')||__penna.nb.pages[0].tl.div.querySelector('span[role=presentation]'); const cs=getComputedStyle(s); return cs.color==='rgba(0, 0, 0, 0)' && (cs.userSelect==='text'||cs.webkitUserSelect==='text')`));
  ok('con Seleziona: il canvas dei tratti non riceve tocchi, il testo sì', await P.eval(`const p=__penna.nb.pages[0]; return getComputedStyle(p.draw).pointerEvents==='none' && getComputedStyle(p.tl.div).pointerEvents==='auto'`));
  const wordAt = await P.eval(`const n=[...__penna.nb.pages[0].tl.div.querySelectorAll('span.w')].find(s=>s.textContent==='libertà'); const r=n.getBoundingClientRect(); const h=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return h===n || n.contains(h)`);
  ok('il dito sulla parola tocca il testo (non il disegno)', wordAt);
  const pd = await P.eval(`const s=[...__penna.nb.pages[0].tl.div.querySelectorAll('span.w')][3]; const out={}; for (const t of ['pointerdown','mousedown','touchstart']) { let ev; try { ev = t==='touchstart' ? new TouchEvent(t,{bubbles:true,cancelable:true}) : new (t==='pointerdown'?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true,pointerType:'touch'}); } catch(e) { ev=new Event(t,{bubbles:true,cancelable:true}); } s.dispatchEvent(ev); out[t]=ev.defaultPrevented; } return out`);
  ok('nessun preventDefault sui tocchi del testo (maniglie native di iOS libere)', !pd.pointerdown && !pd.mousedown && !pd.touchstart, JSON.stringify(pd));
  // la penna non disegna con Seleziona
  const pg0 = await rect(P, '.page');
  await pen(P, Array.from({ length: 20 }, (_, i) => [pg0.x + 200 + i * 12, pg0.y + 380]));
  ok('con Seleziona la Pencil non disegna', (await P.eval('return __penna.nb.pages[0].rec.strokes.length')) === 0);
  await P.eval('getSelection().removeAllRanges(); return 1'); await sleep(250);

  // ======================= allineamento testo trasparente / lettere stampate =======================
  const tokens = await P.eval(`const out=[], cnt={}; const tw=document.createTreeWalker(__penna.nb.pages[0].tl.div, NodeFilter.SHOW_TEXT); for(let n=tw.nextNode();n;n=tw.nextNode()) for(const w of n.data.split(' ')) { if(w.length<3 || /['’]/.test(w)) continue; out.push([w, cnt[w]=(cnt[w]??-1)+1]); } return out`);
  const al = (await P.eval(`return __align(0, ${JSON.stringify(tokens)})`)).filter((r) => !r.missing && !r.noink);
  const errs = al.flatMap((r) => [Math.abs(r.dl), Math.abs(r.dr)]).sort((a, b) => a - b), q = (f) => errs[Math.floor((errs.length - 1) * f)];
  const fitted = await P.eval('return [__penna.nb.pages[0].tl.fitted, __penna.nb.pages[0].tl.lineCount]');
  ok(`allineamento su ${al.length} parole (accenti, corsivo, giustificato): mediana ${q(0.5)} px, 90% entro ${q(0.9)} px, max ${errs[errs.length - 1]} px`, al.length > 150 && q(0.5) <= 0.6 && q(0.9) <= 1.5 && errs[errs.length - 1] <= 4,
    JSON.stringify(al.filter((r) => Math.abs(r.dl) > 2 || Math.abs(r.dr) > 2)));
  ok(`righe posate sull'inchiostro: ${fitted[0]} di ${fitted[1]}`, fitted[0] === fitted[1] && fitted[1] >= 25, fitted.join('/'));
  // stesso confronto col solo pdf.js (per sapere quanto abbiamo guadagnato)
  await P.eval(`window.__noFit=true; __penna.setTool('pen'); for (const p of __penna.nb.pages) { if (p.tl) { p.tl.layer && p.tl.layer.cancel(); p.tl.div && p.tl.div.remove(); __penna.tlPages.delete(p); p.tl=null; } } __penna.setTool('select'); return 1`);
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello pdf.js puro');
  const al0 = (await P.eval(`return __align(0, ${JSON.stringify(tokens)})`)).filter((r) => !r.missing && !r.noink);
  const e0 = al0.flatMap((r) => [Math.abs(r.dl), Math.abs(r.dr)]).sort((a, b) => a - b);
  ok(`(confronto) pdf.js da solo: mediana ${e0[Math.floor((e0.length - 1) * 0.5)]} px, 90% entro ${e0[Math.floor((e0.length - 1) * 0.9)]} px, max ${e0[e0.length - 1]} px → la correzione serve`, e0[Math.floor((e0.length - 1) * 0.9)] > q(0.9));
  console.log(`     (solo pdf.js: mediana ${e0[Math.floor((e0.length - 1) * 0.5)]} px, 90% entro ${e0[Math.floor((e0.length - 1) * 0.9)]} px, max ${e0[e0.length - 1]} px)`);
  await P.eval(`window.__noFit=false; __penna.setTool('pen'); for (const p of __penna.nb.pages) { if (p.tl) { p.tl.layer && p.tl.layer.cancel(); p.tl.div && p.tl.div.remove(); __penna.tlPages.delete(p); p.tl=null; } } __penna.setTool('select'); return 1`);
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end && __penna.nb.pages[0].tl.fitted>=25`, 10000, 'livello allineato');
  // con lo zoom il livello segue la pagina (stesso allineamento)
  await P.eval(`__penna.nb.zoom=1.5; window.dispatchEvent(new Event('resize')); return 1`);
  await P.waitFor(`__penna.nb.pages[0].wrap.dataset.rendered==='1' && Math.abs(__penna.nb.pages[0].tl.scale*595.28/__penna.nb.pages[0].cw-1)<0.02 && __penna.nb.pages[0].cw>1400`, 10000, 'zoom');
  await sleep(500);
  const alz = (await P.eval(`return __align(0, ${JSON.stringify(tokens.slice(0, 60))})`)).filter((r) => !r.missing && !r.noink);
  const ez = alz.flatMap((r) => [Math.abs(r.dl), Math.abs(r.dr)]).sort((a, b) => a - b);
  ok(`zoom 150%: testo ancora sulle lettere (90% entro ${ez[Math.floor((ez.length - 1) * 0.9)]} px)`, ez[Math.floor((ez.length - 1) * 0.9)] <= 2.2, JSON.stringify(alz.filter((r) => Math.abs(r.dl) > 2 || Math.abs(r.dr) > 2)));
  await P.eval(`__penna.nb.zoom=1; window.dispatchEvent(new Event('resize')); return 1`);
  await P.waitFor(`__penna.nb.pages[0].wrap.dataset.rendered==='1' && __penna.nb.pages[0].cw<1000`, 10000, 'zoom 100');
  await P.eval('__penna.goToPage(0); return 1'); await sleep(500);

  // ======================= selezione → menu =======================
  await select(0, 'serve virtù e\npazienza.');
  const mr = await rect(P, '#selmenu'), sr = await P.eval(`const r=getSelection().getRangeAt(0).getClientRects(); const a=[...r].filter(x=>x.width>0); return {top:Math.min(...a.map(x=>x.top)), bottom:Math.max(...a.map(x=>x.bottom))}`);
  ok('selezione → menu a pillola vicino al testo (sotto o sopra), dentro lo schermo', mr.x >= 0 && mr.x + mr.w <= 1024 && mr.y > 60 && mr.y + mr.h < 768 && (Math.abs(mr.y - sr.bottom) < 40 || Math.abs(mr.y + mr.h - sr.top) < 40), JSON.stringify({ mr, sr }));
  ok('menu: Copia · Evidenzia · Commenta · Copia con commento', await P.eval(`return [...document.querySelectorAll('#selmenu button')].map(b=>b.textContent.trim()).join('|').startsWith('Copia|Evidenzia|Commenta|Copia con commentoCopia + nota')`),
    await P.eval(`return [...document.querySelectorAll('#selmenu button')].map(b=>b.innerText.trim()).join('|')`));
  ok('menu: pulsanti >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-selezione-menu');
  await tapMenu('copy');
  const c1 = await readClip();
  ok('Copia → negli appunti il testo giusto ("serve virtù e pazienza.", a capo tolto)', c1 === 'serve virtù e pazienza.', JSON.stringify(c1) + (clipOk ? '' : ' (appunti veri non leggibili)'));
  ok('dopo Copia: conferma, menu chiuso, selezione tolta', /Copiato/.test(await toastTxt()) && !(await menuOpen()) && await P.eval('return getSelection().isCollapsed'));
  // vecchio metodo (iPad senza navigator.clipboard)
  await P.eval(`window.__savedClip=navigator.clipboard; Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true}); window.__copyEv=null; return 1`);
  await select(0, 'nella città di Forlì.');
  await tapMenu('copy');
  const ev = await P.eval('return window.__copyEv');
  const c2 = clipOk ? await P.eval(`Object.defineProperty(navigator,'clipboard',{value:window.__savedClip,configurable:true}); return await navigator.clipboard.readText()`) : ev;
  await P.eval(`Object.defineProperty(navigator,'clipboard',{value:window.__savedClip,configurable:true}); return 1`);
  ok('Copia col vecchio metodo (execCommand, senza navigator.clipboard)', ev === 'nella città di Forlì.' && c2 === 'nella città di Forlì.', JSON.stringify({ ev, c2 }));

  // ======================= Evidenzia =======================
  await select(0, 'La libertà è il dono più grande');
  await tapMenu('hl');
  const a1 = await P.eval(`const a=__penna.nb.pages[0].rec.anns; return a && a.length===1 ? {q:a[0].q, c:a[0].c, n:a[0].n, r:a[0].r.length, col:__penna.S.hl.color} : null`);
  ok('Evidenzia → evidenziazione col colore corrente, un riquadro per la riga', a1 && a1.q === 'La libertà è il dono più grande' && a1.c === a1.col && a1.r === 1 && !a1.n, JSON.stringify(a1));
  const hlGeo = await P.eval(`const p=__penna.nb.pages[0], W=p.wrap.getBoundingClientRect(), r=p.anns.querySelector('.ann-r').getBoundingClientRect();
    const words=[...p.tl.div.querySelectorAll('span.w')]; const a=words.find(s=>s.textContent==='La').getBoundingClientRect(), b=words.find(s=>s.textContent==='grande:').getBoundingClientRect();
    return {l:r.left-a.left, rr:r.right-(b.right - b.width/7), top:r.top-a.top, h:r.height/a.height}`);
  ok('evidenziazione proprio sulle parole (bordi sull\'inchiostro, ±3 px)', Math.abs(hlGeo.l) < 4 && Math.abs(hlGeo.rr) < 6 && Math.abs(hlGeo.top) < 3 && hlGeo.h > 0.8 && hlGeo.h < 1.25, JSON.stringify(hlGeo));
  ok('evidenziazione visibile in pagina e Annulla attivo', await P.eval(`return document.querySelectorAll('.page .ann-r').length===1 && !document.getElementById('btn-undo').disabled`));
  await shot(P, 'ipad-evidenziato');

  // ======================= Commenta =======================
  await select(0, 'la città possa crescere');
  await tapMenu('note');
  ok('Commenta → editor con la citazione e il campo pronto', await P.eval(`return document.getElementById('cdlg').open && /la città possa crescere/.test(document.getElementById('cdlg-quote').textContent) && document.activeElement===document.getElementById('cdlg-text') && document.getElementById('cdlg-ok').textContent==='Salva'`));
  await P.type('Verificare con l’avvocato: è davvero così?');
  await shot(P, 'ipad-commento-editor');
  await tap(P, '#cdlg-ok'); await sleep(300);
  const a2 = await P.eval(`return __penna.nb.pages[0].rec.anns.map(a=>a.q+'|'+(a.n||''))`);
  ok('commento salvato e agganciato alla frase', a2.includes('la città possa crescere|Verificare con l’avvocato: è davvero così?'), JSON.stringify(a2));
  ok('icona del commento sulla pagina (nel margine), raggiungibile', await P.eval(`return document.querySelectorAll('.page .ann-pin').length===1`) && await reachable(P, '.ann-pin'));

  // ======================= Copia con commento =======================
  await select(0, 'Riga 3: il contratto prevede');
  await tapMenu('copynote');
  ok('Copia con commento → editor con "Salva e copia"', await P.eval(`return document.getElementById('cdlg').open && document.getElementById('cdlg-ok').textContent==='Salva e copia'`));
  await P.type('Controllare il termine di 30 giorni');
  await tap(P, '#cdlg-ok'); await sleep(300);
  const c3 = await readClip();
  ok('negli appunti: Markdown per Claude Code (titolo, pagina, citazione, commento)', c3 === '# reale\n\n## Pagina 1\n> "Riga 3: il contratto prevede"\n\n**Commento:** Controllare il termine di 30 giorni\n', JSON.stringify(c3));
  ok('…e il commento resta salvato sulla pagina', await P.eval(`return __penna.nb.pages[0].rec.anns.length===3`));

  // ======================= Pannello Commenti =======================
  await tap(P, '#btn-notes'); await sleep(450);
  ok('tocco Commenti → barra laterale sulla scheda Commenti', await P.eval(`return document.getElementById('notebook').classList.contains('side-open') && !document.getElementById('tab-anns').hidden`));
  const list = await P.eval(`return [...document.querySelectorAll('#ann-list .ann-row')].map(b=>b.querySelector('b').textContent+' '+b.querySelector('.q').textContent+' '+(b.querySelector('.nt')?b.querySelector('.nt').textContent:''))`);
  ok('elenco in ordine di lettura con pagina, citazione e commento', list.length === 3 && /^Pagina 1 «La libertà/.test(list[0]) && /«la città possa crescere» Verificare/.test(list[1]) && /«Riga 3: il contratto prevede» Controllare/.test(list[2]), JSON.stringify(list));
  ok('riepilogo: "2 commenti · 1 evidenziazione"; badge 3 sul pulsante', (await P.eval(`return document.getElementById('ann-count').textContent`)) === '2 commenti · 1 evidenziazione' && (await P.eval(`return document.getElementById('btn-notes').dataset.n`)) === '3');
  ok('schede della barra (4) leggibili, senza testo tagliato', await P.eval(`return [...document.querySelectorAll('#sidebar .seg button')].every(b=>b.scrollWidth<=b.clientWidth+1)`), await P.eval(`return [...document.querySelectorAll('#sidebar .seg button')].map(b=>b.textContent+':'+b.scrollWidth+'/'+b.clientWidth).join(' ')`));
  ok('pannello: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-pannello-commenti');
  // Copia tutto in Markdown
  await tap(P, '#btn-md-copy'); await sleep(250);
  const md = await readClip();
  const mdExp = await P.eval('return __penna.allMarkdown()');
  ok('Copia tutto in Markdown → appunti', md === mdExp && /Copiate 3 voci/.test(await toastTxt()), JSON.stringify(md));
  ok('formato Markdown: titolo, una sezione per pagina, citazioni e commenti', /^# reale\n\n_Evidenziazioni e commenti da PDF Penna · .+ · 3 voci_\n\n## Pagina 1\n> "La libertà è il dono più grande"\n\n> "la città possa crescere"\n\n\*\*Commento:\*\* Verificare con l’avvocato: è davvero così\?\n\n> "Riga 3: il contratto prevede"\n\n\*\*Commento:\*\* Controllare il termine di 30 giorni\n$/.test(md), md);
  // Condividi .md
  await P.eval(`window.__shared=null; navigator.canShare=()=>true; navigator.share=async(d)=>{ const f=d.files[0]; window.__shared={name:f.name,type:f.type,text:await f.text()}; }; return 1`);
  await tap(P, '#btn-md-share'); await sleep(300);
  const shd = await P.eval('return window.__shared');
  ok('Condividi .md → file "reale - commenti.md" (text/markdown) con lo stesso testo', shd && shd.name === 'reale - commenti.md' && shd.type === 'text/markdown' && shd.text === mdExp, JSON.stringify(shd && { name: shd.name, type: shd.type }));
  // tocco su una voce → pagina e lampeggio
  await P.eval(`document.getElementById('viewer').scrollTop=1500; return 1`); await sleep(200);
  await tap(P, '#ann-list li:nth-child(2) .ann-row'); await sleep(400);
  ok('tocco su una voce → torna al testo commentato (in vista, lampeggia)', await P.eval(`const r=[...document.querySelectorAll('.ann-r')].find(x=>x.classList.contains('flash')); if(!r) return false; const b=r.getBoundingClientRect(); return b.top>60 && b.bottom<innerHeight-80`));
  // modifica dal menu ⋯
  await tap(P, '#ann-list li:nth-child(2) .mini'); await sleep(300);
  ok('⋯ → menu: Modifica / Copia per Claude Code / Elimina', await P.eval(`return [...document.querySelectorAll('#dlg-options .opt')].map(b=>b.textContent.trim()).join('|')==='Modifica il commento|Copia per Claude Code|Elimina commento ed evidenziazione'`));
  await shot(P, 'ipad-menu-commento');
  await tapOpt('Modifica il commento'); await sleep(300);
  ok('modifica: editor con il commento di prima', await P.eval(`return document.getElementById('cdlg').open && document.getElementById('cdlg-text').value==='Verificare con l’avvocato: è davvero così?'`));
  await P.eval(`const t=document.getElementById('cdlg-text'); t.select(); return 1`);
  await P.type('Chiedere parere entro venerdì');
  await tap(P, '#cdlg-ok'); await sleep(300);
  ok('commento modificato (pannello aggiornato)', await P.eval(`return [...document.querySelectorAll('#ann-list .nt')].some(n=>n.textContent==='Chiedere parere entro venerdì')`));
  // elimina + annulla/ripeti
  await tap(P, '#ann-list li:nth-child(1) .mini'); await sleep(300);
  await tapOpt('Togli l’evidenziazione'); await sleep(300);
  ok('Togli l’evidenziazione → sparita', await P.eval(`return __penna.nb.pages[0].rec.anns.length===2 && document.querySelectorAll('#ann-list .ann-row').length===2`));
  await tap(P, '#btn-undo'); await sleep(250);
  ok('Annulla → torna', await P.eval(`return __penna.nb.pages[0].rec.anns.length===3 && document.querySelectorAll('.page .ann-r').length>=3`));
  await tap(P, '#btn-redo'); await sleep(250);
  ok('Ripeti → di nuovo tolta', await P.eval(`return __penna.nb.pages[0].rec.anns.length===2`));
  await tap(P, '#btn-undo'); await sleep(250);
  await tap(P, '#btn-undo'); await sleep(250);
  ok('Annulla anche la modifica del commento (torna il testo di prima)', await P.eval(`return __penna.nb.pages[0].rec.anns.some(a=>a.n==='Verificare con l’avvocato: è davvero così?')`));
  await tap(P, '#btn-redo'); await sleep(250);
  ok('Ripeti la modifica', await P.eval(`return __penna.nb.pages[0].rec.anns.some(a=>a.n==='Chiedere parere entro venerdì') && __penna.nb.pages[0].rec.anns.length===3`));
  await tap(P, '#btn-pages'); await sleep(300);

  // tocco sul testo evidenziato (Seleziona) e sull'icona (anche con la penna)
  const hr = await P.eval(`const r=[...document.querySelectorAll('.ann-r')][0].getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}`);
  await P.eval(`getSelection().removeAllRanges(); return 1`);
  await tapXY(P, hr.x, hr.y); await sleep(300);
  ok('tocco su un testo evidenziato → si apre la sua scheda', await P.eval(`return document.getElementById('dlg').open && /Testo evidenziato · pagina 1/.test(document.getElementById('dlg-title').textContent)`), await P.eval(`return document.getElementById('dlg-title').textContent`));
  await tap(P, '#dlg-cancel'); await sleep(200);
  await tap(P, '#tool-pen'); await sleep(150);
  await tap(P, '.ann-pin'); await sleep(300);
  ok('con la penna: tocco sull\'icona del commento → si apre il commento', await P.eval(`return document.getElementById('dlg').open && /Commento · pagina 1/.test(document.getElementById('dlg-title').textContent) && /Chiedere parere/.test(document.getElementById('dlg-text').textContent)`));
  await tap(P, '#dlg-cancel'); await sleep(200);
  ok('cambiando strumento il livello di testo non riceve più tocchi', await P.eval(`return getComputedStyle(__penna.nb.pages[0].tl.div).pointerEvents==='none' && getComputedStyle(__penna.nb.pages[0].draw).pointerEvents!=='none'`));

  // ======================= riavvio: tutto resta =======================
  await tap(P, '#btn-save'); await sleep(500);
  await P.reload();
  await P.waitFor(`window.__penna && !document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'riavvio');
  await P.eval(SEL_FN + ALIGN_FN + '; return 1');
  ok('dopo il riavvio: evidenziazione e commenti ci sono ancora (pagina e pannello)', await P.eval(`const a=__penna.nb.pages[0].rec.anns; return a.length===3 && document.querySelectorAll('.page .ann-r').length>=3 && document.querySelectorAll('.page .ann-pin').length===2 && document.querySelectorAll('#ann-list .ann-row').length===3`));
  ok('dopo il riavvio: Markdown identico', (await P.eval('return __penna.allMarkdown()')) === mdExp.replace('Verificare con l’avvocato: è davvero così?', 'Chiedere parere entro venerdì'));

  // ======================= export PDF =======================
  const ex = await P.eval(`const b=await __penna.exportBytes(); const m=await __penna.pdfjs(); const task=m.getDocument({data:b.slice(0), standardFontDataUrl:'./lib/standard_fonts/'}); const d=await task.promise; const pg=await d.getPage(1);
    const ann=(await pg.getAnnotations()).filter(a=>a.subtype==='Text').map(a=>a.contentsObj&&a.contentsObj.str);
    const vp=pg.getViewport({scale:1}); const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height; await pg.render({canvas:c, canvasContext:c.getContext('2d'), viewport:vp}).promise;
    const a=__penna.nb.pages[0].rec.anns.find(x=>!x.n); const r=a.r[0]; const g=c.getContext('2d').getImageData(Math.round(r.l*vp.width), Math.round((r.t+r.h*0.1)*vp.height), Math.round(r.w*vp.width), Math.max(1,Math.round(r.h*0.8*vp.height))).data;
    let yellow=0, tot=0; for(let i=0;i<g.length;i+=4){ tot++; if(g[i]>200&&g[i+1]>170&&g[i+2]<170) yellow++; }
    const out={ann, yellow:yellow/tot, n:d.numPages, size:b.length}; await task.destroy(); return out`);
  ok('export PDF: testo evidenziato colorato nel punto giusto', ex.yellow > 0.35, JSON.stringify(ex));
  ok('export PDF: i 2 commenti come note PDF (si aprono in Anteprima/Acrobat)', ex.ann.length === 2 && ex.ann.includes('Chiedere parere entro venerdì') && ex.ann.includes('Controllare il termine di 30 giorni'), JSON.stringify(ex.ann));

  // ======================= ricerca =======================
  await P.eval(`document.getElementById('find-input').value=''; return 1`);
  await P.eval(`await __penna.runFind('parere'); return 1`);
  ok('Cerca nel quaderno trova anche il testo dei commenti', await P.eval(`return document.querySelectorAll('#find-list .fhit').length===1`));

  // ======================= OneDrive (finto) =======================
  // sul sito pubblicato (https) Chrome blocca le chiamate verso il OneDrive finto su localhost: la prova si fa in locale
  if (!/localhost|127\.0\.0\.1/.test(APP)) console.log('     (OneDrive finto saltato sul sito pubblicato: Chrome blocca le chiamate dal sito a localhost; provato in locale)');
  else {
  await P.eval(`__penna.Sync.useCustom({token:'fake', base:'http://localhost:9010/v1.0'}); return 1`);
  await P.waitFor(`__penna.Sync.status.state==='idle' && __penna.Sync.status.last>0`, 20000, 'sync');
  await sleep(1500);
  const remote = [...mock.files.entries()].filter(([n]) => n.startsWith('p-')).map(([, f]) => JSON.parse(f.buf.toString())).find((x) => (x.anns || []).length);
  ok('OneDrive: la pagina caricata contiene evidenziazioni e commenti', remote && remote.anns.length === 3 && remote.anns.some((a) => a.n === 'Chiedere parere entro venerdì'), remote ? remote.anns.length : 'nessuna');
  const B = await browser(9372);
  await B.goto(APP); await B.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await B.eval(`__penna.Sync.useCustom({token:'fake', base:'http://localhost:9010/v1.0'}); return 1`);
  await B.waitFor(`[...document.querySelectorAll('.card b')].some(b=>b.textContent==='reale')`, 30000, 'quaderno sull\'altro dispositivo');
  await B.eval(`const c=[...document.querySelectorAll('.card')].find(c=>c.querySelector('b').textContent==='reale'); c.querySelector('.cover').click(); return 1`);
  await B.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length>0`, 15000, 'apertura B');
  ok('altro dispositivo: commenti arrivati da OneDrive (pagina e Markdown)', await B.eval(`return document.querySelectorAll('.page .ann-pin').length===2 && __penna.allMarkdown().includes('Chiedere parere entro venerdì')`));
  B.close();
  }

  // ======================= libreria: ricerca nei commenti =======================
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);
  await P.eval(`const s=document.getElementById('search'); s.value='avvocato'; await __penna.runSearch(); s.value='parere'; await __penna.runSearch(); return 1`);
  ok('libreria: la ricerca trova i commenti', await P.eval(`return [...document.querySelectorAll('#results .hit')].some(h=>/parere/.test(h.textContent) && /commento/.test(h.textContent))`));
  await P.eval(`const s=document.getElementById('search'); s.value=''; await __penna.runSearch(); return 1`);

  // ======================= PDF scansionato =======================
  await P.setFiles('#pdf-input', [OUT + '/scansione.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.node.name==='scansione' && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'scansione aperta');
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello scansione');
  await sleep(300);
  ok('PDF scansionato → avviso chiaro sulla pagina', await P.eval(`const n=document.querySelector('.page .scan-note'); return !!n && n.offsetWidth>0 && n.textContent==='Questo PDF è una scansione: non contiene testo selezionabile'`));
  ok('…e un avviso a comparsa', (await toastTxt()) === 'Questo PDF è una scansione: non contiene testo selezionabile', await toastTxt());
  await shot(P, 'ipad-scansione');
  await tap(P, '#tool-pen'); await sleep(200);
  ok('con la penna l\'avviso sparisce', await P.eval(`return document.querySelector('.page .scan-note').offsetWidth===0`));
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);

  // ======================= libro da 300 pagine =======================
  await P.setFiles('#pdf-input', [OUT + '/libro300.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===300 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 60000, 'libro aperto');
  let t0 = Date.now();
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello pagina 1');
  const tFirst = Date.now() - t0;
  await sleep(500);
  let st = await P.eval('return __penna.stats()');
  ok(`300 pagine: livello di testo solo per le pagine vicine (${st.textLayers}), pronto in ${tFirst} ms`, st.textLayers >= 1 && st.textLayers <= 4 && tFirst < 2500, JSON.stringify(st));
  t0 = Date.now();
  await P.eval('__penna.goToPage(149); return 1');
  await P.waitFor(`__penna.nb.pages[149].tl && __penna.nb.pages[149].tl.end`, 15000, 'livello pagina 150');
  const t150 = Date.now() - t0;
  await sleep(600);
  st = await P.eval('return __penna.stats()');
  ok(`vai a pagina 150 → testo selezionabile in ${t150} ms; le pagine lontane non hanno livello (${st.textLayers})`, t150 < 3000 && st.textLayers <= 4 && await P.eval('return !__penna.nb.pages[0].tl && !__penna.nb.pages[299].tl'), JSON.stringify(st));
  await P.eval(`window.__long=[]; try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) __long.push(Math.round(e.duration))}).observe({entryTypes:['longtask']}); }catch(e){} return 1`);
  for (let k = 0; k < 40; k++) { await P.eval(`document.getElementById('viewer').scrollBy(0, 260); return 1`); await sleep(30); }
  await sleep(1500);
  st = await P.eval('return __penna.stats()');
  const longs = await P.eval('return window.__long');
  ok(`scorrendo con Seleziona attivo: livelli sempre pochi (${st.textLayers}), nessun blocco > 250 ms (Chrome)`, st.textLayers <= 4 && (!longs.length || Math.max(...longs) < 250), JSON.stringify({ st, longs }));
  await P.eval('__penna.goToPage(149, 0.45); return 1');
  await P.waitFor(`__penna.nb.pages[149].tl && __penna.nb.pages[149].tl.end`, 15000, 'di nuovo 150');
  await sleep(300);
  await select(149, 'Clausola rescissoria');
  await tapMenu('hl');
  ok('libro: evidenziato "Clausola rescissoria" a pagina 150', await P.eval(`const a=__penna.nb.pages[149].rec.anns; return a.length===1 && a[0].q==='Clausola rescissoria'`));
  const al150 = (await P.eval(`return __align(149, ['Clausola','rescissoria:','contratto','scioglie','Pagina','150'])`)).filter((r) => !r.missing && !r.noink);
  ok('libro (Helvetica): testo trasparente allineato (±2 px)', al150.length >= 5 && al150.every((r) => Math.abs(r.dl) <= 2 && Math.abs(r.dr) <= 2), JSON.stringify(al150));
  await shot(P, 'ipad-libro-150');

  // ======================= iPhone =======================
  await tap(P, '#btn-back'); await P.waitFor(`!document.getElementById('library').hidden`);
  await device(P, 390, 844, 3); await sleep(400);
  await P.eval(`const c=[...document.querySelectorAll('.card')].find(c=>c.querySelector('b').textContent==='reale'); c.querySelector('.cover').click(); return 1`);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.node.name==='reale' && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 15000, 'iPhone apertura');
  await P.eval('__penna.goToPage(0); return 1'); await sleep(300);
  const mid = await rect(P, '.pillbar.mid');
  ok('iPhone: barra strumenti (con Seleziona) dentro lo schermo', mid.x >= 0 && mid.x + mid.w <= 390 && mid.y + mid.h <= 844, JSON.stringify(mid));
  for (const sel of ['#tool-pen', '#tool-hl', '#tool-select', '#tool-text', '#btn-color', '#btn-undo', '#btn-redo']) ok('iPhone: ' + sel + ' raggiungibile', await reachable(P, sel));
  await tap(P, '#tool-pen'); await sleep(150);
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'iPhone livello');
  await sleep(300);
  await select(0, 'Corsivo: efficienza, affinità');
  const im = await rect(P, '#selmenu');
  ok('iPhone: con Seleziona nessun pannello aperto per sbaglio', await P.eval(`return document.getElementById('pop').hidden`));
  ok('iPhone: menu sulla selezione dentro lo schermo, sopra la barra strumenti', im.x >= 0 && im.x + im.w <= 390 && im.y > 60 && im.y + im.h <= mid.y, JSON.stringify(im));
  ok('iPhone: pulsanti del menu >= 44px e parole non tagliate', (await small(P)).length === 0 && await P.eval(`return [...document.querySelectorAll('#selmenu button')].every(b=>b.scrollWidth<=b.clientWidth+1)`), JSON.stringify(await small(P)));
  await shot(P, 'iphone-selezione-menu');
  await tapMenu('note');
  await P.type('Nota dall’iPhone');
  await shot(P, 'iphone-commento-editor');
  await tap(P, '#cdlg-ok'); await sleep(300);
  ok('iPhone: commento salvato', await P.eval(`return __penna.nb.pages[0].rec.anns.some(a=>a.n==='Nota dall’iPhone' && a.q==='Corsivo: efficienza, affinità')`));
  await tap(P, '#btn-pages'); await sleep(400);
  await tap(P, '#sidebar .seg button[data-tab="anns"]'); await sleep(250);
  ok('iPhone: scheda Commenti con 4 voci, comandi >= 44px', await P.eval(`return document.querySelectorAll('#ann-list .ann-row').length===4`) && (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'iphone-pannello-commenti');
  await tap(P, '#btn-pages'); await sleep(300);

  // ======================= tema scuro =======================
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await device(P, 1024, 768); await sleep(500);
  await P.eval('__penna.goToPage(0, 0.38); return 1'); await sleep(500);
  await select(0, 'Riga 5: il contratto prevede che la parte acquirente');
  await shot(P, 'dark-selezione-menu');
  await P.eval('getSelection().removeAllRanges(); return 1');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  ok('nessun errore a schermo', await P.eval('return document.getElementById("errbox").hidden'), await P.eval('return document.getElementById("err-msg").textContent'));
  const errs2 = P.logs.filter((l) => /^(EXC|error)/.test(l));
  ok('nessun errore JS in console', errs2.length === 0, errs2.slice(0, 3).join(' | '));
  ok(`appunti letti davvero dal sistema (${sysReads} letture, ${spyReads} di riserva)`, sysReads >= 3 && spyReads === 0);
  if (!clipOk) console.log('     nota: appunti di sistema non leggibili in questo Chrome: controllata la scrittura (navigator.clipboard / evento copy)');
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-8).join('\n')); }
P.close(); mock.srv.close();
console.log(`\nRISULTATO: ${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
