// Test della fase 9 nel browser (Safari vecchio emulato), con il bridge VERO + Ollama e Tavily finti.
// A. Pannello Chiedi: maniglia, tre altezze (compatto / metà / quasi tutto schermo) con scatto, tocco che cicla, trascinamento
//    anche dal titolo, chiusura tirando giù (oltre soglia o con una spinta), tastiera iOS simulata (visualViewport finto:
//    il pannello sale sopra la tastiera e la risposta resta visibile). iPad 1024×768 e verticale 768×1024, iPhone 390×844,
//    tema chiaro e scuro, screenshot.
// B. Ricerca intelligente nell'app: il contesto mandato al Mac (web_ctx), «Scelgo cosa cercare…», «Ho cercato: …»,
//    «Modifica ricerca» che rilancia con le ricerche corrette, «Non ho trovato fonti affidabili», Copia e Salva con le ricerche.
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase9.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, tapXY, tap, touch, small } from './touch.mjs';
import { startOllama } from './fakeollama.mjs';
import { startTavily, KEY } from './faketavily.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
const SHOTS = OUT + '/shots9'; fs.mkdirSync(SHOTS, { recursive: true });
const CDP = 9393;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + String(extra).slice(0, 1200) : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };

// ---------- bridge vero + finto Ollama + finto Tavily ----------
const PY = execFileSync('/usr/bin/which', ['python3']).toString().trim();
const HOME = fs.mkdtempSync(os.tmpdir() + '/sb-e2e9-');
const TOKEN = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(HOME + '/token', TOKEN + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/tavily.key', KEY + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ port: 8768, ollama_url: 'http://127.0.0.1:11968', tavily_url: 'http://127.0.0.1:11969', allowed_origins: ['https://bifulcma.github.io', ORIGIN] }));
const ol = await startOllama(11968, { delay: 40, planDelay: 700 });
const tv = await startTavily(11969, { delay: 400 });
const blog = HOME + '/bridge.log';
const benv = { ...process.env, STUDIO_BRIDGE_HOME: HOME }; delete benv.TAVILY_API_KEY;
const bridge = spawn(PY, [new URL('../studio-bridge/bridge.py', import.meta.url).pathname], { env: benv, stdio: ['ignore', fs.openSync(blog, 'a'), fs.openSync(blog, 'a')] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8768/')).ok) break; } catch {} await sleep(100); }
const BURL = 'http://127.0.0.1:8768';

const SUF = 'Allora sterminerà le armate del tiranno Sufyani e riempirà la terra di giustizia.';
const REAL_HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 13pt; line-height: 1.5; color: #111; }
h1 { font-family: "Helvetica Neue", Helvetica, sans-serif; font-size: 22pt; margin: 0 0 10pt; } p { margin: 0 0 9pt; text-align: justify; }
</style><h1>Il ritorno del Mahdi</h1>
<p>Dopo il lungo occultamento, il Mahdi tornerà alla fine dei tempi.</p>
<p>${SUF}</p>
<p>Questi racconti appartengono alla tradizione escatologica e vanno letti con le loro fonti.</p>
</html>`;

// visualViewport finto (come Safari su iPad): __kb(px) = tastiera alta px; innerHeight resta uguale, il visibile si accorcia
const VV = `(() => { const real = window.visualViewport; let kb = 0; const et = new EventTarget();
  const fake = { get height() { return innerHeight - kb; }, get width() { return innerWidth; }, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a) };
  if (real) { real.addEventListener('resize', () => et.dispatchEvent(new Event('resize'))); }
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.__kb = (px) => { kb = px; et.dispatchEvent(new Event('resize')); }; })();`;

process.env.UA = 'ipad';
const P = await browser(CDP, 'strip');
const q = (expr) => P.eval('return ' + expr);
const st = (k) => q(`__penna.ask.st.${k}`);
const dlgOpt = (label) => P.eval(`const b=[...document.querySelectorAll('#dlg-options button, #dlg-options label')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
const SEL_FN = `window.__sel = function (pi, phrase) {
  const p = __penna.nb.pages[pi], tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => n.nodeType === 3 || n.nodeName === 'BR' ? 1 : 3 });
  const parts = []; let all = '';
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const t = n.nodeType === 3 ? n.data : '\\n'; parts.push([n, all.length, t.length]); all += t; }
  const i = all.indexOf(phrase); if (i < 0) return false; const j = i + phrase.length;
  const a = parts.find(([n, s, l]) => n.nodeType === 3 && i >= s && i < s + l), b = parts.find(([n, s, l]) => n.nodeType === 3 && j > s && j <= s + l);
  const r = document.createRange(); r.setStart(a[0], i - a[1]); r.setEnd(b[0], j - b[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; };`;
async function select(phrase) {
  if ((await q(`__penna.S.tool`)) !== 'select') await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  if (!(await P.eval(`return __sel(0, ${JSON.stringify(phrase)})`))) throw new Error('frase non trovata: ' + phrase);
  await P.waitFor(`!document.getElementById('selmenu').hidden && document.getElementById('selmenu').style.visibility!=='hidden'`, 3000, 'menu selezione');
  await sleep(120);
}
async function openFromSel(phrase = SUF.slice(0, -1)) {
  await select(phrase);
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden && !document.getElementById('ask-main').hidden`, 3000, 'pannello');
  await sleep(450);
}
async function setField(sel, value) { await P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); return 1`); }
async function follow(ms = 30000) {
  const seen = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await P.eval(`const st=__penna.ask.st; return [st.busy, [...document.querySelectorAll('#ask-answer .ask-search')].map(x=>x.textContent), document.getElementById('ask-queries').hidden ? '' : document.getElementById('ask-queries-t').textContent]`);
    for (const x of s[1]) seen.add(x);
    if (s[2]) seen.add('ROW ' + s[2]);
    if (!s[0]) break;
    await sleep(40);
  }
  await sleep(150);
  return [...seen];
}
// pannello: posizione, altezza, cosa si vede
const panel = () => P.eval(`const a=document.getElementById('ask'), r=a.getBoundingClientRect(), c=a.querySelector('.ask-ctl'), an=document.getElementById('ask-answer').getBoundingClientRect(), sz=__penna.ask.sizes();
  return { top: r.top, bottom: r.bottom, h: r.height, x: r.x, w: r.width, snap: __penna.ask.st.snap, cls: a.className, ctl: !!c.offsetParent, ansTop: an.top, ansH: an.height, sz, ih: innerHeight, iw: innerWidth, hidden: a.hidden }`);
const settle = () => sleep(420); // l'altezza cambia con un'animazione di 0,26 s
// trascinamento col dito: i tempi degli eventi sono quelli voluti (timestamp), così la velocità non dipende dalla lentezza di CDP
async function drag(sel, dy, { steps = 10, ms = 50, dyAt = 0 } = {}) {
  const r = await rect(P, sel); const x = r.cx, y0 = r.cy + dyAt;
  let ts = Date.now() / 1000;
  const ev = (type, y) => P.send('Input.dispatchTouchEvent', { type, timestamp: ts, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await ev('touchStart', y0);
  for (let i = 1; i <= steps; i++) { ts += ms / 1000; await sleep(Math.min(ms, 30)); await ev('touchMove', y0 + (dy * i) / steps); }
  ts += ms / 1000; await sleep(Math.min(ms, 30)); await ev('touchEnd', y0 + dy); await settle();
}
const near = (a, b, d = 3) => Math.abs(a - b) <= d;

// controlli della geometria con un certo schermo: le tre altezze, tocco che cicla, nessun pulsante piccolo
async function checkSnaps(tag, W, H, bottomGap) {
  let p = await panel();
  ok(`${tag}: si apre a «metà» (${Math.round(p.h)} px), attaccato in basso, comandi visibili, dentro lo schermo`, p.snap === 'half' && p.cls.includes('snap-half') && near(p.bottom, H - bottomGap) && p.top >= 8 && p.ctl && p.x >= 0 && p.x + p.w <= W + 0.5, JSON.stringify(p));
  ok(`${tag}: tre altezze diverse in ordine: compatto ${p.sz.compact} < metà ${p.sz.half} < quasi tutto ${p.sz.full}`, p.sz.compact < p.sz.half && p.sz.half < p.sz.full && near(p.h, p.sz.half, 2), JSON.stringify(p.sz));
  ok(`${tag}: nessun pulsante sotto i 44 px; la maniglia ha ruolo «button» e un’etichetta`, (await small(P)).length === 0 && await q(`document.getElementById('ask-grip').getAttribute('role')==='button' && /Maniglia/.test(document.getElementById('ask-grip').getAttribute('aria-label'))`), JSON.stringify(await small(P)));
  await shot(P, `${tag}-meta`);
  await tap(P, '#ask-grip'); await settle(); p = await panel();
  ok(`${tag}: tocco sulla maniglia → quasi tutto schermo (in alto a ${Math.round(p.top)} px)`, p.snap === 'full' && near(p.h, p.sz.full, 2) && p.top >= 8 && p.top <= 60 && near(p.bottom, H - bottomGap), JSON.stringify(p));
  await shot(P, `${tag}-tutto`);
  await tap(P, '#ask-grip'); await settle(); p = await panel();
  ok(`${tag}: altro tocco → compatto: solo domanda e risposta (comandi nascosti)`, p.snap === 'compact' && near(p.h, p.sz.compact, 2) && !p.ctl && p.ansH >= 60 && (await small(P)).length === 0, JSON.stringify(p));
  await shot(P, `${tag}-compatto`);
  await tap(P, '#ask-grip'); await settle(); p = await panel();
  ok(`${tag}: altro tocco → di nuovo metà (cicla)`, p.snap === 'half' && p.ctl, JSON.stringify(p));
}

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/Il ritorno del Mahdi.html', REAL_HTML); return OUT + '/Il ritorno del Mahdi.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/Il ritorno del Mahdi.pdf', Buffer.from(pr.data, 'base64'));
  try { await P.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch {}
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Page.addScriptToEvaluateOnNewDocument', { source: VV + `addEventListener('DOMContentLoaded',()=>{ const c=navigator.clipboard; if(c&&c.writeText){ const o=c.writeText.bind(c); c.writeText=(t)=>{ window.__clip=t; return o(t); }; } });` });
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  // Mac Studio già collegato (come dopo «Prova connessione»), avvisi già letti, «Cerca sul web» acceso, Qwen
  await P.eval(`localStorage.setItem('penna.ai', JSON.stringify({ url: ${JSON.stringify(BURL)}, token: ${JSON.stringify(TOKEN)}, privacy: 1, webPrivacy: 1, web: true, src: 'qwen', model: {} })); return 1`);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(SEL_FN + '; return 1');
  ok('versione v10, visualViewport finto attivo', await q(`__penna.version==='v10' && typeof window.__kb==='function' && window.__stripped===true`));
  await P.setFiles('#pdf-input', [OUT + '/Il ritorno del Mahdi.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');

  // ======================= A. pannello su iPad orizzontale =======================
  await openFromSel();
  ok('pannello vuoto: «La risposta comparirà qui…» spiega anche la barretta', /La risposta comparirà qui\. Per avere più spazio, trascina in su la barretta/.test(await q(`document.getElementById('ask-answer').textContent`)));
  await checkSnaps('ipad', 1024, 768, 12);
  // trascinamento lento: dalla metà in su → scatta su «quasi tutto»
  let p = await panel();
  await drag('#ask-grip', -(p.sz.full - p.sz.half) * 0.7); p = await panel();
  ok('trascino la maniglia in su (lento) → scatta su «quasi tutto schermo»', p.snap === 'full' && near(p.h, p.sz.full, 2), JSON.stringify(p));
  await drag('#ask-grip', (p.sz.full - p.sz.half) * 0.75, { ms: 80 }); p = await panel();
  ok('trascino in giù fino quasi a metà → scatto magnetico su «metà»', p.snap === 'half' && near(p.h, p.sz.half, 2), JSON.stringify(p));
  await drag('#ask-title', -60, { steps: 2, ms: 25 }); p = await panel();
  ok('si trascina anche dal titolo «Chiedi», e una spinta veloce verso l’alto porta su «quasi tutto»', p.snap === 'full', JSON.stringify([p, await st('fling')]));
  await tap(P, '.ask-src button[data-src="claude"]'); await sleep(150);
  ok('i pulsanti nel titolo (Qwen/Claude, X) funzionano ancora: tocco su Claude → Claude, il pannello non si sposta', (await st('src')) === 'claude' && (await panel()).snap === 'full');
  await tap(P, '.ask-src button[data-src="qwen"]'); await sleep(150);
  await P.eval(`__penna.ask.snap('compact'); return 1`); await settle(); p = await panel();
  await drag('#ask-grip', 40, { steps: 4, ms: 60 }); p = await panel();
  ok('dal compatto, un piccolo trascinamento in giù → resta aperto (compatto)', !p.hidden && p.snap === 'compact', JSON.stringify(p));
  await drag('#ask-grip', 130, { steps: 10, ms: 50 });
  ok('dal compatto, trascinato in giù oltre la soglia → si chiude', await q(`document.getElementById('ask').hidden`));
  await openFromSel();
  await P.eval(`__penna.ask.snap('compact'); return 1`); await settle();
  await drag('#ask-grip', 50, { steps: 3, ms: 12 });
  ok('dal compatto, una spinta veloce in giù → si chiude', await q(`document.getElementById('ask').hidden`), JSON.stringify(await st('fling')));
  await openFromSel();
  ok('riaperto: di nuovo a «metà»', (await panel()).snap === 'half');
  await P.eval(`document.getElementById('ask-grip').focus(); return 1`);
  await P.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }); await P.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }); await settle();
  ok('da tastiera: maniglia + freccia su → «quasi tutto»', (await panel()).snap === 'full');
  await P.eval(`__penna.ask.snap('half'); document.activeElement.blur(); return 1`); await settle();

  // ======================= B. ricerca intelligente (Qwen finto + bridge vero) =======================
  const p0 = ol.st.plans.length, t0 = tv.st.requests.length;
  await tap(P, '#ask-acts button[data-act="explain"]');
  await P.waitFor(`!!document.querySelector('#ask-answer .ask-search')`, 4000, 'stato');
  await shot(P, 'ipad-scelgo-cosa-cercare');
  const seen = await follow();
  const sent = await st('sent');
  ok('all’app: «Scelgo cosa cercare…», poi «Sto cercando: «Sufyani escatologia sciita»…»', seen.includes('Scelgo cosa cercare…') && seen.includes('Sto cercando: «Sufyani escatologia sciita»…'), JSON.stringify(seen));
  ok('al Mac va il contesto (web_ctx): titolo, richiesta, frase, pagina 1, testo intorno; niente web_queries', sent.web === true && sent.web_ctx.title === 'Il ritorno del Mahdi' && sent.web_ctx.quote === SUF.slice(0, -1) && sent.web_ctx.page === 1 && /^Spiega il testo selezionato/.test(sent.web_ctx.question) && /occultamento/.test(sent.web_ctx.near) && !('web_queries' in sent), JSON.stringify(sent.web_ctx));
  ok('CASO REALE nell’app: Qwen ha scelto la ricerca, a Tavily «Sufyani escatologia sciita» (non «tiranno», non la frase)', ol.st.plans.length === p0 + 1 && JSON.stringify(tv.st.requests.slice(t0).map((r) => r.body.query)) === JSON.stringify(['Sufyani escatologia sciita']), JSON.stringify(tv.st.requests.slice(t0).map((r) => r.body.query)));
  const row = () => P.eval(`const r=document.getElementById('ask-queries'); return { shown: !r.hidden, t: document.getElementById('ask-queries-t').textContent, poor: document.getElementById('ask-poor').hidden ? '' : document.getElementById('ask-poor').textContent, btn: !document.getElementById('ask-qedit-open').hidden, bh: document.getElementById('ask-qedit-open').getBoundingClientRect().height, label: document.getElementById('ask-qedit-open').innerText.trim() }`);
  let rw = await row();
  ok('sopra la risposta: «Ho cercato: Sufyani escatologia sciita» e il pulsante «Modifica ricerca» (44 px)', rw.shown && rw.t === 'Ho cercato: Sufyani escatologia sciita' && rw.btn && rw.bh >= 44 && rw.label === 'Modifica ricerca' && !rw.poor, JSON.stringify(rw));
  ok('mentre cercava, la riga diceva «Ricerche: …»', seen.includes('ROW Ricerche: Sufyani escatologia sciita'), JSON.stringify(seen));
  ok('fonti sotto la risposta: le citate [1] [2] = Wikipedia e il blog (reddit, quora e la pagina sul «tiranno» tolte dal Mac)', await q(`[...document.querySelectorAll('#ask-answer .ask-sources a')].map(a=>a.getAttribute('href')).slice(0,2).join()==='https://en.wikipedia.org/wiki/Sufyani,https://blog.example/sufyani'`), await q(`[...document.querySelectorAll('#ask-answer .ask-sources a')].map(a=>a.getAttribute('href'))`));
  await shot(P, 'ipad-ho-cercato');
  // Modifica ricerca → Annulla
  await tap(P, '#ask-qedit-open'); await sleep(200);
  ok('«Modifica ricerca» → riquadro con le ricerche (una per riga), «Cerca di nuovo» e «Annulla»', await q(`!document.getElementById('ask-qedit').hidden && document.getElementById('ask-queries').hidden && document.getElementById('ask-qedit-input').value==='Sufyani escatologia sciita' && document.activeElement===document.getElementById('ask-qedit-input')`) && (await small(P)).length === 0, JSON.stringify(await small(P)));
  await shot(P, 'ipad-modifica-ricerca');
  await tap(P, '#ask-qedit-cancel'); await sleep(150);
  ok('«Annulla» → torna la riga «Ho cercato», nessuna ricerca partita', await q(`document.getElementById('ask-qedit').hidden && !document.getElementById('ask-queries').hidden`) && tv.st.requests.length === t0 + 1);
  // Modifica ricerca → Cerca di nuovo
  await tap(P, '#ask-qedit-open'); await sleep(150);
  await setField('#ask-qedit-input', 'al-Sufyani Mahdi\n«Sufyani» hadith\n');
  const p1 = ol.st.plans.length, t1 = tv.st.requests.length;
  await tap(P, '#ask-qedit-go');
  const seen2 = await follow();
  const sent2 = await st('sent');
  ok('«Cerca di nuovo» → stessa richiesta, con web_queries = le due ricerche scritte (pulite); il Mac non ne sceglie altre', JSON.stringify(sent2.web_queries) === JSON.stringify(['al-Sufyani Mahdi', 'Sufyani hadith']) && ol.st.plans.length === p1 && JSON.stringify(tv.st.requests.slice(t1).map((r) => r.body.query)) === JSON.stringify(['al-Sufyani Mahdi', 'Sufyani hadith']) && /^Spiega/.test(sent2.web_ctx.question), JSON.stringify([sent2.web_queries, tv.st.requests.slice(t1).map((r) => r.body.query)]));
  rw = await row();
  ok('…e la riga ora dice «Ho cercato: al-Sufyani Mahdi; Sufyani hadith»; la risposta nuova è arrivata', rw.t === 'Ho cercato: al-Sufyani Mahdi; Sufyani hadith' && seen2.includes('Sto cercando: «al-Sufyani Mahdi»…') && (await st('answer')).length > 20 && !(await st('error')), JSON.stringify([rw, seen2]));
  const t2 = tv.st.requests.length;
  await tap(P, '#ask-retry'); await follow();
  ok('«Riprova» ripete con le ricerche corrette a mano', JSON.stringify((await st('sent')).web_queries) === JSON.stringify(['al-Sufyani Mahdi', 'Sufyani hadith']) && tv.st.requests.length === t2 + 2);
  // Copia e Salva come commento: anche le ricerche
  await tap(P, '#ask-copy'); await sleep(250);
  ok('Copia → risposta + «Ho cercato: …» + «Fonti:»', /\n\nHo cercato: al-Sufyani Mahdi; Sufyani hadith\n\nFonti:\n1\. /.test(await q('window.__clip')), await q('window.__clip'));
  await tap(P, '#ask-save'); await sleep(300);
  const ann = await P.eval(`const l=__penna.nb.pages[0].rec.anns||[]; const a=l[l.length-1]; return a ? a.n : ''`);
  ok('Salva come commento → anche «Ho cercato: …» (finisce nel Markdown per Claude Code)', ann.startsWith('✦ Spiega — Qwen · web\n\n') && ann.includes('\n\nHo cercato: al-Sufyani Mahdi; Sufyani hadith\n\nFonti:\n1. ') && (await q(`__penna.allMarkdown()`)).includes('Ho cercato: al-Sufyani Mahdi; Sufyani hadith'), ann.slice(-400));
  // bridge della fase 8 ancora sul Mac (versione 2): l'app lo dice; appena risponde la versione 3, l'avviso sparisce
  await P.eval(`__penna.ask.cfg.health = { qwen: { ok: true }, claude: { ok: true }, web_claude: { ok: true, error: '' }, web_qwen: { ok: true }, version: '2' }; document.querySelector('.ask-src button[data-src=qwen]').click(); return 1`); await sleep(100);
  ok('Mac Studio col bridge vecchio (v2): «Ricerche poco mirate: aggiorna il Mac Studio (rilancia l’installazione)» in rosso', await q(`document.getElementById('ask-web-note').textContent==='Ricerche poco mirate: aggiorna il Mac Studio (rilancia l’installazione)' && document.getElementById('ask-web-note').classList.contains('warn')`), await q(`document.getElementById('ask-web-note').textContent`));
  // fonti scarse
  await setField('#ask-input', 'SEMPRE-SCARSO: chi è costui?');
  await tap(P, '#ask-send');
  const seen3 = await follow();
  ok('…il Mac risponde «versione 3» → l’avviso sparisce da solo', await q(`__penna.ask.cfg.health.version==='3' && document.getElementById('ask-web-note').textContent==='Qwen sceglie le ricerche, legge le fonti migliori (Tavily) e le cita'`), await q(`document.getElementById('ask-web-note').textContent`));
  rw = await row();
  ok('fonti scarse o fuori tema: «Pochi risultati utili: provo un’altra ricerca…», poi in rosso «Non ho trovato fonti affidabili sul web»', seen3.includes('Pochi risultati utili: provo un’altra ricerca…') && rw.poor === 'Non ho trovato fonti affidabili sul web' && rw.t === 'Ho cercato: SCARSO tre; SCARSO quattro' && await q(`getComputedStyle(document.getElementById('ask-poor')).color`) !== await q(`getComputedStyle(document.getElementById('ask-queries-t')).color`), JSON.stringify([seen3, rw]));
  await shot(P, 'ipad-fonti-scarse');

  // ======================= A. tastiera (visualViewport) su iPad orizzontale =======================
  await tap(P, '#ask-acts button[data-act="explain"]'); await follow();
  await P.eval(`__penna.ask.snap('half'); return 1`); await settle();
  await P.eval(`document.getElementById('ask-input').focus(); return 1`);
  await P.eval(`__kb(398); return 1`); await settle();
  p = await panel();
  ok(`tastiera aperta (398 px): il pannello sale sopra la tastiera (fondo a ${Math.round(p.bottom)} px = 768−398−12) e usa tutto lo spazio sopra`, near(p.bottom, 768 - 398 - 12) && p.top >= 8 && p.top <= 30 && p.snap === 'full' && p.cls.includes('kbopen') && p.cls.includes('tight'), JSON.stringify(p));
  ok(`…la risposta resta visibile (${Math.round(p.ansH)} px), i comandi si fanno da parte`, !p.ctl && p.ansH >= 120 && p.ansTop > p.top && p.ansTop + 40 < p.bottom && await q(`(()=>{const r=document.getElementById('ask-input').getBoundingClientRect(); return r.bottom<=${p.bottom} && r.top>=${p.top}})()`), JSON.stringify(p));
  await shot(P, 'ipad-tastiera');
  await P.eval(`__kb(0); document.activeElement.blur(); return 1`); await settle();
  p = await panel();
  ok('tastiera chiusa → il pannello torna a «metà», giù in fondo', p.snap === 'half' && near(p.bottom, 756) && !p.cls.includes('tight') && p.ctl, JSON.stringify(p));
  await P.eval(`__kb(55); return 1`); await settle();
  ok('tastiera esterna (solo la barretta da 55 px): niente cambio di altezza', (await panel()).snap === 'half');
  await P.eval(`__kb(0); return 1`); await settle();
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300);
  await shot(P, 'ipad-meta-scuro');
  await P.eval(`__penna.ask.snap('full'); return 1`); await settle();
  await shot(P, 'ipad-tutto-scuro');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await tap(P, '#ask-close'); await sleep(200);

  // ======================= iPad verticale 768×1024 =======================
  await device(P, 768, 1024); await sleep(400);
  await openFromSel();
  await checkSnaps('ipad-verticale', 768, 1024, 12);
  await P.eval(`document.getElementById('ask-input').focus(); __kb(320); return 1`); await settle();
  p = await panel();
  ok(`iPad verticale con tastiera (320 px): sopra la tastiera, spazio sufficiente → comandi ancora visibili, risposta ${Math.round(p.ansH)} px`, near(p.bottom, 1024 - 320 - 12) && p.snap === 'full' && !p.cls.includes('tight') && p.ansH >= 100 && p.top >= 8, JSON.stringify(p));
  await shot(P, 'ipad-verticale-tastiera');
  await P.eval(`__kb(0); document.activeElement.blur(); return 1`); await settle();
  await tap(P, '#ask-close'); await sleep(200);

  // ======================= iPhone 390×844 =======================
  await device(P, 390, 844, 3); await sleep(500);
  await openFromSel();
  await checkSnaps('iphone', 390, 844, 0);
  await tap(P, '#ask-acts button[data-act="explain"]'); await follow();
  rw = await row();
  ok('iPhone: riga «Ho cercato» e pulsante «Modifica» (44 px) dentro lo schermo', rw.shown && rw.label === 'Modifica' && rw.bh >= 44 && (await rect(P, '#ask-qedit-open')).x + (await rect(P, '#ask-qedit-open')).w <= 390, JSON.stringify(rw));
  await shot(P, 'iphone-ho-cercato');
  await P.eval(`document.getElementById('ask-input').focus(); __kb(336); return 1`); await settle();
  p = await panel();
  ok(`iPhone con tastiera (336 px): pannello sopra la tastiera (fondo a ${Math.round(p.bottom)}), risposta visibile ${Math.round(p.ansH)} px`, near(p.bottom, 844 - 336) && p.cls.includes('tight') && p.ansH >= 120 && p.top >= 8, JSON.stringify(p));
  await shot(P, 'iphone-tastiera');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300);
  await shot(P, 'iphone-tastiera-scuro');
  await P.eval(`__kb(0); document.activeElement.blur(); return 1`); await settle();
  await shot(P, 'iphone-meta-scuro');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await P.eval(`__penna.ask.snap('compact'); return 1`); await settle();
  await drag('#ask-grip', 150, { steps: 10, ms: 50 });
  ok('iPhone: tirato giù dal compatto → si chiude', await q(`document.getElementById('ask').hidden`));

  ok('nessuna eccezione nella pagina', !P.logs.some((l) => /^EXC/.test(l)), P.logs.filter((l) => /^EXC/.test(l)).join('\n'));
  const logs = fs.readFileSync(blog, 'utf8');
  ok('registro del bridge: niente token, chiave, ricerche o testi', !logs.includes(TOKEN) && !logs.includes(KEY) && !/Sufyani|tiranno|SCARSO/.test(logs) && /ask qwen qwen3:14b \+web/.test(logs));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-10).join('\n')); console.log(fs.readFileSync(blog, 'utf8').slice(-1500)); }
P.close(); bridge.kill('SIGTERM'); await ol.close(); await tv.close();
console.log(`\n${pass} ok, ${fail} falliti · screenshot in ${SHOTS}`);
process.exit(fail ? 1 : 0);
