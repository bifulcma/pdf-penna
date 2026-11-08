// Brief 12 (v22): sul telefono evidenziare PARTI di frase. Chrome che fa finta di essere un iPhone 390×844 @3x.
// 1) lettura «Aa»: selezione di 3 parole in mezzo a un paragrafo → evidenziazione che copre solo quelle (rettangoli
//    confrontati con le parole vere del livello di testo posato sull'inchiostro), barra in basso, Sottolinea, Nota, Annulla.
// 2) vista pagina: «Mano» (un dito scorre), evidenziatore con un dito agganciato alle parole, fuori dal testo tratto libero,
//    due dita scorrono, penna con un dito.
// Uso: server statico su http://localhost:8088, poi: NOSANDBOX=1 node tests/brief12.mjs   (screenshot in shots/brief12/)
import fs from 'node:fs';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, touch, tapXY, tap, small, strokes } from './touch.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const SHOTS = new URL('../shots/brief12/', import.meta.url).pathname; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOTS + name + '.png', Buffer.from(r.data, 'base64')); };

const LOREM = 'Il contratto prevede che la parte acquirente versi il prezzo entro trenta giorni dalla consegna della merce, salvo diverso accordo scritto tra le parti e salvo quanto previsto dal regolamento comune. La carità e l’umiltà sono virtù che si imparano con pazienza, giorno dopo giorno.';
const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 20mm 22mm 20mm 25mm; } body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.45; color: #111; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 10pt; } p { margin: 0 0 8pt; text-align: justify; }
</style>${[1, 2, 3].map((n) => `<h1 ${n > 1 ? 'style="page-break-before: always"' : ''}>Capitolo ${n} — Parti piccole</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragrafo ${n}.${i + 1}. ${LOREM}</p>`).join('')}`).join('')}</html>`;

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const P = await browser(9412, 'strip');
await P.send('Network.setCacheDisabled', { cacheDisabled: true });
const q = (expr) => P.eval('return ' + expr);
const anns = (i = 0) => P.eval(`return (__penna.nb.pages[${i}].rec.anns||[]).map(a=>({id:a.id,q:a.q,c:a.c,k:a.k||'',n:a.n||'',r:a.r}))`);
const two = (type, pts) => P.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 6, radiusY: 6, force: 1 })) });
async function drag(pts) { await touch(P, 'touchStart', pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) { await touch(P, 'touchMove', x, y); await sleep(16); } await touch(P, 'touchEnd', 0, 0); await sleep(500); }
const line = (x0, y0, x1, y1, n = 14) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
async function dbl(x, y) { await touch(P, 'touchStart', x, y); await sleep(40); await touch(P, 'touchEnd', x, y); await sleep(90); await touch(P, 'touchStart', x, y); await sleep(40); await touch(P, 'touchEnd', x, y); await sleep(600); }
// selezione come la farebbero le maniglie di iOS: dal carattere a al carattere b del paragrafo k della pagina i
const select = (i, k, a, b) => P.eval(`const pe=document.querySelector('#rd-body .rd-page[data-i="${i}"] .rd-p[data-k="${k}"]'); pe.scrollIntoView({block:'center'});
  const tw=document.createTreeWalker(pe,NodeFilter.SHOW_TEXT); let n, pos=0, sa=null, sb=null;
  while((n=tw.nextNode())){ const L=n.data.length; if(!sa&&${a}<=pos+L) sa=[n,${a}-pos]; if(!sb&&${b}<=pos+L) sb=[n,${b}-pos]; pos+=L; }
  const r=document.createRange(); r.setStart(...sa); r.setEnd(...sb); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return pe.textContent.slice(${a},${b})`);
const paraText = (i, k) => q(`document.querySelector('#rd-body .rd-page[data-i="${i}"] .rd-p[data-k="${k}"]').textContent`);
const barState = () => P.eval(`const b=document.getElementById('hlbar'); const r=b.getBoundingClientRect(); return {hidden:b.hidden, mode:b.dataset.mode, top:Math.round(r.top), bottom:Math.round(r.bottom), left:Math.round(r.left), right:Math.round(r.right)}`);
// parole vere della pagina (livello di testo posato sull'inchiostro) coperte dai riquadri di un'annotazione
const covered = (id) => P.eval(`const p=__penna.nb.pages[0], rs=[...p.anns.querySelectorAll('.ann-r[data-id="${id}"]')].map(e=>e.getBoundingClientRect());
  const ws=[...p.tl.div.querySelectorAll('span.w')].map(w=>({t:w.textContent, r:w.getBoundingClientRect()}));
  const inside=(w)=>rs.some(r=>{const cx=w.r.left+w.r.width/2, cy=w.r.top+w.r.height/2; return cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom});
  const cov=ws.filter(inside), touch=ws.filter(w=>!inside(w)&&rs.some(r=>w.r.right>r.left+1.5&&w.r.left<r.right-1.5&&w.r.bottom>r.top+2&&w.r.top<r.bottom-2));
  const first=cov[0], last=cov[cov.length-1];
  return { words: cov.map(w=>w.t), touching: touch.map(w=>w.t), nRects: rs.length, fitted: p.tl.fitted, lines: p.tl.lineCount,
    dl: first ? +(rs[0].left - first.r.left).toFixed(2) : null, dr: last ? +(rs[rs.length-1].right - last.r.right).toFixed(2) : null }`);

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/parti.html', HTML); return OUT + '/parti.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/parti.pdf', Buffer.from(pr.data, 'base64'));

  await P.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await device(P, 390, 844, 3);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  if (!(await q(`document.getElementById('notebook').hidden`))) await P.eval(`await __penna.closeNotebook(); return 1`);
  await P.eval(`localStorage.removeItem('penna.rdSize'); localStorage.setItem('penna.readHint','1'); return 1`);
  await P.setFiles('#pdf-input', [OUT + '/parti.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===3 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 30000, 'PDF aperto');
  await sleep(1200);
  const id = await q(`__penna.nb.node.id`);
  ok('app v22 sul telefono', await q(`__penna.version==='v22' && document.body.classList.contains('phone')`));
  ok('si apre con «Mano» attiva (un dito scorre), pulsante Mano visibile ed evidenziato', await q(`__penna.S.tool==='hand' && document.getElementById('tool-hand').classList.contains('active') && getComputedStyle(document.getElementById('tool-hand')).display!=='none' && !document.body.classList.contains('onefinger')`));
  ok('nessun pulsante visibile sotto i 44 px', (await small(P)).length === 0, JSON.stringify(await small(P)));

  // ================= 1. lettura «Aa» =================
  await tap(P, '#btn-read');
  await P.waitFor(`!document.getElementById('reader').hidden && document.querySelectorAll('#rd-body .rd-p').length>8`, 10000, 'lettura aperta');
  await sleep(400);
  // un tocco su un paragrafo NON evidenzia più tutto
  const pe2 = await rect(P, '#rd-body .rd-page[data-i="0"] .rd-p[data-k="2"]');
  await tapXY(P, pe2.cx, pe2.cy); await sleep(600);
  ok('un tocco su un paragrafo non evidenzia più tutto il paragrafo', (await anns()).length === 0);
  ok('il testo della lettura si può selezionare (maniglie di iOS)', await q(`getComputedStyle(document.querySelector('#rd-body .rd-p')).userSelect==='text' || getComputedStyle(document.querySelector('#rd-body .rd-p')).webkitUserSelect==='text'`));

  // selezione di 3 parole in mezzo al paragrafo 1.3 (dentro la prima e l'ultima parola, come con le maniglie)
  const t3 = await paraText(0, 3), w0 = t3.indexOf('parte acquirente versi');
  const got = await select(0, 3, w0 + 2, w0 + 'parte acquirente versi'.length - 2);
  await sleep(500);
  const b1 = await barState();
  ok(`selezione «${got}» → barra in basso (Evidenzia, Sottolinea, Nota, Copia), dentro lo schermo`, !b1.hidden && b1.mode === 'sel' && b1.bottom <= 844 && b1.left >= 0 && b1.right <= 390, JSON.stringify(b1));
  await shot(P, 'iphone-lettura-selezione');
  await tap(P, '#hlbar .hb-c[data-c="#f5c400"]'); await sleep(500);
  let L = await anns();
  const A1 = L[L.length - 1];
  ok('Evidenzia: un’evidenziazione con SOLO le 3 parole (allargate alle parole intere)', L.length === 1 && A1.q === 'parte acquirente versi' && A1.c === '#f5c400', JSON.stringify(L));
  ok('barra chiusa e selezione tolta dopo l’azione', (await barState()).hidden && await q(`getSelection().isCollapsed`));
  ok('nella lettura sono evidenziate solo quelle parole', await q(`[...document.querySelectorAll('#rd-body .rd-page[data-i="0"] mark.rd-m')].map(m=>m.textContent).join('|')`) === 'parte acquirente versi', await q(`[...document.querySelectorAll('#rd-body mark.rd-m')].map(m=>m.textContent).join('|')`));
  await shot(P, 'iphone-lettura-evidenziato');
  ok('va nei Commenti e nel Markdown', await q(`(__penna.renderAnnList(), document.getElementById('ann-list').textContent.includes('parte acquirente versi')) && __penna.allMarkdown().includes('> "parte acquirente versi"')`));
  await P.eval(`__penna.undo(); return 1`); await sleep(300);
  ok('Annulla: tolta (anche nella lettura)', (await anns()).length === 0 && (await q(`document.querySelectorAll('#rd-body mark.rd-m').length`)) === 0);
  await P.eval(`__penna.redo(); return 1`); await sleep(300);
  ok('Ripeti: di nuovo lì', (await anns()).length === 1 && (await q(`document.querySelectorAll('#rd-body mark.rd-m').length`)) === 1);

  // tocco sull'evidenziazione → Cambia colore / Togli
  let m = await rect(P, '#rd-body mark.rd-m');
  await tapXY(P, m.cx, m.cy); await sleep(650);
  const b2 = await barState();
  ok('tocco sull’evidenziazione: barretta Cambia colore / Togli', !b2.hidden && b2.mode === 'ann' && await q(`getComputedStyle(document.querySelector('#hlbar .hb-ann')).display!=='none' && document.querySelector('#hlbar .hb-c[data-c="#f5c400"]').classList.contains('on')`), JSON.stringify(b2));
  await tap(P, '#hlbar .hb-c[data-c="#7fd35b"]'); await sleep(400);
  ok('Cambia colore: verde (stesse parole)', (await anns())[0].c === '#7fd35b' && (await anns())[0].q === 'parte acquirente versi' && (await barState()).hidden);
  m = await rect(P, '#rd-body mark.rd-m'); await tapXY(P, m.cx, m.cy); await sleep(650);
  await tap(P, '#hlbar [data-act="ul"]'); await sleep(400);
  ok('da evidenziata a sottolineata', (await anns())[0].k === 'ul' && await q(`document.querySelector('#rd-body mark.rd-m').classList.contains('u')`));
  m = await rect(P, '#rd-body mark.rd-m'); await tapXY(P, m.cx, m.cy); await sleep(650);
  await tap(P, '#hlbar [data-act="ul"]'); await sleep(400);
  ok('e di nuovo evidenziata', (await anns())[0].k === '' && !(await q(`document.querySelector('#rd-body mark.rd-m').classList.contains('u')`)));
  m = await rect(P, '#rd-body mark.rd-m'); await tapXY(P, m.cx, m.cy); await sleep(650);
  await tap(P, '#hlbar [data-act="del"]'); await sleep(400);
  ok('Togli', (await anns()).length === 0);
  await P.eval(`__penna.undo(); return 1`); await sleep(300);
  ok('Annulla dopo Togli: torna', (await anns()).length === 1);

  // Sottolinea su un'altra frase (paragrafo 1.5)
  const t5 = await paraText(0, 5), u0 = t5.indexOf('entro trenta giorni');
  await select(0, 5, u0, u0 + 'entro trenta giorni'.length); await sleep(500);
  await tap(P, '#hlbar [data-act="ul"]'); await sleep(500);
  L = await anns();
  const U = L.find((a) => a.k === 'ul');
  ok('Sottolinea: solo «entro trenta giorni», sottolineato nella lettura', U && U.q === 'entro trenta giorni' && await q(`[...document.querySelectorAll('#rd-body mark.rd-m.u')].map(m=>m.textContent).join('|')`) === 'entro trenta giorni', JSON.stringify(L));
  // Nota su una frase (paragrafo 1.6)
  const t6 = await paraText(0, 6), n0 = t6.indexOf('accordo scritto');
  await select(0, 6, n0, n0 + 'accordo scritto'.length); await sleep(500);
  await tap(P, '#hlbar [data-act="note"]'); await sleep(400);
  ok('Nota: si apre il riquadro del commento', await q(`document.getElementById('cdlg').open`));
  await P.eval(`document.getElementById('cdlg-text').value='Da verificare'; document.getElementById('cdlg-ok').click(); return 1`); await sleep(400);
  ok('Nota salvata sulle sole parole scelte', (await anns()).some((a) => a.q === 'accordo scritto' && a.n === 'Da verificare'));
  // doppio tocco: tutto il paragrafo
  const pe7 = await P.eval(`const e=document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p[data-k="7"]'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {cx:r.x+r.width/2, cy:r.y+r.height/2}`);
  await sleep(200); await dbl(pe7.cx, pe7.cy);
  ok('doppio tocco su un paragrafo: evidenziato tutto il paragrafo', (await anns()).some((a) => /^Paragrafo 1\.7\. .*giorno dopo giorno\.$/.test(a.q)) && await q(`document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p[data-k="7"]').classList.contains('on')`));
  await shot(P, 'iphone-lettura-tutto');

  // chiusa la lettura: sulla pagina vera, allineate alle parole
  await P.eval(`document.querySelector('#rd-body .rd-page[data-i="0"]').scrollIntoView(); return 1`); await sleep(200);
  await tap(P, '#btn-read'); await sleep(900);
  await P.waitFor(`__penna.nb.pages[0].wrap.dataset.rendered==='1'`, 15000);
  ok('sulla pagina: evidenziazione e sottolineatura disegnate', await q(`__penna.nb.pages[0].anns.querySelectorAll('.ann-r').length>=5 && __penna.nb.pages[0].anns.querySelectorAll('.ann-r.ann-u').length===1`));
  await P.eval(`__penna.setTool('select'); return 1`);
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  await sleep(300);
  const c1 = await covered(A1.id);
  ok(`rettangoli sulla pagina: coprono esattamente «parte acquirente versi» (bordo sinistro ${c1.dl} px, destro ${c1.dr} px dalle parole vere)`, c1.words.join(' ') === 'parte acquirente versi' && !c1.touching.length && Math.abs(c1.dl) <= 3 && Math.abs(c1.dr) <= 3, JSON.stringify(c1));
  const c2 = await covered(U.id);
  ok(`sottolineatura: esattamente «entro trenta giorni» (bordi ${c2.dl} / ${c2.dr} px)`, c2.words.join(' ') === 'entro trenta giorni' && !c2.touching.length && Math.abs(c2.dl) <= 3 && Math.abs(c2.dr) <= 3, JSON.stringify(c2));
  // Seleziona sul telefono: stessa barra
  await P.eval(`const ws=[...__penna.nb.pages[0].tl.div.querySelectorAll('span.w')].filter(w=>/^(consegna|della|merce,)$/.test(w.textContent)); const i=ws.findIndex((w,j)=>w.textContent==='consegna'&&ws[j+1]&&ws[j+1].textContent==='della'); const r=document.createRange(); r.setStart(ws[i].firstChild,0); r.setEnd(ws[i+2].firstChild, ws[i+2].textContent.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return 1`);
  await sleep(500);
  const b3 = await barState();
  ok('strumento Seleziona sul telefono: stessa barra in basso (non il menu da iPad)', !b3.hidden && b3.mode === 'sel' && await q(`document.getElementById('selmenu').hidden`), JSON.stringify(b3));
  await P.eval(`getSelection().removeAllRanges(); return 1`); await sleep(400);
  ok('selezione tolta: barra chiusa', (await barState()).hidden);
  await shot(P, 'iphone-pagina-parole');

  // ================= 2. vista pagina =================
  await tap(P, '#tool-hand'); await sleep(200);
  await P.eval(`document.querySelector('.toprow').scrollLeft=0; __penna.goToPage(0); return 1`); await sleep(400);
  const s0 = await strokes(P, 0), n0a = (await anns()).length, st0 = await q(`document.getElementById('viewer').scrollTop`);
  await drag(line(200, 650, 200, 350, 10));
  ok('Mano: un dito scorre e non scrive', (await q(`document.getElementById('viewer').scrollTop`)) > st0 + 100 && (await strokes(P, 0)) === s0 && (await anns()).length === n0a);
  await P.eval(`__penna.goToPage(0); return 1`); await sleep(400);

  // evidenziatore: un dito sopra una riga di testo → parole intere
  await P.eval(`document.getElementById('tool-hl').scrollIntoView({inline:'nearest'}); return 1`); await sleep(150);
  await tap(P, '#tool-hl'); await sleep(300);
  ok('evidenziatore scelto: attivo, un dito scrive (pagina senza scorrimento del browser)', await q(`__penna.S.tool==='hl' && document.getElementById('tool-hl').classList.contains('active') && document.body.classList.contains('onefinger') && getComputedStyle(__penna.nb.pages[0].draw).touchAction==='none'`));
  ok('avviso chiaro: «due dita per scorrere · Mano per leggere»', /due dita per scorrere/.test(await q(`document.getElementById('toast').textContent`)), await q(`document.getElementById('toast').textContent`));
  await P.eval(`document.querySelector('.toprow').scrollLeft=0; return 1`);
  // posizione sullo schermo di «dalla consegna» nel paragrafo 1.2 (riga presa dal testo della pagina)
  const tgt = await P.eval(`const g=await __penna.pageGeo(__penna.nb.pages[0]); const W=__penna.nb.pages[0].wrap.getBoundingClientRect();
    const rows=g.rows; let hit=null; for(let i=0;i<rows.length;i++){ if(!rows[i].str.startsWith('Paragrafo 1.2.')) continue; for(let j=i;j<i+3;j++){ const k=rows[j].str.indexOf('dalla consegna'); if(k>=0){hit={j,k}; break;} } break; }
    if(!hit) return null; const r=rows[hit.j], a=r.cx[hit.k], b=r.cx[hit.k+'dalla consegna'.length-1];
    return { y: W.top+(r.t+r.h/2)*W.height, x0: W.left+(a[0]+0.01)*W.width, x1: W.left+(b[1]-0.01)*W.width, str: r.str }`);
  ok('riga di prova trovata e in vista', tgt && tgt.y > 80 && tgt.y < 800, JSON.stringify(tgt));
  const s1 = await strokes(P, 0), n1 = (await anns()).length;
  await drag(line(tgt.x0 + 4, tgt.y + 2, tgt.x1 - 4, tgt.y - 1, 16)); await sleep(400);
  L = await anns();
  const H = L.find((a) => a.q === 'dalla consegna');
  ok('evidenziatore con un dito sulle parole: diventa «dalla consegna» agganciato alle parole (niente sgorbio)', H && L.length === n1 + 1 && (await strokes(P, 0)) === s1, JSON.stringify(L.slice(n1)));
  await P.eval(`__penna.setTool('select'); return 1`); await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000); await sleep(300);
  const c3 = H ? await covered(H.id) : {};
  ok(`…e copre esattamente quelle parole (bordi ${c3.dl} / ${c3.dr} px)`, c3.words && c3.words.join(' ') === 'dalla consegna' && !c3.touching.length && Math.abs(c3.dl) <= 3 && Math.abs(c3.dr) <= 3, JSON.stringify(c3));
  await P.eval(`__penna.setTool('hl'); return 1`); await sleep(300);
  // fuori dal testo (margine basso della pagina 1): tratto libero
  const mg = await P.eval(`const W=__penna.nb.pages[0].wrap.getBoundingClientRect(); return { y: W.top+W.height*0.975, x0: W.left+W.width*0.3, x1: W.left+W.width*0.6, vis: W.top+W.height*0.975 < innerHeight-20 }`);
  if (!mg.vis) { await P.eval(`const v=document.getElementById('viewer'); v.scrollTop+= ${Math.round(mg.y - 600)}; return 1`); await sleep(300); }
  const mg2 = await P.eval(`const W=__penna.nb.pages[0].wrap.getBoundingClientRect(); return { y: W.top+W.height*0.975, x0: W.left+W.width*0.3, x1: W.left+W.width*0.6 }`);
  const s2 = await strokes(P, 0), n2 = (await anns()).length;
  await drag(line(mg2.x0, mg2.y, mg2.x1, mg2.y - 6, 12)); await sleep(300);
  ok('evidenziatore fuori dal testo: resta tratto libero', (await strokes(P, 0)) === s2 + 1 && (await anns()).length === n2);
  await P.eval(`__penna.undo(); return 1`); await sleep(200);
  ok('Annulla toglie il tratto', (await strokes(P, 0)) === s2);
  // due dita scorrono (e non scrivono)
  const st1 = await q(`document.getElementById('viewer').scrollTop`), z0 = await q(`__penna.nb.zoom`);
  await two('touchStart', [[150, 650], [240, 650]]);
  for (let i = 1; i <= 10; i++) { await two('touchMove', [[150, 650 - i * 25], [240, 650 - i * 25]]); await sleep(16); }
  await two('touchEnd', []); await sleep(500);
  const st2 = await q(`document.getElementById('viewer').scrollTop`);
  ok(`due dita scorrono (${Math.round(st2 - st1)} px) senza ingrandire né scrivere`, st2 - st1 > 200 && st2 - st1 < 300 && Math.abs((await q(`__penna.nb.zoom`)) - z0) < 0.01 && (await strokes(P, 0)) === s2 && (await anns()).length === n2, JSON.stringify([st1, st2, z0]));
  // due dita ingrandiscono
  await two('touchStart', [[150, 450], [240, 450]]);
  for (let i = 1; i <= 10; i++) { await two('touchMove', [[150 - i * 5, 450], [240 + i * 5, 450]]); await sleep(16); }
  await two('touchEnd', []); await sleep(500);
  ok('due dita ingrandiscono anche con l’evidenziatore', (await q(`__penna.nb.zoom`)) > z0 * 1.3 && (await strokes(P, 0)) === s2, String(await q(`__penna.nb.zoom`)));
  await P.eval(`__penna.zoomTo(1, 100, 100, false); __penna.goToPage(0); return 1`); await sleep(500);
  // penna con un dito
  await P.eval(`document.getElementById('tool-pen').scrollIntoView({inline:'nearest'}); return 1`); await sleep(150);
  await tap(P, '#tool-pen'); await sleep(200);
  await P.eval(`document.querySelector('.toprow').scrollLeft=0; return 1`);
  const s3 = await strokes(P, 0);
  await drag(line(120, 500, 260, 540, 12));
  ok('penna: un dito scrive', (await strokes(P, 0)) === s3 + 1);
  await P.eval(`__penna.undo(); return 1`);
  // tocco su un'evidenziazione della pagina (con Mano) → barretta
  await tap(P, '#tool-hand'); await sleep(200);
  const hr = await P.eval(`const e=__penna.nb.pages[0].anns.querySelector('.ann-r[data-id="${H ? H.id : ''}"]'); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {cx:r.x+r.width/2, cy:r.y+r.height/2}`);
  if (hr) { await sleep(300); await tapXY(P, hr.cx, hr.cy); await sleep(500); }
  const b4 = await barState();
  ok('vista pagina (Mano): tocco su un’evidenziazione → barretta Cambia colore / Togli', hr && !b4.hidden && b4.mode === 'ann', JSON.stringify(b4));
  if (!b4.hidden) { await tap(P, '#hlbar .hb-c[data-c="#ff7eb6"]'); await sleep(300); }
  ok('…colore cambiato in rosa', (await anns()).find((a) => a.q === 'dalla consegna')?.c === '#ff7eb6');
  await shot(P, 'iphone-pagina-evidenziatore');

  const exp = await P.eval(`try { const b = await __penna.exportBytes(); return b && b.length || 0 } catch (e) { return 'ERR ' + e.message }`);
  ok('Esporta PDF con evidenziazioni parziali e sottolineatura: nessun errore', typeof exp === 'number' && exp > 1000, String(exp));
  // salvate (si sincronizzano come le altre: stanno nella pagina)
  await P.eval(`await __penna.saveNow(); return 1`); await sleep(500);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  const saved = await q(`(await __penna.D.pagesOf(${JSON.stringify(id)}))[0].anns.map(a=>a.q+'|'+(a.k||'')+'|'+(a.n||'')).sort().join(' ; ')`);
  ok('dopo il riavvio le evidenziazioni ci sono (salvate nella pagina del quaderno)', /parte acquirente versi\|\|/.test(saved) && /entro trenta giorni\|ul\|/.test(saved) && /accordo scritto\|\|Da verificare/.test(saved) && /dalla consegna/.test(saved), saved);
  const md = await P.eval(`const pages=await __penna.D.pagesOf(${JSON.stringify(id)}); const e=[]; pages.forEach((p,i)=>(p.anns||[]).forEach(a=>e.push({page:i+1,q:a.q,n:a.n,k:a.k}))); return __penna.N.toMarkdown('Prova', e)`);
  ok('Markdown: citazioni brevi e la nota', md.includes('> "parte acquirente versi"') && md.includes('> "entro trenta giorni"') && md.includes('**Commento:** Da verificare'), md);
  ok('nessun errore a schermo', await q(`document.getElementById('errbox').hidden`), await q(`document.getElementById('errbox').textContent`));
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e && e.stack || e));
  try { await shot(P, 'errore'); } catch {}
} finally {
  const logs = P.logs.filter((l) => /EXC|error/i.test(l)); if (logs.length) console.log('log browser:\n  ' + logs.slice(0, 8).join('\n  '));
  P.close();
}
console.log(`\n${pass} ok, ${fail} falliti`);
