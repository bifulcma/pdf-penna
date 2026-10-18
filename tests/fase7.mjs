// Test della fase 7: "Chiedi" dentro PDF Penna, con il bridge VERO (studio-bridge/bridge.py) avviato su questo Mac.
// Qwen = finto Ollama (risposta a pezzi lenti), Claude = `claude -p` VERO con l'abbonamento.
// Flusso: senza collegamento → istruzioni; Impostazioni › Assistente (controlli dell'indirizzo, riga unica, token sbagliato,
// Prova connessione); seleziona testo → Chiedi → avviso privacy → risposta in streaming → Salva come commento → nel Markdown;
// Copia, Riprova, Ferma; Claude vero; Riassumi questa pagina; Domanda sul PDF (libro da 300 pagine: solo i passaggi utili);
// Studio spento; iPhone 390×844, iPad 1024×768, tema scuro. Browser "da iPad" (API moderne tolte + polyfill, tocchi veri).
// Uso: server statico su http://localhost:8088 nella cartella del progetto, poi: node tests/fase7.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sleep, OUT } from './cdp.mjs';
import { browser, device, rect, tapXY, tap, reachable, small } from './touch.mjs';
import { startOllama, QWEN_ANSWER } from './fakeollama.mjs';
const require = createRequire(import.meta.url);
const PDFLib = require(new URL('../lib/pdf-lib.min.js', import.meta.url).pathname);
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
const SHOTS = OUT + '/shots7'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const shot = async (P, name) => { const r = await P.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };

// ---------- bridge vero + finto Ollama ----------
const PY = execFileSync('/usr/bin/which', ['python3']).toString().trim();
const HOME = fs.mkdtempSync(os.tmpdir() + '/sb-e2e-');
const TOKEN = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(HOME + '/token', TOKEN + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ port: 8797, ollama_url: 'http://127.0.0.1:11997', allowed_origins: ['https://bifulcma.github.io', ORIGIN] }));
const ol = await startOllama(11997, { delay: 90 });
const blog = HOME + '/bridge.log';
const bridge = spawn(PY, [new URL('../studio-bridge/bridge.py', import.meta.url).pathname], { env: { ...process.env, STUDIO_BRIDGE_HOME: HOME }, stdio: ['ignore', fs.openSync(blog, 'a'), fs.openSync(blog, 'a')] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8797/')).ok) break; } catch {} await sleep(100); }
const BURL = 'http://127.0.0.1:8797';
const asks = () => (fs.readFileSync(blog, 'utf8').match(/POST \/ask/g) || []).length;

// ---------- PDF di prova ----------
const REAL_HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 13pt; line-height: 1.5; color: #111; }
h1 { font-family: "Helvetica Neue", Helvetica, sans-serif; font-size: 22pt; margin: 0 0 10pt; } p { margin: 0 0 9pt; text-align: justify; }
</style><h1>Capitolo primo — Della libertà</h1>
<p>La libertà è il dono più grande: perché la città possa crescere, serve virtù e pazienza. Così diceva il saggio, già ottantenne, all'università.</p>
<p>Ogni scelta libera chiede coraggio: chi non sceglie lascia che siano altri a decidere al suo posto.</p>
${Array.from({ length: 10 }, (_, i) => `<p>Riga ${i + 1}: il contratto prevede che la parte acquirente versi il prezzo entro trenta giorni dalla consegna della merce.</p>`).join('')}
<p style="page-break-before: always">Seconda pagina: la carità e l'umiltà sono virtù cardinali? No, teologali.</p>
</html>`;
async function makeBook(path, N) {
  const doc = await PDFLib.PDFDocument.create();
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= N; i++) {
    const pg = doc.addPage([595, 842]);
    pg.drawText('Pagina ' + i, { x: 60, y: 760, size: 30, font: f });
    for (let r = 0; r < 18; r++) pg.drawText('Riga ' + (r + 1) + ' del testo di prova, pagina ' + i + ', con parole comuni per riempire.', { x: 60, y: 700 - r * 26, size: 13, font: f });
    if (i === 150) pg.drawText('Clausola rescissoria: il contratto si scioglie se manca il pagamento.', { x: 60, y: 200, size: 14, font: f });
  }
  fs.writeFileSync(path, await doc.save());
}

process.env.UA = 'ipad';
const P = await browser(9381, 'strip');
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
// segue lo streaming: quante volte la risposta è cresciuta mentre arrivava
async function follow(ms = 30000) {
  const seen = new Set(); const t0 = Date.now(); let first = 0;
  while (Date.now() - t0 < ms) {
    const s = await P.eval(`const st=__penna.ask.st; return [st.busy, document.getElementById('ask-answer').textContent.length, !!document.querySelector('#ask-answer .caret')]`);
    if (s[0] && s[1] > 0 && s[2]) { seen.add(s[1]); if (!first) first = Date.now() - t0; }
    if (!s[0]) break;
    await sleep(40);
  }
  return { grew: seen.size, first, ms: Date.now() - t0 };
}
const mdText = () => q(`__penna.allMarkdown()`);
const lastReq = () => ol.st.requests[ol.st.requests.length - 1];

try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/reale7.html', REAL_HTML); return OUT + '/reale7.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/reale7.pdf', Buffer.from(pr.data, 'base64'));
  await makeBook(OUT + '/libro300b.pdf', 300);
  try { await P.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch {}
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{ const c=navigator.clipboard; if(c&&c.writeText){ const o=c.writeText.bind(c); c.writeText=(t)=>{ window.__clip=t; return o(t); }; } });` });
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(SEL_FN + '; return 1');
  ok('Safari vecchio emulato (API moderne tolte, polyfill) · versione v10 · modulo ask.js caricato', await q('window.__stripped===true && __penna.version==="v10" && !!__penna.A && typeof __penna.A.pickPages==="function"'));

  await P.setFiles('#pdf-input', [OUT + '/reale7.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');
  ok('pulsante Chiedi (scintilla) nella barra in basso, raggiungibile, pulsanti >= 44px', await reachable(P, '#btn-ask') && (await small(P)).length === 0, JSON.stringify(await small(P)));

  // ======================= senza collegamento: spiega come fare, non manda niente =======================
  await tap(P, '#btn-ask');
  await P.waitFor(`!document.getElementById('ask').hidden`, 3000, 'pannello Chiedi');
  ok('senza Mac Studio collegato: il pannello spiega come collegarlo (comando, Impostazioni, Tailscale)', await q(`!document.getElementById('ask-setup').hidden && document.getElementById('ask-main').hidden && /Terminale/.test(document.getElementById('ask-setup').textContent) && /Tailscale/.test(document.getElementById('ask-setup').textContent)`));
  await shot(P, 'ipad-chiedi-da-collegare');
  await tap(P, '#ask-setup-cmd'); await sleep(200);
  ok('"Copia il comando" → negli appunti la riga curl … install.sh | bash', (await q('window.__clip')) === 'curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash');
  ok('nessuna richiesta partita verso il Mac', asks() === 0 && ol.st.requests.length === 0);
  await tap(P, '#ask-setup-open');
  await P.waitFor(`document.getElementById('settings').open`, 3000, 'impostazioni');
  ok('"Apri Impostazioni" → Impostazioni con la sezione Assistente', await q(`document.getElementById('ask').hidden && [...document.querySelectorAll('#settings .group-title')].some(x=>x.textContent==='Assistente') && document.getElementById('ai-state').textContent==='Mac Studio non collegato'`));

  // ======================= Impostazioni › Assistente =======================
  await setField('#ai-url', 'http://studio.tail1234.ts.net'); await setField('#ai-token', TOKEN);
  await tap(P, '#btn-ai-test'); await sleep(200);
  ok('indirizzo http:// (non https) → errore chiaro, niente salvato', await q(`!document.getElementById('ai-err').hidden && /https:\\/\\//.test(document.getElementById('ai-err').textContent) && !localStorage.getItem('penna.ai')?.includes('tail1234')`));
  await setField('#ai-url', 'https://io:segreto@studio.tail1234.ts.net'); await tap(P, '#btn-ai-test'); await sleep(150);
  ok('indirizzo con nome:password → errore', await q(`!document.getElementById('ai-err').hidden && /password/.test(document.getElementById('ai-err').textContent)`));
  await setField('#ai-token', ''); await setField('#ai-url', BURL + '#token=' + TOKEN);
  ok('riga unica "indirizzo#token=…" incollata → indirizzo e token al loro posto', await q(`document.getElementById('ai-url').value===${JSON.stringify(BURL)} && document.getElementById('ai-token').value===${JSON.stringify(TOKEN)}`));
  await setField('#ai-token', TOKEN.slice(0, -3) + 'abc'); await tap(P, '#btn-ai-test');
  await P.waitFor(`document.getElementById('ai-chip').dataset.state==='error'`, 8000, 'token sbagliato');
  ok('token sbagliato → «Il token non è giusto»', await q(`/token non è giusto/.test(document.getElementById('ai-state').textContent)`), await q(`document.getElementById('ai-state').textContent`));
  await setField('#ai-token', TOKEN); await tap(P, '#btn-ai-test');
  await P.waitFor(`document.getElementById('ai-chip').dataset.state==='idle'`, 20000, 'prova connessione');
  const status = await q(`[...document.querySelectorAll('#ai-status li')].map(l=>l.textContent)`);
  ok('Prova connessione → «Collegato: Qwen e Claude pronti», Qwen ✓ qwen3:14b, Claude ✓ abbonamento', await q(`document.getElementById('ai-state').textContent==='Collegato: Qwen e Claude pronti'`) && /✓Qwen · qwen3:14b/.test(status[0]) && /✓Claude · abbonamento max/.test(status[1]), JSON.stringify(status));
  ok('scelta sorgente predefinita e modello (Qwen: modelli del Mac; Claude: Sonnet/Opus)', await q(`[...document.getElementById('ai-src').options].map(o=>o.textContent).join('|')==='Studio · Qwen (gratis)|Studio · Claude (abbonamento)' && [...document.getElementById('ai-model').options].some(o=>o.value==='qwen3:14b')`));
  const saved = JSON.parse(await q(`localStorage.getItem('penna.ai')`));
  ok('indirizzo e token salvati solo in questo dispositivo (localStorage), non nel database che va su OneDrive', saved.url === BURL && saved.token === TOKEN && !(await P.eval(`const st=['nodes','pages','meta']; for (const s of st) { const all=await __penna.D.all(s); if (JSON.stringify(all).includes(${JSON.stringify(TOKEN)})) return true; } return false`)));
  await P.eval(`document.getElementById('ai-src').value='claude'; document.getElementById('ai-src').dispatchEvent(new Event('change')); return 1`);
  ok('Claude: modelli Sonnet (veloce) e Opus (più accurato)', await q(`[...document.getElementById('ai-model').options].map(o=>o.textContent).join('|')==='Sonnet (veloce)|Opus (più accurato)'`));
  await P.eval(`document.getElementById('ai-src').value='qwen'; document.getElementById('ai-src').dispatchEvent(new Event('change')); return 1`);
  await shot(P, 'ipad-impostazioni-assistente');
  await P.eval(`document.getElementById('settings').close(); return 1`); await sleep(200);

  // ======================= selezione → Chiedi → Spiega (Qwen) =======================
  await tap(P, '#tool-select');
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'livello di testo');
  await select(0, 'La libertà è il dono più grande');
  ok('menu sulla selezione: Copia · Evidenzia · Commenta · Copia con commento · Chiedi', await q(`[...document.querySelectorAll('#selmenu button')].map(b=>b.dataset.act).join(',')==='copy,hl,note,copynote,ask'`));
  await shot(P, 'ipad-selezione-menu-chiedi');
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden && !document.getElementById('ask-main').hidden`, 3000, 'pannello');
  ok('Chiedi → pannello con la frase, su «Selezione · p. 1», azioni rapide, sorgente Qwen', await q(`document.getElementById('ask-quote').textContent==='«La libertà è il dono più grande»' && document.querySelector('.ask-scope .on').dataset.scope==='sel' && document.querySelector('.ask-scope .on').textContent==='Selezione · p. 1' && [...document.querySelectorAll('#ask-acts button')].map(b=>b.textContent).join('|')==='Spiega|Riassumi|Traduci in italiano|Obiezioni' && document.querySelector('.ask-src .on').dataset.src==='qwen'`));
  ok('aprire il pannello non manda niente', asks() === 0 && ol.st.requests.length === 0);
  ok('pannello: pulsanti >= 44px, menu della selezione chiuso', (await small(P)).length === 0 && await q(`document.getElementById('selmenu').hidden`), JSON.stringify(await small(P)));
  await tap(P, '#ask-acts button[data-act="explain"]');
  await P.waitFor(`document.getElementById('dlg').open`, 3000, 'avviso privacy');
  ok('prima volta: avviso privacy (Mac Studio, e Anthropic se Claude), e ancora niente inviato', await q(`/inviato al tuo Mac Studio \\(e, se scegli Claude, a Anthropic con il tuo abbonamento\\)/.test(document.getElementById('dlg-text').textContent)`) && asks() === 0);
  await shot(P, 'ipad-avviso-privacy');
  await tapOpt('Ho capito, invia');
  const f1 = await follow();
  ok(`risposta di Qwen in streaming: il testo è cresciuto ${f1.grew} volte (primo pezzo dopo ${f1.first} ms, fine dopo ${f1.ms} ms)`, f1.grew >= 4);
  const ans1 = await P.eval(`const a=document.getElementById('ask-answer'); return { strong: [...a.querySelectorAll('strong')].map(x=>x.textContent), li: a.querySelectorAll('li').length, code: a.querySelector('code')?.textContent, em: a.querySelector('em')?.textContent, html: a.innerHTML.length, caret: !!a.querySelector('.caret') }`);
  ok('markdown mostrato bene (grassetto, elenco, corsivo, codice), niente ragionamento <think>', ans1.strong[0] === 'libertà' && ans1.li === 2 && ans1.code === 'crescere' && ans1.em === 'virtù' && !ans1.caret && !(await q(`document.getElementById('ask-answer').textContent.includes('ci penso')`)), JSON.stringify(ans1));
  ok('sopra la risposta: «Qwen · qwen3:14b · Selezione · pagina 1»', await q(`document.getElementById('ask-info').textContent==='Qwen · qwen3:14b · Selezione · pagina 1'`), await q(`document.getElementById('ask-info').textContent`));
  const r1 = lastReq();
  ok('a Qwen arrivano: istruzioni (italiano, markdown), la frase, la pagina come contesto, «Spiega…»', r1.model === 'qwen3:14b' && /Rispondi sempre in italiano/.test(r1.messages[0].content) && /Testo selezionato \(pagina 1\):\n"""\nLa libertà è il dono più grande\n"""/.test(r1.messages[1].content) && /Per contesto, il testo della pagina 1/.test(r1.messages[1].content) && /Capitolo primo/.test(r1.messages[1].content) && /Spiega il testo selezionato/.test(r1.messages[1].content), JSON.stringify(r1.messages[1].content.slice(0, 300)));
  await tap(P, '#ask-copy'); await sleep(250);
  ok('Copia → la risposta negli appunti', (await q('window.__clip')) === QWEN_ANSWER);
  const before = await q(`__penna.nb.pages[0].rec.anns ? __penna.nb.pages[0].rec.anns.length : 0`);
  await tap(P, '#ask-save'); await sleep(300);
  const ann = await P.eval(`const l=__penna.nb.pages[0].rec.anns||[]; const a=l[l.length-1]; return a ? { q: a.q, n: a.n, r: a.r.length } : null`);
  ok('Salva come commento → commento sulla frase, con «✦ Spiega — Qwen» e la risposta', (await q(`__penna.nb.pages[0].rec.anns.length`)) === before + 1 && ann.q === 'La libertà è il dono più grande' && ann.n.startsWith('✦ Spiega — Qwen\n\n') && ann.n.includes('**libertà**') && ann.r >= 1, JSON.stringify(ann));
  const md1 = await mdText();
  ok('il commento compare nel Markdown per Claude Code', md1.includes('## Pagina 1') && md1.includes('> "La libertà è il dono più grande"') && md1.includes('**Commento:** ✦ Spiega — Qwen') && md1.includes('serve *virtù*'), md1.slice(0, 400));
  ok('pulsante diventa «Salvato come commento ✓» (niente doppioni), icona del commento sulla pagina', await q(`document.getElementById('ask-save').disabled && /Salvato come commento ✓/.test(document.getElementById('ask-save').textContent) && __penna.nb.pages[0].pins.querySelectorAll('.ann-pin').length>=1`));
  await shot(P, 'ipad-chiedi-risposta-qwen');

  // Riprova e Ferma
  const n1 = ol.st.requests.length;
  await tap(P, '#ask-retry');
  ok('Riprova: niente secondo avviso privacy', !(await q(`document.getElementById('dlg').open`)));
  await follow();
  ok('Riprova → di nuovo la stessa domanda, nuova risposta', ol.st.requests.length === n1 + 1 && lastReq().messages[1].content === r1.messages[1].content && (await st('answer')).trim() === QWEN_ANSWER && !(await q(`document.getElementById('ask-save').disabled`)),
    JSON.stringify([ol.st.requests.length, n1, lastReq().messages[1].content === r1.messages[1].content, (await st('answer')).slice(0, 80), await st('busy'), await q(`document.getElementById('ask-save').disabled`)]));
  await setField('#ask-input', 'LUNGO: raccontami tutto');
  await tap(P, '#ask-send');
  await P.waitFor(`__penna.ask.st.busy && __penna.ask.st.answer.length > 20`, 8000, 'risposta lunga');
  ok('durante la risposta: «Riprova» diventa «Ferma», azioni rapide spente', await q(`document.getElementById('ask-retry').textContent==='Ferma' && document.querySelector('#ask-acts button').disabled`));
  const closedBefore = ol.st.closedEarly;
  await tap(P, '#ask-retry');
  await P.waitFor(`!__penna.ask.st.busy`, 3000, 'fermata');
  await sleep(600);
  ok('Ferma → si ferma subito, resta il pezzo arrivato, e sul Mac la richiesta a Ollama viene chiusa', ol.st.closedEarly === closedBefore + 1 && /fermata/.test(await q(`document.getElementById('ask-info').textContent`)) && (await st('answer')).startsWith('pezzo 0'));
  ok('domanda libera sulla selezione: «Domanda: …»', /Domanda: LUNGO: raccontami tutto/.test(lastReq().messages[1].content) && /Testo selezionato/.test(lastReq().messages[1].content));

  // ======================= Claude VERO =======================
  await tap(P, '.ask-src button[data-src="claude"]');
  ok('selettore sorgente → Claude (e diventa la scelta predefinita)', await q(`document.querySelector('.ask-src .on').dataset.src==='claude' && JSON.parse(localStorage.getItem('penna.ai')).src==='claude'`));
  await tap(P, '#ask-acts button[data-act="sum"]');
  const fc = await follow(90000);
  const cAns = await st('answer');
  ok(`Claude vero (abbonamento, Sonnet): risposta in streaming (cresciuta ${fc.grew} volte, primo pezzo dopo ${(fc.first / 1000).toFixed(1)} s, fine dopo ${(fc.ms / 1000).toFixed(1)} s)`, cAns.length > 20 && !(await st('error')) && fc.grew >= 1, (await st('error')) || cAns.slice(0, 200));
  console.log('     risposta di Claude: ' + JSON.stringify(cAns.slice(0, 220)));
  ok('sopra la risposta: «Claude · Sonnet · Selezione · pagina 1»', await q(`document.getElementById('ask-info').textContent`) === 'Claude · Sonnet · Selezione · pagina 1', await q(`document.getElementById('ask-info').textContent`));
  await tap(P, '#ask-save'); await sleep(300);
  const md2 = await mdText();
  ok('Salva come commento (Claude) → nel Markdown «✦ Riassumi — Claude Sonnet» + risposta', md2.includes('**Commento:** ✦ Riassumi — Claude Sonnet') && md2.includes(cAns.trim().split('\n')[0].slice(0, 30)), md2.slice(-500));
  await shot(P, 'ipad-chiedi-risposta-claude');
  await tap(P, '.ask-src button[data-src="qwen"]');

  // ======================= pagina corrente =======================
  await tap(P, '#ask-close');
  ok('chiudi → pannello via', await q(`document.getElementById('ask').hidden`));
  await tap(P, '#btn-ask');
  await P.waitFor(`!document.getElementById('ask').hidden`, 3000, 'pannello dalla barra');
  ok('dalla barra: su «Pagina 1» (niente scheda Selezione), «Salva come commento» non serve', await q(`document.querySelector('.ask-scope .on').dataset.scope==='page' && document.querySelector('.ask-scope .on').textContent==='Pagina 1' && document.querySelector('.ask-scope [data-scope=sel]').hidden && document.querySelector('#ask-out .ask-btns').hidden && !document.getElementById('ask-save').offsetParent`));
  await tap(P, '#ask-acts button[data-act="sum"]');
  await follow();
  const rp = lastReq().messages[1].content;
  ok('Riassumi questa pagina → testo della pagina 1, «Riassumi questa pagina»', /Testo della pagina 1:/.test(rp) && /Capitolo primo/.test(rp) && /Riassumi questa pagina/.test(rp) && !/Seconda pagina/.test(rp) && await q(`document.getElementById('ask-save').hidden && document.getElementById('ask-info').textContent==='Qwen · qwen3:14b · Pagina 1'`), rp.slice(0, 200));
  await tap(P, '.ask-scope button[data-scope="doc"]');
  ok('scheda «Tutto il PDF»: «Riassumi il PDF» + domanda sul PDF', await q(`[...document.querySelectorAll('#ask-acts button')].map(b=>b.textContent).join('|')==='Riassumi il PDF' && document.getElementById('ask-input').placeholder==='Domanda sul PDF…'`));
  await setField('#ask-input', 'Le virtù teologali?'); await tap(P, '#ask-send');
  await follow();
  const rd = lastReq().messages[1].content;
  ok('PDF corto: va tutto (2 pagine), dichiarato sopra la risposta', /\[Pagina 1\]/.test(rd) && /\[Pagina 2\]/.test(rd) && /teologali/.test(rd) && /Tutto il PDF \(2 pagine con testo\)/.test(await q(`document.getElementById('ask-info').textContent`)), await q(`document.getElementById('ask-info').textContent`));

  // ======================= Studio spento =======================
  await P.eval(`__penna.ask.cfg.url='http://127.0.0.1:8798'; return 1`);
  await tap(P, '#ask-retry');
  await P.waitFor(`!__penna.ask.st.busy && __penna.ask.st.error`, 35000, 'errore studio spento');
  ok('Studio spento → «Lo Studio non risponde: è acceso? Tailscale è attivo sull’iPad?»', (await st('error')) === 'Lo Studio non risponde: è acceso? Tailscale è attivo sull’iPad?' && await q(`!!document.querySelector('#ask-answer .ask-err')`));
  await shot(P, 'ipad-chiedi-studio-spento');
  await P.eval(`__penna.ask.cfg.url=${JSON.stringify(BURL)}; return 1`);
  ok('il resto dell’app continua a funzionare (nessun riquadro d’errore)', await q(`document.getElementById('errbox').hidden`));
  await P.eval(`document.getElementById('ask').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1`);
  ok('Esc chiude il pannello', await q(`document.getElementById('ask').hidden`));

  // ======================= libro da 300 pagine: solo i passaggi utili =======================
  const realId = await q(`__penna.nb.node.id`);
  await tap(P, '#btn-back'); await sleep(400);
  await P.setFiles('#pdf-input', [OUT + '/libro300b.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===300 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 60000, 'libro 300');
  await tap(P, '#btn-ask'); await sleep(200);
  await P.eval(`__penna.goToPage(9); return 1`);
  await P.waitFor(`document.querySelector('.ask-scope [data-scope=page]').textContent==='Pagina 10'`, 5000, 'Pagina 10');
  ok('pannello aperto e PDF che scorre: «Pagina N» segue la pagina che si legge', await q(`document.getElementById('ask-quote').textContent==='Il testo della pagina 10 di 300'`));
  await tap(P, '.ask-scope button[data-scope="doc"]');
  await setField('#ask-input', 'Cosa dice la clausola rescissoria?');
  const tq = Date.now();
  await tap(P, '#ask-send');
  await follow(90000);
  const rb = lastReq().messages[1].content, info = await q(`document.getElementById('ask-info').textContent`);
  const inc = [...rb.matchAll(/\[Pagina (\d+)\]/g)].map((m) => +m[1]);
  ok(`Domanda sul PDF (300 pagine): incluse solo ${inc.length} pagine (${inc.join(', ')}), con la 150 e le vicine, in ${((Date.now() - tq) / 1000).toFixed(1)} s`, inc.includes(150) && inc.includes(149) && inc.includes(151) && inc.length < 30 && rb.length < 26000 && /Clausola rescissoria/.test(rb), info);
  ok('dichiarato nel pannello: «Ho incluso N pagine su 300 (…)»', /^Qwen · qwen3:14b · Ho incluso \d+ pagine su 300 \(.*149–151.*\)$/.test(info), info);
  ok('e detto anche al modello quali pagine e perché', /pagine .*150.* su 300; scelte perché contengono le parole della domanda/.test(rb));
  await shot(P, 'ipad-domanda-sul-pdf');

  // ======================= iPhone =======================
  await P.eval(`await __penna.closeNotebook(); await __penna.openNotebook(${JSON.stringify(realId)}); return 1`);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length===2 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'riapro il PDF vero');
  await device(P, 390, 844, 3); await sleep(500);
  const top = await P.eval(`return ['btn-back','btn-pages','page-ind','btn-ask','btn-save'].map(id=>{const r=document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.x), Math.round(r.right), Math.round(r.y), Math.round(r.width)]})`);
  ok('iPhone: Chiedi visibile nella barra in alto, niente fuori schermo né sovrapposto', top.every(([, x, r, , w]) => w > 0 && x >= 0 && r <= 390) && top.every((a, i) => i === 0 || a[1] >= top[i - 1][2] - 1) && await reachable(P, '#btn-ask'), JSON.stringify(top));
  if ((await q(`__penna.S.tool`)) !== 'select') await tap(P, '#tool-select'); // (un secondo tocco aprirebbe i colori)
  await P.waitFor(`__penna.nb.pages[0].tl && __penna.nb.pages[0].tl.end`, 10000, 'testo iPhone');
  await select(0, 'Ogni scelta libera chiede coraggio');
  const sm = await rect(P, '#selmenu');
  ok('iPhone: menu sulla selezione con Chiedi dentro lo schermo', sm.x >= 0 && sm.x + sm.w <= 390 && await reachable(P, '#selmenu button[data-act="ask"]'), JSON.stringify(sm));
  await shot(P, 'iphone-selezione-menu-chiedi');
  await tap(P, '#selmenu button[data-act="ask"]');
  await P.waitFor(`!document.getElementById('ask').hidden`, 3000, 'pannello iPhone');
  await sleep(350); // il pannello sale dal basso: tocco quando è fermo
  await tap(P, '#ask-acts button[data-act="obj"]');
  await follow();
  const sh = await rect(P, '#ask');
  ok('iPhone: pannello dal basso a tutta larghezza, dentro lo schermo, pulsanti >= 44px', sh.x === 0 && Math.round(sh.w) === 390 && sh.y >= 40 && Math.round(sh.y + sh.h) <= 844 && (await small(P)).length === 0, JSON.stringify(sh) + ' ' + JSON.stringify(await small(P)));
  ok('iPhone: «Obiezioni» → istruzione giusta', /obiezioni, punti deboli o controargomentazioni/.test(lastReq().messages[1].content) && /Ogni scelta libera chiede coraggio/.test(lastReq().messages[1].content), lastReq().messages[1].content.slice(0, 120) + ' … ' + lastReq().messages[1].content.slice(-160));
  await shot(P, 'iphone-chiedi-risposta');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300);
  await shot(P, 'iphone-chiedi-scuro');
  await device(P, 1024, 768); await sleep(400);
  await shot(P, 'ipad-chiedi-scuro');
  const dark = await P.eval(`const c=getComputedStyle(document.getElementById('ask')); return c.backgroundColor`);
  ok('tema scuro: pannello scuro', /rgb\(28, 25, 23\)/.test(dark), dark);
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await tap(P, '#ask-close');

  // ======================= Scollega =======================
  await P.eval(`await __penna.closeNotebook(); return 1`); await sleep(300);
  await tap(P, '#btn-settings');
  await P.waitFor(`document.getElementById('settings').open`, 3000, 'impostazioni');
  await tap(P, '#btn-ai-forget');
  await P.waitFor(`document.getElementById('dlg').open`, 3000, 'conferma scollega');
  await tapOpt('Scollega');
  await P.waitFor(`document.getElementById('settings').open`, 3000, 'impostazioni riaperte');
  ok('Scollega → indirizzo e token tolti da questo dispositivo', !JSON.parse(await q(`localStorage.getItem('penna.ai')`)).token && await q(`document.getElementById('ai-state').textContent==='Mac Studio non collegato'`));
  ok('nessuna eccezione nella pagina', !P.logs.some((l) => /^EXC/.test(l)), P.logs.filter((l) => /^EXC/.test(l)).join('\n'));
  const logs = fs.readFileSync(blog, 'utf8');
  ok('registro del bridge: niente token né testi', !logs.includes(TOKEN) && !logs.includes('libertà') && !logs.includes('rescissoria'));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); try { await shot(P, 'fail'); } catch {} console.log(P.logs.slice(-10).join('\n')); console.log(fs.readFileSync(blog, 'utf8').slice(-1500)); }
P.close(); bridge.kill('SIGTERM'); await ol.close();
console.log(`\n${pass} ok, ${fail} falliti · screenshot in ${SHOTS}`);
process.exit(fail ? 1 : 0);
