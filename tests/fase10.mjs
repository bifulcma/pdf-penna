// Test della fase 10: «Barra» (testo da cancellare) e «Modifica» (testo da sostituire), segni da correttore di bozze.
// Browser "da iPad" 1180×820 col tocco (API moderne tolte + polyfill, user agent Safari), PDF vero stampato da Chrome:
// selezione → Barra; selezione → Modifica col testo nuovo; tocco per riaprire, Barra↔Modifica, elimina, annulla;
// pannello con le etichette; riavvio (restano); «Copia tutto in Markdown» con le istruzioni; export PDF; miniature;
// ricerca; iPad in verticale e iPhone (menu dentro lo schermo).
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase10.mjs
import fs from 'node:fs';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, tapXY, tap, reachable, small } from './touch.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
const SHOTS = OUT + '/shots10'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };

// ---------- PDF di prova: stampato da Chrome (Georgia incorporato, testo giustificato, accenti), 2 pagine ----------
const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 13pt; line-height: 1.5; color: #111; }
h1 { font-size: 21pt; margin: 0 0 10pt; } p { margin: 0 0 9pt; text-align: justify; }
</style><h1>Capitolo decimo — Le bozze</h1>
<p>Il contratto prevede che la parte acquirente versi il prezzo entro trenta giorni dalla consegna della merce, salvo diverso accordo scritto tra le parti e salvo quanto previsto dal regolamento comune.</p>
<p>Questa frase è inutile e va tolta del tutto.</p>
<p>Una parola sbagliatta da correggere subito.</p>
<p>La carità e l'umiltà sono virtù che si imparano con pazienza.</p>
${Array.from({ length: 8 }, (_, i) => `<p>Riga ${i + 1}: il venditore consegna la merce nel luogo convenuto, con la cura del buon padre di famiglia.</p>`).join('')}
<p>Fine della pagina uno con un pensiero che continua</p>
<p style="page-break-before: always">nella pagina due senza interruzione. Poi il testo prosegue normale.</p>
</html>`;

process.env.UA = 'ipad';
const P = await browser(9381, 'strip');
const toastTxt = () => P.eval(`return document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent`);
const dlgOpt = (label) => P.eval(`const b=[...document.querySelectorAll('#dlg-options button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
async function tapOpt(label) { const c = await dlgOpt(label); if (!c) throw new Error('opzione mancante: ' + label); await tapXY(P, c.x, c.y); await sleep(300); }
const opts = () => P.eval(`return [...document.querySelectorAll('#dlg-options .opt')].map(b=>b.textContent.trim()).join('|')`);
// selezione come farebbero le maniglie: dall'inizio della frase A (pagina pa) alla fine della frase B (pagina pb)
const SEL_FN = `
window.__all = function (pi) { const p = __penna.nb.pages[pi], tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => n.nodeType === 3 || n.nodeName === 'BR' ? 1 : 3 });
  const parts = []; let all = ''; for (let n = tw.nextNode(); n; n = tw.nextNode()) { const t = n.nodeType === 3 ? n.data : '\\n'; parts.push([n, all.length, t.length]); all += t; } return { parts, all }; };
window.__loc = function (pi, phrase, end) { const { parts, all } = __all(pi), i = all.indexOf(phrase); if (i < 0) return null; const j = end ? i + phrase.length : i;
  const a = parts.find(([n, s, l]) => n.nodeType === 3 && (end ? j > s && j <= s + l : j >= s && j < s + l)); return a ? [a[0], j - a[1]] : null; };
window.__selRange = function (pa, A, pb, B) { const a = __loc(pa, A, false), b = __loc(pb, B, true); if (!a || !b) return false;
  const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; };
// la linea rossa della barra cade a metà delle lettere minuscole? (fascia con più inchiostro nella riga, letta dal canvas della pagina)
window.__strikeAt = function (pi, id) { const p = __penna.nb.pages[pi], W = p.wrap.getBoundingClientRect(), cv = p.bg, k = cv.width / W.width, ctx = cv.getContext('2d'), out = [];
  for (const x of p.anns.querySelectorAll('.ann-x')) { if (x.dataset.id !== id) continue;
    const r = x.getBoundingClientRect(), b = getComputedStyle(x, '::before'), top = parseFloat(b.top), h = parseFloat(b.height);
    const x0 = Math.round((r.left - W.left) * k), y0 = Math.round((r.top - W.top) * k), w = Math.round(r.width * k), hh = Math.round(r.height * k);
    const d = ctx.getImageData(x0, y0, w, hh).data, rows = [];
    for (let y = 0; y < hh; y++) { let c = 0; for (let i = 0; i < w; i++) { const q = (y * w + i) * 4; if (d[q] + d[q + 1] + d[q + 2] < 450) c++; } rows.push(c); }
    const mx = Math.max(...rows), band = rows.map((c, y) => (c >= mx * 0.35 ? y : -1)).filter((y) => y >= 0);
    const c = top * k, a = band[0], z = band[band.length - 1];
    out.push({ pos: +((c - a) / Math.max(1, z - a)).toFixed(2), band: [+(a / hh).toFixed(3), +(z / hh).toFixed(3)], thick: +(h).toFixed(2), color: b.backgroundColor, lineH: +(r.height).toFixed(1) }); }
  return out; };`;
async function select(pa, A, pb = pa, B = A) {
  if (!(await P.eval(`return __selRange(${pa}, ${JSON.stringify(A)}, ${pb}, ${JSON.stringify(B)})`))) throw new Error('frase non trovata: ' + A + ' … ' + B);
  await P.waitFor(`!document.getElementById('selmenu').hidden && document.getElementById('selmenu').style.visibility!=='hidden'`, 3000, 'menu selezione');
  await sleep(300); // il menu si apre con un'animazione (0,14 s, parte dal 94%): misure solo a fine animazione
}
async function tapMenu(act) { await tap(P, `#selmenu button[data-act="${act}"]`); await sleep(300); }
const anns = (pi = 0) => P.eval(`return (__penna.nb.pages[${pi}].rec.anns||[]).map(a=>({id:a.id,q:a.q,k:a.k||'',s:a.s||'',n:a.n||'',c:a.c,r:a.r.length}))`);
const byQ = async (q, pi = 0) => (await anns(pi)).find((a) => a.q === q);
async function readClip() {
  try { const t = await P.eval('return await navigator.clipboard.readText()'); if (typeof t === 'string') return t; } catch {}
  return P.eval('return window.__clip');
}
// tocco al centro di un segno (Barra/Modifica) sulla pagina
async function tapAnn(id) {
  const c = await P.eval(`const r=[...document.querySelectorAll('.ann-r')].find(x=>x.dataset.id===${JSON.stringify(id)}).getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}`);
  await P.eval('getSelection().removeAllRanges(); return 1'); await sleep(150);
  await tapXY(P, c.x, c.y); await sleep(350);
}

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/bozze.html', HTML); return OUT + '/bozze.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/bozze.pdf', Buffer.from(pr.data, 'base64'));

  try { await P.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch {}
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{ const c=navigator.clipboard; if(c&&c.writeText){ const o=c.writeText.bind(c); c.writeText=(t)=>{ window.__clip=t; return o(t); }; } });` });
  await device(P, 1180, 820);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(SEL_FN + '; return 1');
  ok('app v14 (Safari vecchio emulato, polyfill attivi) e service worker v14', await P.eval(`return __penna.version==='v14' && window.__stripped===true`) && /const VERSION = 'v14'/.test(await P.eval(`return await (await fetch('sw.js',{cache:'no-store'})).text()`)));

  await P.setFiles('#pdf-input', [OUT + '/bozze.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');
  ok('PDF di prova (2 pagine) aperto', await P.eval(`return __penna.nb.pages.length===2 && document.getElementById('errbox').hidden`));
  const help = await P.eval(`return document.getElementById('ann-count').textContent`);
  ok('lista vuota: l’aiuto spiega anche Barra e Modifica', /Evidenzia/.test(help) && /Barra/.test(help) && /da cancellare/.test(help) && /Modifica/.test(help) && /da sostituire/.test(help), help);
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  await sleep(300);

  // ======================= menu =======================
  await select(0, 'Questa frase è inutile e va tolta del tutto.');
  ok('menu: Copia · Evidenzia · Barra · Modifica · Commenta · Copia con commento · Chiedi', await P.eval(`return [...document.querySelectorAll('#selmenu button')].map(b=>b.dataset.act).join(',')==='copy,hl,strike,edit,note,copynote,ask'`) &&
    await P.eval(`return [...document.querySelectorAll('#selmenu button')].map(b=>b.innerText.trim()).slice(2,4).join('|')==='Barra|Modifica'`));
  const icw = await P.eval(`return [!!document.querySelector('#selmenu [data-act=strike] use[href="#i-strike"]'), !!document.querySelector('#selmenu [data-act=edit] use[href="#i-edit"]'), !!document.getElementById('i-strike'), Math.round(document.querySelector('#selmenu [data-act=strike] svg').getBoundingClientRect().width)]`);
  ok('Barra e Modifica: icone SVG dello sprite (#i-strike, #i-edit)', icw.join() === 'true,true,true,20', JSON.stringify(icw));
  const m1 = await rect(P, '#selmenu');
  ok('iPad 1180×820: menu su una riga, dentro lo schermo, pulsanti >= 44px', m1.x >= 0 && m1.x + m1.w <= 1180 && m1.h < 60 && !(await P.eval(`return document.getElementById('selmenu').classList.contains('compact')`)) && (await small(P)).length === 0, JSON.stringify({ m1, small: await small(P) }));
  await shot(P, 'ipad-menu');

  // ======================= Barra =======================
  await tapMenu('strike');
  const d1 = await byQ('Questa frase è inutile e va tolta del tutto.');
  ok('Barra → annotazione «da cancellare» (k=del, rosso), un riquadro', d1 && d1.k === 'del' && d1.c === '#d93025' && d1.r === 1 && !d1.s && !d1.n, JSON.stringify(d1));
  ok('Barra → conferma, menu chiuso, selezione tolta, Annulla attivo', /Barrato: da cancellare/.test(await toastTxt()) && await P.eval(`return document.getElementById('selmenu').hidden && getSelection().isCollapsed && !document.getElementById('btn-undo').disabled`));
  ok('sulla pagina: segno barrato (niente sfondo da evidenziatore)', await P.eval(`const x=[...document.querySelectorAll('.page .ann-x')]; return x.length===1 && getComputedStyle(x[0]).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(x[0]).mixBlendMode==='normal'`));
  const sa = await P.eval(`return __strikeAt(0, ${JSON.stringify(d1.id)})`);
  ok(`linea rossa a metà delle minuscole (posizione ${sa[0] && sa[0].pos} nella fascia delle lettere, spessore ${sa[0] && sa[0].thick} px)`, sa.length === 1 && sa[0].pos > 0.35 && sa[0].pos < 0.65 && sa[0].thick >= 1.5 && sa[0].thick <= 4 && sa[0].color === 'rgb(217, 48, 37)', JSON.stringify(sa));
  ok('linea sopra il testo (livello sopra il disegno della pagina)', await P.eval(`const p=__penna.nb.pages[0]; return [...p.wrap.children].indexOf(p.anns) > [...p.wrap.children].indexOf(p.bg)`));
  await shot(P, 'ipad-barra');

  // Barra su più righe
  const all0 = await P.eval('return __all(0).all');
  const pi0 = all0.indexOf('Riga 1:'), nl = all0.indexOf('\n', pi0);
  const before = all0.slice(pi0, nl).split(' ').slice(-3).join(' '), after = all0.slice(nl + 1).split(' ').slice(0, 2).join(' ');
  await select(0, before, 0, after);
  await tapMenu('strike');
  const d2 = (await anns()).find((a) => a.k === 'del' && a.r === 2);
  ok('Barra su due righe → due tratti rossi (uno per riga): «' + (d2 && d2.q) + '»', !!d2 && (await P.eval(`return [...document.querySelectorAll('.page .ann-x')].filter(x=>x.dataset.id===${JSON.stringify(d2 && d2.id)}).length`)) === 2, JSON.stringify({ before, after, d2 }));

  // ======================= Modifica =======================
  await select(0, 'trenta giorni');
  await tapMenu('edit');
  const dlg = await P.eval(`const t=document.getElementById('cdlg-text'); return {open:document.getElementById('cdlg').open, title:document.getElementById('cdlg-title').textContent, quote:document.getElementById('cdlg-quote').textContent,
    strike:getComputedStyle(document.getElementById('cdlg-quote')).textDecorationLine, label:document.getElementById('cdlg-label').hidden?'':document.getElementById('cdlg-label').textContent, value:t.value, focus:document.activeElement===t, caret:t.selectionStart===t.value.length && t.selectionEnd===t.value.length, ok:document.getElementById('cdlg-ok').textContent}`);
  ok('Modifica → riquadro del commento: testo vecchio sopra (barrato), «Scrivi il testo nuovo» già pieno, cursore in fondo', dlg.open && dlg.title === 'Modifica il testo · pagina 1' && dlg.quote === '«trenta giorni»' && /line-through/.test(dlg.strike) && dlg.label === 'Scrivi il testo nuovo' && dlg.value === 'trenta giorni' && dlg.focus && dlg.caret && dlg.ok === 'Salva', JSON.stringify(dlg));
  ok('riquadro: pulsanti >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-modifica-editor');
  // Salva senza cambiare nulla: resta aperto e lo dice
  await tap(P, '#cdlg-ok'); await sleep(250);
  ok('testo nuovo uguale al vecchio → il riquadro resta aperto con l’avviso', await P.eval(`return document.getElementById('cdlg').open && document.getElementById('cdlg-label').classList.contains('warn') && /ancora uguale/.test(document.getElementById('cdlg-label').textContent)`) && !(await byQ('trenta giorni')));
  await P.eval(`const t=document.getElementById('cdlg-text'); t.select(); return 1`);
  await P.type('sessanta giorni');
  await tap(P, '#cdlg-ok'); await sleep(350);
  const s1 = await byQ('trenta giorni');
  ok('Modifica salvata: «trenta giorni» → «sessanta giorni» (k=sub)', s1 && s1.k === 'sub' && s1.s === 'sessanta giorni' && s1.c === '#d93025' && !(await P.eval(`return document.getElementById('cdlg').open`)) && /Correzione salvata/.test(await toastTxt()), JSON.stringify(s1));
  ok('sulla pagina: testo vecchio barrato + segno ^ + icona nel margine (raggiungibile, 44px)', await P.eval(`return [...document.querySelectorAll('.page .ann-x')].some(x=>x.dataset.id===${JSON.stringify(s1.id)}) && document.querySelectorAll('.page .ann-caret').length===1 && document.querySelectorAll('.page .ann-pin.sub').length===1`) && await reachable(P, '.ann-pin.sub') && (await rect(P, '.ann-pin.sub')).w >= 44);
  const car = await P.eval(`const c=document.querySelector('.page .ann-caret').getBoundingClientRect(), x=[...document.querySelectorAll('.page .ann-x')].find(x=>x.dataset.id===${JSON.stringify(s1.id)}).getBoundingClientRect(); return {cx:c.x+c.width/2-x.right, top:c.top-x.top, xh:x.height, w:c.width, h:c.height}`);
  ok('segno ^ alla fine del testo barrato, sotto la riga', Math.abs(car.cx) < 2 && car.top > car.xh * 0.6 && car.top < car.xh * 1.05 && car.w > 3 && car.h > 3, JSON.stringify(car));
  ok('l’icona dice il testo nuovo (aria-label e title)', await P.eval(`const b=document.querySelector('.ann-pin.sub'); return b.title==='Da sostituire con: «sessanta giorni»' && b.getAttribute('aria-label')===b.title`));
  await shot(P, 'ipad-modifica-pagina');

  // seconda Modifica (per l'ordine nel Markdown)
  await select(0, 'sbagliatta');
  await tapMenu('edit');
  await P.eval(`const t=document.getElementById('cdlg-text'); t.select(); return 1`);
  await P.type('sbagliata');
  await tap(P, '#cdlg-ok'); await sleep(300);
  // un'evidenziazione e un commento normali in mezzo
  await select(0, 'La carità e l');
  await tapMenu('hl');
  await select(0, 'Riga 2: il venditore');
  await tapMenu('note');
  await P.type('Va bene così');
  await tap(P, '#cdlg-ok'); await sleep(300);

  // ======================= toccare per riaprire: Barra ↔ Modifica, elimina, annulla =======================
  await tapAnn(d1.id);
  ok('tocco sul testo barrato → scheda «Da cancellare · pagina 1»', await P.eval(`return document.getElementById('dlg').open && document.getElementById('dlg-title').textContent==='Da cancellare · pagina 1' && document.getElementById('dlg-text').textContent==='«Questa frase è inutile e va tolta del tutto.»'`), await P.eval(`return document.getElementById('dlg-title').textContent`));
  ok('scheda: Sostituisci con un testo nuovo / Copia per Claude Code / Togli la barra (>= 44px)', (await opts()) === 'Sostituisci con un testo nuovo|Copia per Claude Code|Togli la barra' && (await small(P)).length === 0, await opts());
  await shot(P, 'ipad-scheda-barra');
  await tapOpt('Copia per Claude Code');
  const c1 = await readClip();
  ok('Copia per Claude Code (una correzione) → riga CANCELLA con le istruzioni', /\*\*CANCELLA:\*\* «Questa frase è inutile e va tolta del tutto\.»/.test(c1) && /^# bozze\n\n_Istruzioni per Claude/.test(c1), JSON.stringify(c1));
  await tapAnn(d1.id);
  await tapOpt('Sostituisci con un testo nuovo');
  ok('Barra → Modifica: riquadro col testo vecchio già pieno', await P.eval(`return document.getElementById('cdlg').open && document.getElementById('cdlg-text').value==='Questa frase è inutile e va tolta del tutto.' && !document.getElementById('cdlg-label').hidden`));
  await P.eval(`const t=document.getElementById('cdlg-text'); t.select(); return 1`);
  await P.type('Questa frase serve.');
  await tap(P, '#cdlg-ok'); await sleep(300);
  let x1 = await byQ('Questa frase è inutile e va tolta del tutto.');
  ok('…ora è «da sostituire» con «Questa frase serve.» (stesso segno, stesso id)', x1.k === 'sub' && x1.s === 'Questa frase serve.' && x1.id === d1.id && await P.eval(`return document.querySelectorAll('.page .ann-pin.sub').length===3`), JSON.stringify(x1));
  // tocco sull'icona del margine (anche con la penna)
  await tap(P, '#tool-pen'); await sleep(150);
  const pinOf = (id) => P.eval(`const b=[...document.querySelectorAll('.ann-pin.sub')].find(b=>b.dataset.id===${JSON.stringify(id)}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
  let pc = await pinOf(d1.id); await tapXY(P, pc.x, pc.y); await sleep(350);
  ok('con la penna: tocco sul ^ nel margine → «Da sostituire» col testo nuovo visibile', await P.eval(`return document.getElementById('dlg').open && document.getElementById('dlg-title').textContent==='Da sostituire · pagina 1' && document.getElementById('dlg-text').textContent.includes('→ «Questa frase serve.»')`));
  ok('scheda: Modifica il testo nuovo / Solo da cancellare / Copia per Claude Code / Elimina la correzione', (await opts()) === 'Modifica il testo nuovo|Solo da cancellare|Copia per Claude Code|Elimina la correzione', await opts());
  await shot(P, 'ipad-scheda-modifica');
  await tapOpt('Solo da cancellare');
  x1 = await byQ('Questa frase è inutile e va tolta del tutto.');
  ok('Modifica → Barra: torna «da cancellare», testo nuovo tolto, niente ^', x1.k === 'del' && !x1.s && await P.eval(`return document.querySelectorAll('.page .ann-pin.sub').length===2 && document.querySelectorAll('.page .ann-caret').length===2`));
  await tap(P, '#btn-undo'); await sleep(300);
  x1 = await byQ('Questa frase è inutile e va tolta del tutto.');
  ok('Annulla → di nuovo «da sostituire con Questa frase serve.»', x1.k === 'sub' && x1.s === 'Questa frase serve.');
  // Modifica il testo nuovo: svuotato = solo da cancellare
  pc = await pinOf(d1.id); await tapXY(P, pc.x, pc.y); await sleep(350);
  await tapOpt('Modifica il testo nuovo');
  ok('Modifica il testo nuovo → riquadro col testo nuovo di prima', await P.eval(`return document.getElementById('cdlg').open && document.getElementById('cdlg-text').value==='Questa frase serve.' && document.getElementById('cdlg-quote').textContent==='«Questa frase è inutile e va tolta del tutto.»'`));
  await P.eval(`document.getElementById('cdlg-text').value=''; return 1`);
  await tap(P, '#cdlg-ok'); await sleep(300);
  x1 = await byQ('Questa frase è inutile e va tolta del tutto.');
  ok('testo nuovo vuoto → resta solo da cancellare', x1.k === 'del' && !x1.s && /resta da cancellare/.test(await toastTxt()));
  // Elimina (Togli la barra) e Annulla
  await tap(P, '#tool-select'); await sleep(200);
  await tapAnn(d2.id);
  await tapOpt('Togli la barra');
  ok('Togli la barra → sparita (pagina e dati)', !(await anns()).some((a) => a.id === d2.id) && (await P.eval(`return [...document.querySelectorAll('.page .ann-x')].filter(x=>x.dataset.id===${JSON.stringify(d2.id)}).length`)) === 0);
  await tap(P, '#btn-undo'); await sleep(300);
  ok('Annulla → torna (due righe barrate)', (await anns()).some((a) => a.id === d2.id && a.r === 2));

  // ======================= più pagine =======================
  await P.eval('__penna.goToPage(0, 0.82); return 1');
  await P.waitFor(`__penna.nb.pages[1].tl && __penna.nb.pages[1].tl.end && __penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 15000, 'livello di testo su 2 pagine');
  await sleep(300);
  await select(0, 'con un pensiero che continua', 1, 'senza interruzione.');
  await tapMenu('edit');
  ok('Modifica su due pagine: il riquadro mostra tutto il testo scelto', await P.eval(`return document.getElementById('cdlg-text').value==='con un pensiero che continua nella pagina due senza interruzione.'`), await P.eval(`return document.getElementById('cdlg-text').value`));
  await P.eval(`const t=document.getElementById('cdlg-text'); t.select(); return 1`);
  await P.type('con un pensiero breve.');
  await tap(P, '#cdlg-ok'); await sleep(350);
  const mp = [(await anns(0)).find((a) => a.q === 'con un pensiero che continua'), (await anns(1)).find((a) => a.q === 'nella pagina due senza interruzione.')];
  ok('…pagina 1 «da sostituire» col testo nuovo, pagina 2 «da cancellare» (un solo Annulla)', mp[0] && mp[0].k === 'sub' && mp[0].s === 'con un pensiero breve.' && mp[1] && mp[1].k === 'del' && /su 2 pagine/.test(await toastTxt()), JSON.stringify(mp));

  // ======================= pannello =======================
  await tap(P, '#btn-notes'); await sleep(450);
  const rows = await P.eval(`return [...document.querySelectorAll('#ann-list .ann-row')].map(b=>({b:b.querySelector('b').textContent, k:b.querySelector('.kind')?b.querySelector('.kind').textContent:'', q:b.querySelector('.q').textContent, x:b.querySelector('.q').classList.contains('x'), nt:b.querySelector('.nt')?b.querySelector('.nt').textContent:''}))`);
  ok('pannello: etichette «Da cancellare» / «Da sostituire», testo vecchio barrato, «→ testo nuovo»', rows.some((r) => r.k === 'Da sostituire' && r.q === '«trenta giorni»' && r.x && r.nt === '→ «sessanta giorni»') && rows.some((r) => r.k === 'Da cancellare' && r.q === '«Questa frase è inutile e va tolta del tutto.»' && r.x) && rows.some((r) => !r.k && r.q === '«La carità e l»' && !r.x), JSON.stringify(rows));
  ok('pannello: in ordine di libro (pagina, poi dall’alto)', rows.map((r) => r.q).join('|').startsWith('«Il contratto') || rows.findIndex((r) => r.q === '«trenta giorni»') < rows.findIndex((r) => r.q === '«Questa frase è inutile e va tolta del tutto.»'), JSON.stringify(rows.map((r) => r.b + ' ' + r.q)));
  const cnt = await P.eval(`return document.getElementById('ann-count').textContent`);
  ok('riepilogo: «1 commento · 1 evidenziazione · 3 da cancellare · 3 da sostituire»', cnt === '1 commento · 1 evidenziazione · 3 da cancellare · 3 da sostituire', cnt);
  ok('pannello: comandi >= 44px', (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-pannello');

  // ======================= Markdown =======================
  await tap(P, '#btn-md-copy'); await sleep(300);
  const md = await readClip(), mdExp = await P.eval('return __penna.allMarkdown()');
  ok('Copia tutto in Markdown → appunti (8 voci)', md === mdExp && /Copiate 8 voci/.test(await toastTxt()), JSON.stringify(md).slice(0, 300));
  ok('Markdown: in testa la riga che spiega CANCELLA e SOSTITUISCI', md.split('\n')[4] === (await P.eval('return __penna.N.FIX_HELP')) && /^# bozze\n\n_Evidenziazioni, commenti e correzioni da PDF Penna · .+ · 8 voci_\n\n_Istruzioni per Claude/.test(md), md.split('\n').slice(0, 5).join(' / '));
  ok('Markdown: «- p. 1 · **SOSTITUISCI** «trenta giorni» → «sessanta giorni»»', md.includes('\n- p. 1 · **SOSTITUISCI** «trenta giorni» → «sessanta giorni»\n'));
  ok('Markdown: «- p. 1 · **CANCELLA:** «Questa frase è inutile…»»', md.includes('\n- p. 1 · **CANCELLA:** «Questa frase è inutile e va tolta del tutto.»\n'));
  ok('Markdown: pagina 2 col suo CANCELLA', md.includes('## Pagina 2\n- p. 2 · **CANCELLA:** «nella pagina due senza interruzione.»\n'));
  const ord = ['«trenta giorni»', '«Questa frase è inutile', '«sbagliatta»', '> "La carità e l"', '«' + d2.q + '»', '> "Riga 2: il venditore"', '«con un pensiero che continua» → «con un pensiero breve.»', '## Pagina 2'].map((t) => md.indexOf(t));
  ok('Markdown: tutto nell’ordine del libro', ord.every((v, i) => v > 0 && (!i || v > ord[i - 1])), JSON.stringify(ord) + '\n' + md);
  ok('Markdown: evidenziazione e commento come prima', md.includes('\n\n> "La carità e l"\n\n- p. 1') && md.includes('\n\n> "Riga 2: il venditore"\n\n**Commento:** Va bene così\n\n- p. 1'));
  fs.writeFileSync(OUT + '/fase10.md', md);
  await tap(P, '#btn-pages'); await sleep(300);

  // ======================= miniature e ricerca =======================
  const th = await P.eval(`const u=await __penna.thumbUrl(__penna.nb.pages[0].rec); const im=new Image(); im.src=u; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data; let red=0; for(let i=0;i<d.length;i+=4) if(d[i]>150&&d[i]-d[i+1]>70&&d[i]-d[i+2]>70) red++; return red`);
  ok('miniatura della pagina: si vedono le barre rosse', th > 20, String(th));
  await P.eval(`await __penna.runFind('sessanta'); return 1`);
  ok('Cerca nel quaderno trova anche il testo nuovo («sessanta»)', await P.eval(`return document.querySelectorAll('#find-list .fhit').length===1`));

  // ======================= riavvio: tutto resta =======================
  const before10 = JSON.stringify([await anns(0), await anns(1)]);
  await tap(P, '#btn-save'); await sleep(500);
  await P.reload();
  await P.waitFor(`window.__penna && !document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'riavvio');
  await P.eval(SEL_FN + '; return 1');
  await P.eval('__penna.goToPage(0); return 1'); await sleep(500);
  await tap(P, '#tool-select'); await sleep(300);
  ok('dopo il riavvio: Barra e Modifica ci sono ancora (dati identici)', JSON.stringify([await anns(0), await anns(1)]) === before10);
  ok('dopo il riavvio: disegnate sulla pagina (barre, ^, icone) e nel pannello', await P.eval(`return document.querySelectorAll('.page .ann-x').length>=7 && document.querySelectorAll('.page .ann-caret').length===3 && document.querySelectorAll('.page .ann-pin.sub').length===3 && document.querySelectorAll('#ann-list .ann-row .kind').length===6`),
    await P.eval(`return [document.querySelectorAll('.page .ann-x').length, document.querySelectorAll('.page .ann-caret').length, document.querySelectorAll('.page .ann-pin.sub').length, document.querySelectorAll('#ann-list .ann-row .kind').length].join(',')`));
  ok('dopo il riavvio: Markdown identico', (await P.eval('return __penna.allMarkdown()')) === mdExp);

  // ======================= export PDF =======================
  const ex = await P.eval(`const b=await __penna.exportBytes(); const m=await __penna.pdfjs(); const task=m.getDocument({data:b.slice(0), standardFontDataUrl:'./lib/standard_fonts/'}); const d=await task.promise; const pg=await d.getPage(1);
    const ann=(await pg.getAnnotations()).filter(a=>a.subtype==='Text').map(a=>a.contentsObj&&a.contentsObj.str);
    const vp=pg.getViewport({scale:2}); const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height; await pg.render({canvas:c, canvasContext:c.getContext('2d'), viewport:vp}).promise;
    const x=c.getContext('2d'), red=(px)=>px[0]>170&&px[1]<120&&px[2]<120;
    const row=(r,f)=>{ const y=Math.round((r.t+r.h*f)*vp.height), x0=Math.round(r.l*vp.width), w=Math.round(r.w*vp.width); let n=0; for(let k=-2;k<=2;k++){ const d=x.getImageData(x0,y+k,w,1).data; let m=0; for(let i=0;i<d.length;i+=4) if(red([d[i],d[i+1],d[i+2]])) m++; n=Math.max(n,m/w); } return n; };
    const a=__penna.nb.pages[0].rec.anns.find(q=>q.q==='Questa frase è inutile e va tolta del tutto.'), r=a.r[0];
    const s=__penna.nb.pages[0].rec.anns.find(q=>q.q==='trenta giorni'), rs=s.r[s.r.length-1];
    const cy=Math.round((rs.t+rs.h)*vp.height), cx=Math.round((rs.l+rs.w)*vp.width); const cd=x.getImageData(cx-12,cy-14,24,22).data; let caret=0; for(let i=0;i<cd.length;i+=4) if(red([cd[i],cd[i+1],cd[i+2]])) caret++;
    const out={ann, line:+row(r,0.52).toFixed(2), top:+row(r,0.12).toFixed(2), caret, n:d.numPages, size:b.length}; await task.destroy(); return out`);
  ok('export PDF: linea rossa sopra il testo barrato (e non un riquadro colorato)', ex.line > 0.6 && ex.top < 0.1, JSON.stringify(ex));
  ok('export PDF: segno ^ rosso alla fine del testo da sostituire', ex.caret > 6, JSON.stringify(ex));
  ok('export PDF: note col testo nuovo (Sostituisci con: «…») e il commento', ex.ann.includes('Sostituisci con: «sessanta giorni»') && ex.ann.includes('Sostituisci con: «sbagliata»') && ex.ann.includes('Va bene così') && ex.ann.length === 4 && ex.n === 2, JSON.stringify(ex.ann));
  ok('export PDF: nessun errore', await P.eval('return document.getElementById("errbox").hidden'));

  // ======================= iPad in verticale e iPhone =======================
  for (const [w, h, dpr, name] of [[820, 1180, 2, 'iPad verticale 820×1180'], [390, 844, 3, 'iPhone 390×844']]) {
    await device(P, w, h, dpr); await sleep(700);
    await P.eval('__penna.goToPage(0, 0.1); return 1');
    try { await P.waitFor(`__penna.nb.pages[0].wrap.dataset.rendered==='1' && __penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 15000, name); }
    catch (e) { console.log(await P.eval(`const p=__penna.nb.pages[0]; return JSON.stringify({r:p.wrap.dataset.rendered, rendered:p.rendered, tl:!!p.tl, end:!!(p.tl&&p.tl.end), tool:__penna.S.tool, pg:!!p.pg, nb:!document.getElementById('notebook').hidden, cw:p.cw, iw:innerWidth})`)); throw e; }
    await sleep(500);
    await select(0, 'Una parola');
    const m = await rect(P, '#selmenu'), cls = await P.eval(`return document.getElementById('selmenu').className`);
    const bar = await rect(P, '.pillbar.mid');
    ok(`${name}: menu dentro lo schermo (${cls || 'una riga'}), sopra la barra strumenti`, m.x >= 0 && m.x + m.w <= w && m.y > 50 && (m.y + m.h <= bar.y || m.y > bar.y + bar.h), JSON.stringify({ m, bar }));
    ok(`${name}: pulsanti >= 44px, parole non tagliate, Barra e Modifica raggiungibili`, (await small(P)).length === 0 && await P.eval(`return [...document.querySelectorAll('#selmenu button')].every(b=>b.scrollWidth<=b.clientWidth+1)`) && await reachable(P, '#selmenu [data-act=strike]') && await reachable(P, '#selmenu [data-act=edit]'), JSON.stringify(await small(P)));
    await shot(P, 'menu-' + w);
    if (w === 390) {
      await tapMenu('strike');
      ok('iPhone: Barra col tocco', (await anns()).some((a) => a.q === 'Una parola' && a.k === 'del'));
    } else await P.eval('getSelection().removeAllRanges(); return 1');
  }

  ok('nessun errore a schermo', await P.eval('return document.getElementById("errbox").hidden'), await P.eval('return document.getElementById("err-msg").textContent'));
  const errs = P.logs.filter((l) => /^(EXC|error)/.test(l));
  ok('nessun errore JS in console', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-8).join('\n')); }
P.close();
console.log(`\nRISULTATO: ${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
