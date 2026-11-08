// Brief 11 (v21): leggere comodo sull'iPhone. Chrome che fa finta di essere un iPhone 390×844 @3x (e un iPad, che non deve cambiare).
// PDF A4 vero stampato da Chrome (Georgia 11 pt, margini 25/22 mm, 4 pagine). Misura la grandezza apparente del testo.
// BEFORE=1: solo misure + screenshot «prima» (da lanciare sulla versione vecchia), salva le misure dell'iPad per il confronto.
// Uso: server statico su http://localhost:8088, poi: node tests/brief11.mjs   (screenshot in shots/brief11/)
import fs from 'node:fs';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, touch, tapXY, tap, small, strokes } from './touch.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const BEFORE = !!process.env.BEFORE;
const SHOTS = new URL('../shots/brief11/', import.meta.url).pathname; fs.mkdirSync(SHOTS, { recursive: true });
const IPAD_JSON = OUT + '/brief11-ipad-before.json';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const tag = BEFORE ? 'prima' : 'dopo';
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOTS + name + '-' + tag + '.png', Buffer.from(r.data, 'base64')); };

const LOREM = 'Il contratto prevede che la parte acquirente versi il prezzo entro trenta giorni dalla consegna della merce, salvo diverso accordo scritto tra le parti e salvo quanto previsto dal regolamento comune. La carità e l’umiltà sono virtù che si imparano con pazienza, giorno dopo giorno.';
const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 20mm 22mm 20mm 25mm; } body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.45; color: #111; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 10pt; } p { margin: 0 0 8pt; text-align: justify; }
</style>${[1, 2, 3, 4].map((n) => `<h1 ${n > 1 ? 'style="page-break-before: always"' : ''}>Capitolo ${n} — Leggere comodo</h1>
${Array.from({ length: 9 }, (_, i) => `<p>Paragrafo ${n}.${i + 1}. ${LOREM}</p>`).join('')}`).join('')}</html>`;

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
process.env.UA = 'ipad';
const P = await browser(9411, 'strip');
const q = (expr) => P.eval('return ' + expr);
// grandezza apparente del corpo del testo (11 pt) in px CSS sullo schermo, e dove cadono inizio/fine riga
const measure = () => P.eval(`const p=__penna.nb.pages[__penna.curIndex()], r=p.wrap.getBoundingClientRect(), W=p.pg?p.pg.view[2]-p.pg.view[0]:595.92, k=p.cw/W;
  return { px: +(11*k).toFixed(2), cw: Math.round(p.cw), left: Math.round(r.left + (25/210)*p.cw), right: Math.round(r.left + (1-22/210)*p.cw), vw: innerWidth, zoom: __penna.nb.zoom }`);
const toolbarRects = () => P.eval(`return [...document.querySelectorAll('#toolbar button, #toolbar label, #save-state')].filter(e=>e.offsetParent||getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect(); return (e.id||e.className)+':'+[r.x,r.y,r.width,r.height].map(Math.round).join(',')}).join(' | ')`);
async function openPdf() {
  await P.setFiles('#pdf-input', [OUT + '/leggere.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===4 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 30000, 'PDF aperto');
  await sleep(1200);
}
async function waitRendered() { await P.waitFor(`__penna.nb.pages[__penna.curIndex()].wrap.dataset.rendered==='1'`, 15000, 'pagina disegnata'); await sleep(400); }
const two = (pts) => P.send('Input.dispatchTouchEvent', { type: pts.type, touchPoints: pts.type === 'touchEnd' ? [] : pts.p.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 6, radiusY: 6, force: 1 })) });
async function pinch(cx, cy, d0, d1) {
  await two({ type: 'touchStart', p: [[cx - d0 / 2, cy], [cx + d0 / 2, cy]] });
  for (let i = 1; i <= 10; i++) { const d = d0 + (d1 - d0) * i / 10; await two({ type: 'touchMove', p: [[cx - d / 2, cy], [cx + d / 2, cy]] }); await sleep(16); }
  await two({ type: 'touchEnd' }); await sleep(500);
}
async function dbl(x, y) { await touch(P, 'touchStart', x, y); await sleep(40); await touch(P, 'touchEnd', x, y); await sleep(90); await touch(P, 'touchStart', x, y); await sleep(40); await touch(P, 'touchEnd', x, y); await sleep(600); }

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/leggere.html', HTML); return OUT + '/leggere.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/leggere.pdf', Buffer.from(pr.data, 'base64'));

  // ---------------- iPad (prima e dopo devono essere identici) ----------------
  const ipad = {};
  for (const [w, h] of [[1180, 820], [820, 1180]]) {
    await device(P, w, h);
    await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
    if (!(await q(`__penna.nb.pages.length`))) await openPdf(); else await waitRendered();
    await waitRendered();
      ipad[w + 'x' + h] = { m: await measure(), bar: await toolbarRects(), aa: await q(`!!document.getElementById('btn-read') && getComputedStyle(document.getElementById('btn-read')).display!=='none'`) };
    await shot(P, 'ipad-' + w + 'x' + h);
    console.log(`     iPad ${w}×${h}: testo ${ipad[w + 'x' + h].m.px} px, pagina ${ipad[w + 'x' + h].m.cw} px`);
  }
  const nbId = await q(`__penna.nb.node.id`); // il quaderno di questa prova (il browser può tenere quelli delle prove prima)
  if (BEFORE) fs.writeFileSync(IPAD_JSON, JSON.stringify(ipad));
  else if (fs.existsSync(IPAD_JSON)) {
    const old = JSON.parse(fs.readFileSync(IPAD_JSON, 'utf8'));
    for (const k of Object.keys(ipad)) {
      ok(`iPad ${k}: pagina e testo grandi come prima (${ipad[k].m.cw} px, testo ${ipad[k].m.px} px)`, ipad[k].m.cw === old[k].m.cw && ipad[k].m.px === old[k].m.px, JSON.stringify([old[k].m, ipad[k].m]));
      ok(`iPad ${k}: barra strumenti identica (stessi pulsanti, stesse posizioni) e niente «Aa»`, ipad[k].bar === old[k].bar && !ipad[k].aa, '\nprima: ' + old[k].bar + '\ndopo:  ' + ipad[k].bar);
    }
  } else console.log('     (misure iPad di prima non trovate: lancia prima BEFORE=1 sulla versione vecchia)');
  await P.eval(`await __penna.closeNotebook(); return 1`);

  // ---------------- iPhone 390×844 @3x ----------------
  await P.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await device(P, 390, 844, 3);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(`await __penna.openNotebook(${JSON.stringify(nbId)}); return 1`);
  await P.eval(`__penna.goToPage(0); return 1`); await waitRendered(); await sleep(800);
  const m1 = await measure();
  console.log(`     iPhone ${tag}: testo ${m1.px} px CSS (${(m1.px * 3).toFixed(0)} pixel veri), pagina ${m1.cw} px, righe da x=${m1.left} a x=${m1.right} (schermo ${m1.vw})`);
  await shot(P, 'iphone');
  fs.writeFileSync(OUT + '/brief11-iphone-' + tag + '.json', JSON.stringify(m1));
  if (BEFORE) { console.log(`\n${pass} ok, ${fail} falliti (solo misure «prima»)`); process.exit(0); }
  const prev = fs.existsSync(OUT + '/brief11-iphone-prima.json') ? JSON.parse(fs.readFileSync(OUT + '/brief11-iphone-prima.json', 'utf8')) : null;
  if (prev) console.log(`     confronto: prima ${prev.px} px → dopo ${m1.px} px (×${(m1.px / prev.px).toFixed(2)})`);

  ok('app v21, telefono riconosciuto (body.phone), margini tagliati in memoria', await q(`__penna.version==='v21' && document.body.classList.contains('phone') && !!__penna.nb.crop && __penna.nb.crop.r-__penna.nb.crop.l<0.9`), await q(`JSON.stringify(__penna.nb.crop)`));
  ok('testo più grande senza fare nulla (almeno +20% rispetto a prima)', !prev || m1.px >= prev.px * 1.2, JSON.stringify([prev, m1]));
  ok('le righe intere stanno nello schermo (inizio ≥ 0, fine ≤ 390)', m1.left >= 0 && m1.right <= 390 && m1.left < 30 && m1.right > 360, JSON.stringify(m1));

  // barra strumenti: una sola riga in alto, 44 px, scorrevole, non copre la pagina
  const bar = await P.eval(`const row=document.querySelector('.toprow'), R=row.getBoundingClientRect(), bs=[...row.querySelectorAll('button, label')].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0);
    const ys=new Set(bs.map(b=>Math.round(b.getBoundingClientRect().top))), hs=bs.map(b=>Math.round(b.getBoundingClientRect().height)), ws=bs.map(b=>Math.round(b.getBoundingClientRect().width));
    const page=__penna.nb.pages[0].wrap.getBoundingClientRect(), mid=document.querySelector('.pillbar.mid');
    return { rows: ys.size, minH: Math.min(...hs), minW: Math.min(...ws), n: bs.length, bottom: Math.round(R.bottom), scroll: row.scrollWidth > row.clientWidth, pageTop: Math.round(page.top),
      bottomBar: [...document.querySelectorAll('#toolbar .ib')].some(b=>{const r=b.getBoundingClientRect(); return r.height && r.top>innerHeight/2}),
      firstVisible: bs.filter(b=>b.getBoundingClientRect().right<=390).map(b=>b.id).join(',') }`);
  ok(`barra: una riga sola (${bar.n} pulsanti), tutti ≥ 44 px, scorrevole, niente barra in basso`, bar.rows === 1 && bar.minH >= 44 && bar.minW >= 44 && bar.scroll && !bar.bottomBar, JSON.stringify(bar));
  ok('barra: la pagina comincia sotto la barra (non copre il testo)', bar.pageTop >= bar.bottom, JSON.stringify(bar));
  ok('barra: Quaderni, Aa e numero di pagina subito visibili', /btn-back/.test(bar.firstVisible) && /btn-read/.test(bar.firstVisible) && /page-ind/.test(bar.firstVisible), bar.firstVisible);
  ok('nessun pulsante visibile sotto i 44 px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await P.eval(`document.querySelector('.toprow').scrollLeft=1000; return 1`); await sleep(200);
  ok('barra scorsa fino in fondo: Salva raggiungibile', await P.eval(`const b=document.getElementById('btn-save').getBoundingClientRect(); return b.right<=390 && b.left>=0`));
  await P.eval(`document.querySelector('.toprow').scrollLeft=0; return 1`);

  // un dito con la penna (Dito spento) scorre e non disegna
  const st0 = await q(`document.getElementById('viewer').scrollTop`), s0 = await strokes(P, 0);
  await touch(P, 'touchStart', 200, 600); for (let i = 1; i <= 10; i++) { await touch(P, 'touchMove', 200, 600 - i * 30); await sleep(16); } await touch(P, 'touchEnd', 200, 300); await sleep(500);
  ok('un dito (penna scelta, Dito spento): la pagina scorre e niente tratto', (await q(`document.getElementById('viewer').scrollTop`)) > st0 + 100 && (await strokes(P, 0)) === s0);
  await P.eval(`__penna.goToPage(0); return 1`); await sleep(300);

  // pizzico a due dita
  await pinch(195, 450, 120, 220);
  const z1 = await q(`__penna.nb.zoom`), hs = await q(`document.getElementById('viewer').scrollWidth > document.getElementById('viewer').clientWidth + 200`);
  ok(`pizzico: ingrandisce (zoom ${z1.toFixed(2)}) e la pagina scorre in orizzontale`, z1 > 1.5 && hs);
  await pinch(195, 450, 60, 400);
  ok('pizzico: al massimo 3×', Math.abs((await q(`__penna.nb.zoom`)) - 3) < 0.01, String(await q(`__penna.nb.zoom`)));
  const ml = await q(`document.getElementById('viewer').scrollLeft`);
  await P.eval(`const v=document.getElementById('viewer'); v.scrollLeft=v.scrollLeft+300; return 1`); await sleep(100);
  ok('pagina ingrandita: scorrimento orizzontale libero', (await q(`document.getElementById('viewer').scrollLeft`)) > ml + 250);
  await waitRendered(); await shot(P, 'iphone-zoom3');
  // doppio tocco: torna a misura testo, poi ingrandisce 2×
  await dbl(200, 400);
  const mBack = await measure();
  ok('doppio tocco (ingrandito): torna a misura testo, righe di nuovo intere', Math.abs(mBack.zoom - 1) < 0.01 && mBack.left >= 0 && mBack.right <= 390, JSON.stringify(mBack));
  await dbl(200, 400);
  ok('doppio tocco: ingrandisce 2×', Math.abs((await q(`__penna.nb.zoom`)) - 2) < 0.01, String(await q(`__penna.nb.zoom`)));
  await sleep(700); // salvataggio
  // lo zoom si ricorda per il quaderno
  const id = await q(`__penna.nb.node.id`);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  if (await q(`document.getElementById('notebook').hidden`)) await P.eval(`await __penna.openNotebook(${JSON.stringify(id)}); return 1`);
  await P.waitFor(`__penna.nb.pages.length===4`, 15000);
  ok('riaperto il quaderno: lo zoom scelto (2×) è ricordato', Math.abs((await q(`__penna.nb.zoom`)) - 2) < 0.01, String(await q(`__penna.nb.zoom`)));
  await P.eval(`__penna.zoomTo(1, 100, 100, false); __penna.goToPage(0); return 1`); await sleep(300);
  await P.eval(`__penna.goToPage(0); return 1`); await sleep(300);
  console.log('     pagina corrente prima di Aa: ' + (await q(`__penna.curIndex()`) + 1));
  ok('dati intatti dopo il riavvio (4 pagine, il PDF c’è ancora)', (await q(`(await __penna.D.pagesOf(${JSON.stringify(id)})).length`)) === 4);

  // ---------------- modalità lettura «Aa» ----------------
  await tap(P, '#btn-read');
  await P.waitFor(`!document.getElementById('reader').hidden && document.querySelectorAll('#rd-body .rd-p').length>8`, 10000, 'lettura aperta');
  await sleep(400);
  const rdm = await P.eval(`const ps=[...document.querySelectorAll('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)')], r=ps[1].getBoundingClientRect(), cs=getComputedStyle(ps[1]);
    return { n: ps.length, fs: parseFloat(cs.fontSize), w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), h: document.querySelectorAll('#rd-body .rd-h').length,
      txt: ps[0].textContent, bg: getComputedStyle(document.getElementById('reader')).backgroundColor, top: Math.round(document.getElementById('reader').getBoundingClientRect().top) }`);
  ok(`Aa: testo a colonna (${rdm.n} paragrafi, ${rdm.h} titoli), carattere ${rdm.fs} px ≥ 15, dentro lo schermo, sfondo carta`, rdm.n >= 9 && rdm.h >= 1 && rdm.fs >= 15 && rdm.left >= 0 && rdm.right <= 390 && /^rgb\(251, 246, 236/.test(rdm.bg), JSON.stringify(rdm));
  ok('Aa: paragrafo intero e pulito (a capo riuniti)', /^Paragrafo 1\.1\. Il contratto prevede .* giorno dopo giorno\.$/.test(rdm.txt), rdm.txt);
  await shot(P, 'iphone-lettura');
  console.log('     lettura: scrollTop ' + await q(`document.getElementById('reader').scrollTop`) + ', menu misure in y=' + (await rect(P, '.rd-sizes')).y);
  await tap(P, '.rd-sizes button[data-size="2"]'); await sleep(200);
  const big = await q(`parseFloat(getComputedStyle(document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)')).fontSize)`);
  await tap(P, '.rd-sizes button[data-size="0"]'); await sleep(200);
  const smallF = await q(`parseFloat(getComputedStyle(document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)')).fontSize)`);
  ok(`Aa: tre misure (piccolo ${smallF} · grande ${big} px), ricordate`, big > rdm.fs && smallF < rdm.fs && smallF >= 15 && (await q(`localStorage.getItem('penna.rdSize')`)) === '0', JSON.stringify([smallF, big, rdm.fs, await q(`localStorage.getItem('penna.rdSize')`)]));
  await tap(P, '.rd-sizes button[data-size="1"]'); await sleep(200);
  ok('cambio misura: il paragrafo in cima resta visibile sotto la barretta', await P.eval(`const t=document.querySelector('.rd-top').getBoundingClientRect().bottom, ps=[...document.querySelectorAll('#rd-body .rd-p, #rd-body .rd-pg')], f=ps.find(p=>p.getBoundingClientRect().bottom>t); return !!f && f.getBoundingClientRect().top>=t-2`));
  const n0 = (await q(`(__penna.nb.pages[0].rec.anns||[]).length`));
  await P.eval(`document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)').scrollIntoView({block:'center'}); return 1`); await sleep(200);
  const para = await rect(P, '#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)');
  ok('paragrafo in vista, non coperto dalla barretta delle misure', await P.eval(`const p=document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)'), r=p.getBoundingClientRect(), h=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return p.contains(h)`));
  const hitInfo = await P.eval(`const h=document.elementFromPoint(${para.cx}, ${para.cy}); return (h.id||h.className||h.tagName)+' '+(h.textContent||'').slice(0,30)+' | reader '+document.getElementById('reader').hidden+' rd '+__penna.rd.open+' toast '+document.getElementById('toast').textContent`);
  await tapXY(P, para.cx, para.cy); await sleep(400);
  if (!(await q(`(__penna.nb.pages[0].rec.anns||[]).length`))) console.log('     DIAG tocco in', JSON.stringify(para), hitInfo, '→ dopo:', await q(`document.getElementById('toast').textContent + ' | err ' + document.getElementById('err-msg').textContent + ' | pagine ' + __penna.nb.pages.map(p=>(p.rec.anns||[]).length).join(',')`));
  const a = await q(`(()=>{const l=__penna.nb.pages[0].rec.anns||[]; const a=l[l.length-1]; return a && {q:a.q, r:a.r, n:l.length}})()`);
  // il paragrafo 1.1 sta sotto il titolo, sul margine sinistro (25 mm = 0,119) e destro (1 - 22/210 = 0,895)
  const okR = a && a.r.length >= 3 && a.r.every((r) => r.l > 0.09 && r.l < 0.14 && r.t > 0.05 && r.t < 0.35 && r.h > 0.008 && r.h < 0.03) && a.r.some((r) => r.l + r.w > 0.87 && r.l + r.w < 0.92);
  ok('tocco su un paragrafo: evidenziazione vera sulla pagina (riquadri sulle righe giuste)', a && a.n === n0 + 1 && /^Paragrafo 1\.1\./.test(a.q) && okR, JSON.stringify(a));
  ok('il paragrafo appare evidenziato nella lettura', await q(`document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)').classList.contains('on')`));
  await tapXY(P, para.cx, para.cy); await sleep(400);
  ok('secondo tocco: evidenziazione tolta', (await q(`(__penna.nb.pages[0].rec.anns||[]).length`)) === n0 && !(await q(`document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)').classList.contains('on')`)));
  await P.eval(`document.getElementById('btn-undo').scrollIntoView({inline:'center'}); return 1`); await sleep(200);
  await tap(P, '#btn-undo'); await sleep(300);
  await P.eval(`document.querySelector('.toprow').scrollLeft=0; return 1`);
  ok('Annulla: evidenziazione di nuovo lì', (await q(`(__penna.nb.pages[0].rec.anns||[]).length`)) === n0 + 1 && await q(`document.querySelector('#rd-body .rd-page[data-i="0"] .rd-p:not(.rd-h)').classList.contains('on')`));
  // scorrendo si caricano le pagine successive
  await P.eval(`const r=document.getElementById('reader'); r.scrollTop=r.scrollHeight; return 1`); await sleep(1200);
  await P.eval(`const r=document.getElementById('reader'); r.scrollTop=r.scrollHeight; return 1`); await sleep(1200);
  ok('Aa: scorrendo arrivano le pagine dopo (fino alla 4)', await q(`document.querySelectorAll('#rd-body .rd-page').length===4 && !document.getElementById('rd-end').hidden`), String(await q(`document.querySelectorAll('#rd-body .rd-page').length`)));
  await P.eval(`document.querySelector('#rd-body .rd-page[data-i="0"]').scrollIntoView(); return 1`); await sleep(200);
  await tap(P, '#btn-read'); await sleep(800); await waitRendered();
  ok('chiuso Aa: si torna alla pagina, evidenziazione disegnata sul foglio', await q(`document.getElementById('reader').hidden && __penna.curIndex()===0 && __penna.nb.pages[0].anns.querySelectorAll('.ann-r').length>=3`));
  await shot(P, 'iphone-evidenziato');
  await P.eval(`await __penna.saveNow(); return 1`); await sleep(500);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  ok('dopo il riavvio l’evidenziazione c’è ancora (salvata nel quaderno, si sincronizza come le altre)', (await q(`(await __penna.D.pagesOf(${JSON.stringify(id)}))[0].anns.filter(a=>/^Paragrafo 1\\.1\\./.test(a.q)).length`)) === 1);

  // ---------------- testi delle impostazioni ----------------
  ok('impostazioni: «Sincronizzazione tra i tuoi dispositivi» e «Solo su questo dispositivo»', await q(`document.body.innerHTML.includes('Sincronizzazione tra i tuoi dispositivi') && !document.body.innerHTML.includes('Sincronizzazione tra iPad') && !document.body.innerHTML.includes('Solo su questo iPad')`));
  ok('nessun errore a schermo', await q(`document.getElementById('errbox').hidden`), await q(`document.getElementById('errbox').textContent`));
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e && e.stack || e));
  try { await shot(P, 'errore'); } catch {}
} finally {
  const logs = P.logs.filter((l) => /EXC|error/i.test(l)); if (logs.length) console.log('log browser:\n  ' + logs.slice(0, 8).join('\n  '));
  P.close();
}
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
