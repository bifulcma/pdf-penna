// Test del brief 13 nel browser (15/11/2026): la scrittura a mano arriva all'AI come foto della pagina.
// Bridge VERO (versione 7) + Ollama finto. Uso: server statico su http://localhost:8088, poi: node tests/inchiostro.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { sleep, OUT } from './cdp.mjs';
import { browser, device } from './touch.mjs';
import { startOllama } from './fakeollama.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? '  — ' + String(extra).slice(0, 600) : '')); };

const PY = execFileSync('/usr/bin/which', ['python3']).toString().trim();
const HOME = fs.mkdtempSync(os.tmpdir() + '/sb-ink-');
const TOKEN = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(HOME + '/token', TOKEN + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ port: 8769, ollama_url: 'http://127.0.0.1:11970', allowed_origins: ['https://bifulcma.github.io', ORIGIN] }));
const ol = await startOllama(11970, { delay: 10 });
const blog = HOME + '/bridge.log';
const bridge = spawn(PY, [new URL('../studio-bridge/bridge.py', import.meta.url).pathname], { env: { ...process.env, STUDIO_BRIDGE_HOME: HOME }, stdio: ['ignore', fs.openSync(blog, 'a'), fs.openSync(blog, 'a')] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8769/')).ok) break; } catch {} await sleep(100); }

const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>@page{size:A4;margin:22mm} body{font:13pt Georgia,serif}</style>
<h1>Quaderno di prova</h1><p>La grazia non spezza il lógos umano: rinnova il trópos.</p></html>`;
const P = await browser(9394, 'strip');
const q = (expr) => P.eval('return ' + expr);
async function askPage(question) {
  await P.eval(`__penna.ask.st.scope='page'; __penna.ask.st.src='qwen'; __penna.ask.run({ question: ${JSON.stringify(question)} }); return 1`);
  await sleep(200);
  await P.waitFor(`!__penna.ask.st.busy`, 20000, 'risposta');
  return q(`__penna.ask.st.sent`);
}
try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/inchiostro.html', HTML); return OUT + '/inchiostro.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/Quaderno di prova.pdf', Buffer.from(pr.data, 'base64'));
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(`localStorage.setItem('penna.ai', JSON.stringify({ url: 'http://127.0.0.1:8769', token: ${JSON.stringify(TOKEN)}, privacy: 1, webPrivacy: 1, web: false, src: 'qwen', model: {} })); return 1`);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.waitFor(`__penna.ask.cfg.health && __penna.ask.cfg.health.immagini`, 10000, 'salute del bridge 7');
  ok('l’app sa che il bridge legge le immagini', await q(`__penna.ask.cfg.health.immagini.ok === true`));
  await P.setFiles('#pdf-input', [OUT + '/Quaderno di prova.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages[0] && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');
  await P.eval(`__penna.ask.open(false); return 1`); await sleep(300);

  // 1. pagina senza segni: solo testo, come prima
  let sent = await askPage('Di cosa parla?');
  ok('pagina senza segni: nessuna immagine', sent && !sent.images, JSON.stringify(sent && Object.keys(sent)));

  // 2. pagina con un tratto di penna: parte la foto della pagina
  await P.eval(`const r=__penna.nb.pages[0].rec; r.strokes=[{t:'pen',c:'#d62828',w:0.0035,pts:[[0.7,0.2,1],[0.8,0.25,1],[0.75,0.3,1]]}]; r.updated=Date.now(); return 1`);
  sent = await askPage('Che cosa ho scritto a mano?');
  const img = sent && sent.images && sent.images[0];
  ok('pagina con penna: una foto JPEG nella richiesta', !!img && img.startsWith('/9j/') && img.length > 20000 && img.length < 1500000, img ? img.length : 'nessuna');
  ok('il messaggio dice al modello di leggere la scrittura a mano', /foto della pagina 1 con i segni fatti a mano/.test(sent.messages[0].content), sent.messages[0].content.slice(-400));
  ok('nel pannello: «Pagina 1 · con la scrittura a mano»', (await q(`__penna.ask.st.ctxInfo`)) === 'Pagina 1 · con la scrittura a mano', await q(`__penna.ask.st.ctxInfo`));
  const last = ol.st.requests.at(-1).messages.at(-1);
  ok('Ollama riceve la stessa foto attraverso il bridge vero', Array.isArray(last.images) && last.images[0] === img);
  ok('la risposta arriva', (await q(`__penna.ask.st.answer`)).length > 10 && !(await q(`__penna.ask.st.error`)), await q(`__penna.ask.st.error`));

  // 3. bridge vecchio (senza «immagini»): niente foto, nessun errore
  await P.eval(`__penna.ask.cfg.health.immagini = null; return 1`);
  sent = await askPage('Di cosa parla?');
  ok('bridge vecchio: si manda solo il testo', sent && !sent.images);
  const logs = fs.readFileSync(blog, 'utf8');
  ok('registro del bridge: niente token né dati dell’immagine', !logs.includes(TOKEN) && !logs.includes(img.slice(0, 40)));
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e.stack || e));
} finally {
  bridge.kill(); await ol.close(); try { await P.close(); } catch {}
  console.log('\nRISULTATO: ' + pass + '/' + (pass + fail) + ' ok');
  process.exit(fail ? 1 : 0);
}
