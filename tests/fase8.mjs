// Test della fase 8: "Cerca sul web" nel pannello Chiedi, con il bridge VERO (studio-bridge/bridge.py) avviato su questo Mac.
// Qwen = finto Ollama + finto Tavily (lento apposta, per vedere «Sto cercando»); Claude = `claude -p` VERO con il web.
// Flusso: Prova connessione mostra il web; interruttore spento all'inizio, avviso privacy una volta, scelta ricordata
// (anche dopo aver ricaricato); Qwen col web → «Sto cercando: «…»» → risposta → Fonti cliccabili (scheda nuova) →
// Salva come commento con gli URL → Markdown; Copia con le fonti; chiave Tavily mancante → messaggio chiaro, e senza web
// funziona; Claude vero col web; iPhone 390×844, iPad 1024×768, tema scuro.
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase8.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, tapXY, tap, small } from './touch.mjs';
import { startOllama, QWEN_ANSWER } from './fakeollama.mjs';
import { startTavily, KEY } from './faketavily.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
const SHOTS = OUT + '/shots8'; fs.mkdirSync(SHOTS, { recursive: true });
const CDP = 9383;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + String(extra).slice(0, 1200) : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };

// ---------- bridge vero + finto Ollama + finto Tavily ----------
const PY = execFileSync('/usr/bin/which', ['python3']).toString().trim();
const HOME = fs.mkdtempSync(os.tmpdir() + '/sb-e2e8-');
const TOKEN = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(HOME + '/token', TOKEN + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/tavily.key', KEY + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ port: 8799, ollama_url: 'http://127.0.0.1:11998', tavily_url: 'http://127.0.0.1:11996', allowed_origins: ['https://bifulcma.github.io', ORIGIN] }));
const ol = await startOllama(11998, { delay: 60, planDelay: 700 });
const tv = await startTavily(11996, { delay: 1500 });
const blog = HOME + '/bridge.log';
const benv = { ...process.env, STUDIO_BRIDGE_HOME: HOME }; delete benv.TAVILY_API_KEY;
const bridge = spawn(PY, [new URL('../studio-bridge/bridge.py', import.meta.url).pathname], { env: benv, stdio: ['ignore', fs.openSync(blog, 'a'), fs.openSync(blog, 'a')] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8799/')).ok) break; } catch {} await sleep(100); }
const BURL = 'http://127.0.0.1:8799';

const REAL_HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 13pt; line-height: 1.5; color: #111; }
h1 { font-family: "Helvetica Neue", Helvetica, sans-serif; font-size: 22pt; margin: 0 0 10pt; } p { margin: 0 0 9pt; text-align: justify; }
</style><h1>Storia della Compagnia</h1>
<p>La Compagnia di Gesù fu approvata nel 1540 da papa Paolo III. Ignazio di Loyola e i suoi compagni avevano fatto voto a Parigi.</p>
<p>Gli Esercizi spirituali sono il cuore della loro proposta: un mese di preghiera, discernimento e scelta.</p>
</html>`;

process.env.UA = 'ipad';
const P = await browser(CDP, 'strip');
const q = (expr) => P.eval('return ' + expr);
const st = (k) => q(`__penna.ask.st.${k}`);
const dlgOpt = (label) => P.eval(`const b=[...document.querySelectorAll('#dlg-options button, #dlg-options label')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
async function tapOpt(label) { const c = await dlgOpt(label); if (!c) throw new Error('opzione mancante: ' + label); await tapXY(P, c.x, c.y); }
const SEL_FN = `window.__sel = function (pi, phrase) {
  const p = __penna.nb.pages[pi], tw = document.createTreeWalker(p.tl.div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => n.nodeType === 3 || n.nodeName === 'BR' ? 1 : 3 });
  const parts = []; let all = '';
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const t = n.nodeType === 3 ? n.data : '\\n'; parts.push([n, all.length, t.length]); all += t; }
  const i = all.indexOf(phrase); if (i < 0) return false; const j = i + phrase.length;
  const a = parts.find(([n, s, l]) => n.nodeType === 3 && i >= s && i < s + l), b = parts.find(([n, s, l]) => n.nodeType === 3 && j > s && j <= s + l);
  const r = document.createRange(); r.setStart(a[0], i - a[1]); r.setEnd(b[0], j - b[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; };`;
async function select(pi, phrase) {
  if (!(await P.eval(`return __sel(${pi}, ${JSON.stringify(phrase)})`))) throw new Error('frase non trovata: ' + phrase);
  await P.waitFor(`!document.getElementById('selmenu').hidden && document.getElementById('selmenu').style.visibility!=='hidden'`, 3000, 'menu selezione');
  await sleep(120);
}
async function setField(sel, value) { await P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); return 1`); }
// segue il lavoro: le scritte «Sto cercando…» viste e quando arriva il testo
async function follow(ms = 30000) {
  const searching = new Set(); const t0 = Date.now(); let grew = 0, lastLen = 0;
  while (Date.now() - t0 < ms) {
    const s = await P.eval(`const st=__penna.ask.st; return [st.busy, st.answer.length, [...document.querySelectorAll('#ask-answer .ask-search')].map(x=>x.textContent)]`);
    for (const x of s[2]) searching.add(x);
    if (s[1] > lastLen) { grew++; lastLen = s[1]; }
    if (!s[0]) break;
    await sleep(40);
  }
  return { searching: [...searching], grew, ms: Date.now() - t0 };
}
const sources = () => P.eval(`const b=document.querySelector('#ask-answer .ask-sources'); if(!b) return null; return { head: b.querySelector('.ask-sources-h').textContent, items: [...b.querySelectorAll('a')].map(a=>({ href: a.getAttribute('href'), target: a.target, rel: a.rel, t: a.querySelector('.t').textContent, h: a.querySelector('.h').textContent, height: a.getBoundingClientRect().height })) }`);
const mdText = () => q(`__penna.allMarkdown()`);
const lastReq = () => ol.st.requests[ol.st.requests.length - 1];
const tabs = async () => (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === 'page');

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/reale8.html', REAL_HTML); return OUT + '/reale8.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/reale8.pdf', Buffer.from(pr.data, 'base64'));
  try { await P.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch {}
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{ const c=navigator.clipboard; if(c&&c.writeText){ const o=c.writeText.bind(c); c.writeText=(t)=>{ window.__clip=t; return o(t); }; } });` });
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(SEL_FN + '; return 1');
  ok('Safari vecchio emulato · versione ' + await q('__penna.version') + ' (>= v10)', await q('window.__stripped===true && +__penna.version.slice(1) >= 10 && typeof __penna.A.collectSources==="function"'));
  await P.setFiles('#pdf-input', [OUT + '/reale8.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');

  // ======================= Impostazioni › Assistente: Prova connessione mostra anche il web =======================
  await tap(P, '#btn-ask'); await P.waitFor(`!document.getElementById('ask').hidden`, 3000, 'pannello');
  await tap(P, '#ask-setup-open'); await P.waitFor(`document.getElementById('settings').open`, 3000, 'impostazioni');
  ok('Impostazioni: spiega come avere il web anche con Qwen (chiave Tavily, --chiave-tavily)', await q(`/Tavily/.test(document.querySelector('.ai-how').textContent) && /--chiave-tavily/.test(document.querySelector('.ai-how').textContent)`));
  await setField('#ai-url', BURL); await setField('#ai-token', TOKEN);
  await tap(P, '#btn-ai-test');
  await P.waitFor(`document.getElementById('ai-chip').dataset.state==='idle'`, 30000, 'prova connessione');
  const status = await q(`[...document.querySelectorAll('#ai-status li')].map(l=>l.textContent)`);
  ok('Prova connessione: Qwen ✓, Claude ✓, «Web con Claude ✓», «Web con Qwen ✓ chiave Tavily presente»', status.length === 4 && /^✓Qwen/.test(status[0]) && /^✓Claude/.test(status[1]) && status[2] === '✓Web con Claude · ricerca e lettura di pagine' && status[3] === '✓Web con Qwen · chiave Tavily presente', JSON.stringify(status));
  ok('la chiave Tavily non arriva mai all’app', !(await q(`localStorage.getItem('penna.ai')`)).includes(KEY) && !(await q(`document.body.innerHTML`)).includes(KEY));
  await P.eval(`document.querySelector('#settings details.ai-how').open=true; return 1`); await sleep(150);
  await shot(P, 'ipad-impostazioni-web');
  await P.eval(`document.getElementById('settings').close(); return 1`); await sleep(200);

  // ======================= interruttore =======================
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  await select(0, 'La Compagnia di Gesù fu approvata nel 1540');
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden && !document.getElementById('ask-main').hidden`, 3000, 'pannello');
  ok('interruttore «Cerca sul web» nel pannello, SPENTO all’inizio («Spento: solo il testo del PDF»)', await q(`document.getElementById('ask-web').getAttribute('aria-checked')==='false' && document.getElementById('ask-web').getAttribute('role')==='switch' && /Cerca sul web/.test(document.getElementById('ask-web').textContent) && document.getElementById('ask-web-note').textContent==='Spento: solo il testo del PDF'`));
  ok('interruttore: >= 44 px, nessun pulsante piccolo nel pannello', (await small(P)).length === 0 && (await rect(P, '#ask-web')).h >= 44, JSON.stringify([await small(P), await rect(P, '#ask-web'), await rect(P, '#ask'), await rect(P, '.ask-ctl')]));
  await tap(P, '#ask-web');
  await P.waitFor(`document.getElementById('dlg').open`, 3000, 'avviso web');
  ok('prima accensione: avviso privacy (domanda ed estratti verso internet, Anthropic / Tavily, dati non ordini)', await q(`/possono uscire dal Mac Studio verso internet/.test(document.getElementById('dlg-text').textContent) && /Anthropic/.test(document.getElementById('dlg-text').textContent) && /Tavily/.test(document.getElementById('dlg-text').textContent) && /dati, non come ordini/.test(document.getElementById('dlg-text').textContent)`));
  await shot(P, 'ipad-avviso-web');
  await tapOpt('Lascia spento'); await sleep(250);
  ok('«Lascia spento» → resta spento, niente salvato', await q(`document.getElementById('ask-web').getAttribute('aria-checked')==='false' && !JSON.parse(localStorage.getItem('penna.ai')).web`));
  await tap(P, '#ask-web'); await P.waitFor(`document.getElementById('dlg').open`, 3000, 'avviso web 2');
  await tapOpt('Accendi la ricerca sul web'); await sleep(250);
  ok('«Accendi» → acceso, ricordato; la riga dice cosa fa con Qwen', await q(`document.getElementById('ask-web').getAttribute('aria-checked')==='true' && JSON.parse(localStorage.getItem('penna.ai')).web===true && document.getElementById('ask-web-note').textContent==='Qwen sceglie le ricerche, legge le fonti migliori (Tavily) e le cita'`));
  await tap(P, '#ask-web'); await sleep(200);
  const offNoDlg = await q(`!document.getElementById('dlg').open && document.getElementById('ask-web').getAttribute('aria-checked')==='false'`);
  await tap(P, '#ask-web'); await sleep(200);
  ok('spegni / riaccendi: l’avviso non torna più', offNoDlg && await q(`!document.getElementById('dlg').open && document.getElementById('ask-web').getAttribute('aria-checked')==='true'`));
  ok('nessuna richiesta partita toccando l’interruttore', tv.st.requests.length === 0 && ol.st.requests.length === 0);
  const nbId = await q(`__penna.nb.node.id`);
  await P.eval(`await __penna.flush(); location.reload(); return 1`);
  await sleep(500);
  await P.waitFor('window.__penna && document.getElementById("btn-new-nb")', 15000, 'ricarica');
  await P.eval(SEL_FN + '; return 1');
  if (await q(`document.getElementById('notebook').hidden`)) await P.eval(`await __penna.openNotebook(${JSON.stringify(nbId)}); return 1`);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF riaperto');
  if ((await q(`__penna.S.tool`)) !== 'select') await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'testo');
  await select(0, 'La Compagnia di Gesù fu approvata nel 1540');
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden && !document.getElementById('ask-main').hidden`, 3000, 'pannello');
  ok('ricaricata l’app: «Cerca sul web» è ancora acceso (preferenza ricordata)', await q(`document.getElementById('ask-web').getAttribute('aria-checked')==='true'`));
  await shot(P, 'ipad-chiedi-web-acceso');

  // ======================= Qwen + web =======================
  await tap(P, '#ask-acts button[data-act="explain"]');
  await P.waitFor(`document.getElementById('dlg').open`, 3000, 'avviso privacy');
  await tapOpt('Ho capito, invia');
  await P.waitFor(`!!document.querySelector('#ask-answer .ask-search')`, 5000, 'sto cercando');
  await shot(P, 'ipad-web-sto-cercando');
  const f1 = await follow();
  ok(`durante il lavoro: «Scelgo cosa cercare…», poi «Sto cercando: «Compagnia di Gesù approvazione 1540»…» (la ricerca scelta da Qwen)`, f1.searching.includes('Scelgo cosa cercare…') && f1.searching.includes('Sto cercando: «Compagnia di Gesù approvazione 1540»…'), JSON.stringify(f1.searching));
  const tq = tv.st.requests[tv.st.requests.length - 1];
  ok('a Tavily (sul Mac): la ricerca scelta da Qwen, non la frase grezza; a Qwen: le fonti numerate', tv.st.requests.length === 1 && tq.body.query === 'Compagnia di Gesù approvazione 1540' && /Fonti dal web/.test(lastReq().messages[1].content) && /\[1\] Compagnia di Gesù — Wikipedia/.test(lastReq().messages[1].content), JSON.stringify(tq.body));
  const s1 = await sources();
  ok('sotto la risposta: «Fonti» = le 2 citate [1][2], in ordine, con titolo e sito', s1 && s1.head === 'Fonti' && s1.items.length === 2 && s1.items[0].t === 'Compagnia di Gesù — Wikipedia' && s1.items[0].h === 'it.wikipedia.org' && s1.items[1].t === 'Chi sono i Gesuiti' && s1.items[1].h === 'ilpost.it', JSON.stringify(s1));
  ok('le fonti sono link veri: https, nuova scheda (target _blank), rel noopener noreferrer, alti >= 44 px', s1.items.every((i) => /^https:\/\//.test(i.href) && i.target === '_blank' && i.rel === 'noopener noreferrer' && i.height >= 44), JSON.stringify(s1.items));
  const inl = await P.eval(`return [...document.querySelectorAll('#ask-answer > :not(.ask-sources) a')].map(a=>[a.getAttribute('href'), a.target, a.rel])`);
  ok('anche gli URL scritti nella risposta sono link sicuri (https, nuova scheda)', inl.length === 2 && inl.every(([h, t, r]) => /^https:\/\//.test(h) && t === '_blank' && r === 'noopener noreferrer'), JSON.stringify(inl));
  ok('sopra la risposta: «Qwen · qwen3:14b · Selezione · pagina 1 · con il web»', (await q(`document.getElementById('ask-info').textContent`)) === 'Qwen · qwen3:14b · Selezione · pagina 1 · con il web', await q(`document.getElementById('ask-info').textContent`));
  await P.eval(`document.getElementById('ask-answer').scrollTop=1e6; return 1`); await sleep(150);
  await shot(P, 'ipad-web-fonti-qwen');
  // tocco su una fonte → si apre in una scheda nuova
  const before = (await tabs()).map((t) => t.id);
  await P.eval(`document.querySelector('#ask-answer .ask-sources a').scrollIntoView({block:'center'}); return 1`); await sleep(150);
  await tap(P, '#ask-answer .ask-sources li:first-child a');
  let opened = null; for (let i = 0; i < 40 && !opened; i++) { await sleep(150); opened = (await tabs()).find((t) => !before.includes(t.id)); }
  ok('tocco su una fonte → si apre in una scheda nuova (' + (opened ? opened.url.slice(0, 60) : 'niente') + '), l’app resta lì', !!opened && /wikipedia\.org|about:blank/.test(opened.url) && await q(`!document.getElementById('ask').hidden && location.href.includes('index.html')`), JSON.stringify(opened));
  if (opened) { try { await fetch(`http://127.0.0.1:${CDP}/json/close/${opened.id}`); } catch {} }
  // Salva come commento + Markdown + Copia
  await tap(P, '#ask-save'); await sleep(300);
  const ann = await P.eval(`const l=__penna.nb.pages[0].rec.anns||[]; const a=l[l.length-1]; return a ? a.n : ''`);
  ok('Salva come commento: «✦ Spiega — Qwen · web», la risposta e in fondo «Fonti:» con gli URL', ann.startsWith('✦ Spiega — Qwen · web\n\n') && ann.endsWith('\n\nFonti:\n1. Compagnia di Gesù — Wikipedia — https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9\n2. Chi sono i Gesuiti — https://www.ilpost.it/2013/03/14/gesuiti/'), ann.slice(-300));
  const md = await mdText();
  ok('nel Markdown per Claude Code: commento con le fonti e gli URL', md.includes('> "La Compagnia di Gesù fu approvata nel 1540"') && md.includes('**Commento:** ✦ Spiega — Qwen · web') && md.includes('1. Compagnia di Gesù — Wikipedia — https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9') && md.includes('https://www.ilpost.it/2013/03/14/gesuiti/'), md.slice(-600));
  await tap(P, '#ask-copy'); await sleep(250);
  ok('Copia → risposta + «Fonti:» con gli URL', /\n\nFonti:\n1\. Compagnia di Gesù — Wikipedia — https:\/\/it\.wikipedia\.org/.test(await q('window.__clip')) && (await q('window.__clip')).startsWith('Secondo le fonti'));

  // ======================= chiave Tavily mancante =======================
  fs.renameSync(HOME + '/tavily.key', HOME + '/tavily.key.via');
  await tap(P, '#ask-retry');
  await P.waitFor(`!__penna.ask.st.busy && __penna.ask.st.error`, 15000, 'errore chiave');
  ok('senza chiave Tavily: «Per Qwen col web serve la chiave Tavily sullo Studio: usa Claude o vedi LEGGIMI.»', (await st('error')) === 'Per Qwen col web serve la chiave Tavily sullo Studio: usa Claude o vedi LEGGIMI.' && await q(`!!document.querySelector('#ask-answer .ask-err')`), await st('error'));
  await shot(P, 'ipad-web-manca-chiave');
  await tap(P, '#ask-web'); await sleep(150);
  await tap(P, '#ask-retry');
  await follow();
  ok('…spento il web, la stessa domanda funziona (il resto non si rompe)', (await st('answer')).trim() === QWEN_ANSWER && !(await st('error')) && !(await sources()) && !/con il web/.test(await q(`document.getElementById('ask-info').textContent`)));
  fs.renameSync(HOME + '/tavily.key.via', HOME + '/tavily.key');
  await tap(P, '#ask-web'); await sleep(150);
  await P.eval(`const h=__penna.ask.cfg.health; h.web_qwen={ok:false,key:'manca',error:'manca la chiave Tavily sul Mac Studio'}; document.querySelector('.ask-src button[data-src=qwen]').click(); return 1`); await sleep(100);
  ok('se «Prova connessione» ha visto che manca la chiave, la riga lo dice già (in rosso)', await q(`document.getElementById('ask-web-note').textContent==='Qwen: manca la chiave Tavily sullo Studio, usa Claude' && document.getElementById('ask-web-note').classList.contains('warn')`));
  await P.eval(`__penna.ask.cfg.health.web_qwen={ok:true,key:'ok',error:''}; return 1`);
  // l'app ricorda ancora lo stato di un bridge della fase 7 (senza web): lo dice; appena il Mac risponde «col web» si corregge
  await P.eval(`const h=__penna.ask.cfg.health; delete h.web_claude; delete h.web_qwen; document.querySelector('.ask-src button[data-src=qwen]').click(); return 1`); await sleep(100);
  ok('stato ricordato di un bridge vecchio: «Aggiorna il Mac Studio (rilancia l’installazione), poi Prova connessione»', await q(`document.getElementById('ask-web-note').textContent==='Aggiorna il Mac Studio (rilancia l’installazione), poi Prova connessione' && document.getElementById('ask-web-note').classList.contains('warn')`));
  await tap(P, '#ask-retry'); await follow();
  ok('…il Mac risponde «col web» → la riga torna normale da sola', await q(`document.getElementById('ask-web-note').textContent==='Qwen sceglie le ricerche, legge le fonti migliori (Tavily) e le cita' && !!__penna.ask.cfg.health.web_claude`) && !!(await sources()));

  // ======================= Claude VERO col web =======================
  await tap(P, '.ask-src button[data-src="claude"]');
  ok('Claude scelto: la riga dice «Claude cerca, legge le pagine e cita le fonti»', await q(`document.getElementById('ask-web-note').textContent==='Claude cerca, legge le pagine e cita le fonti'`));
  await setField('#ask-input', 'In che anno papa Paolo III approvò ufficialmente la Compagnia di Gesù? Verifica sul web.');
  await tap(P, '#ask-send');
  const fc = await follow(240000);
  const cAns = await st('answer'), s2 = await sources();
  console.log('     Claude col web: ' + JSON.stringify(cAns.slice(0, 300)));
  console.log('     cercava: ' + JSON.stringify(fc.searching) + ' · fonti: ' + JSON.stringify((s2?.items || []).map((i) => i.href)));
  ok(`Claude VERO col web: «1540», fonti cliccabili sotto (${s2?.items.length || 0}), in ${(fc.ms / 1000).toFixed(0)} s`, /1540/.test(cAns) && !(await st('error')) && s2 && s2.items.length >= 1 && s2.items.every((i) => /^https?:\/\//.test(i.href) && i.target === '_blank'), (await st('error')) || cAns.slice(0, 200));
  ok('mentre lavorava si vedeva «Sto cercando: «…»» o «Sto leggendo: …»', fc.searching.some((s) => /^Sto (cercando: «.+»|leggendo: .+)…$/.test(s)), JSON.stringify(fc.searching));
  ok('sopra la risposta: «Claude · Sonnet · Selezione · pagina 1 · con il web»', (await q(`document.getElementById('ask-info').textContent`)) === 'Claude · Sonnet · Selezione · pagina 1 · con il web', await q(`document.getElementById('ask-info').textContent`));
  await P.eval(`document.getElementById('ask-answer').scrollTop=1e6; return 1`); await sleep(150);
  await shot(P, 'ipad-web-fonti-claude');
  await tap(P, '#ask-save'); await sleep(300);
  const md2 = await mdText();
  ok('Salva come commento (Claude) → nel Markdown «Claude Sonnet · web» con «Fonti:» e URL', md2.includes('**Commento:** ✦ Domanda: In che anno papa Paolo III') && md2.includes('— Claude Sonnet · web') && /\nFonti:\n1\. .*https?:\/\//.test(md2), md2.slice(-500));

  // ======================= iPhone =======================
  await tap(P, '.ask-src button[data-src="qwen"]');
  await tap(P, '#ask-close');
  await device(P, 390, 844, 3); await sleep(500);
  if ((await q(`__penna.S.tool`)) !== 'select') await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'testo iPhone');
  await select(0, 'Gli Esercizi spirituali sono il cuore della loro proposta');
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden`, 3000, 'pannello iPhone');
  await sleep(350);
  const wr = await rect(P, '#ask-web'), nr = await rect(P, '#ask-web-note');
  ok('iPhone: interruttore e riga dentro lo schermo, pulsanti >= 44 px', wr.x >= 0 && nr.x + nr.w <= 390 && wr.h >= 44 && (await small(P)).length === 0, JSON.stringify([wr, nr, await small(P)]));
  await shot(P, 'iphone-chiedi-web');
  await tap(P, '#ask-acts button[data-act="sum"]');
  await follow();
  await P.eval(`document.getElementById('ask-answer').scrollTop=1e6; return 1`); await sleep(150);
  const s3 = await sources(), shR = await rect(P, '#ask');
  ok('iPhone: risposta con le fonti, pannello dentro lo schermo', s3 && s3.items.length === 2 && shR.x === 0 && Math.round(shR.w) === 390 && Math.round(shR.y + shR.h) <= 844, JSON.stringify([s3, shR]));
  await shot(P, 'iphone-web-fonti');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300);
  await shot(P, 'iphone-web-fonti-scuro');
  await device(P, 1024, 768); await sleep(400);
  await shot(P, 'ipad-web-fonti-scuro');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  ok('nessuna eccezione nella pagina', !P.logs.some((l) => /^EXC/.test(l)), P.logs.filter((l) => /^EXC/.test(l)).join('\n'));
  const logs = fs.readFileSync(blog, 'utf8');
  ok('registro del bridge: niente token, chiave Tavily o testi', !logs.includes(TOKEN) && !logs.includes(KEY) && !logs.includes('Compagnia') && /ask qwen qwen3:14b \+web/.test(logs) && /ask claude sonnet \+web/.test(logs));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-10).join('\n')); console.log(fs.readFileSync(blog, 'utf8').slice(-1500)); }
P.close(); bridge.kill('SIGTERM'); await ol.close(); await tv.close();
console.log(`\n${pass} ok, ${fail} falliti · screenshot in ${SHOTS}`);
process.exit(fail ? 1 : 0);
