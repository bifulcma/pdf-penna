// Test del brief 14 nel browser (18/11/2026): «Trascrivi» (scrittura a mano → testo + analisi) e «Bozza Gmail» (PDF nelle bozze).
// Bridge VERO (versione 8) + Ollama finto + Google finto. Uso: server statico su http://localhost:8088, poi: node tests/trascrivi.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { sleep, OUT } from './cdp.mjs';
import { browser, device } from './touch.mjs';
import { startOllama } from './fakeollama.mjs';
import { startGmail } from './fakegmail.mjs';
const APP = process.env.APP || 'http://localhost:8088/index.html';
const ORIGIN = new URL(APP).origin;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? '  — ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 600) : '')); };

const PY = execFileSync('/usr/bin/which', ['python3']).toString().trim();
const HOME = fs.mkdtempSync(os.tmpdir() + '/sb-pen-');
const TOKEN = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(HOME + '/token', TOKEN + '\n', { mode: 0o600 });
fs.writeFileSync(HOME + '/config.json', JSON.stringify({ port: 8768, ollama_url: 'http://127.0.0.1:11971', gmail_url: 'http://127.0.0.1:11972', backup_dir: HOME + '/copie', allowed_origins: ['https://bifulcma.github.io', ORIGIN] }));
const GMAIL_JSON = JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt-buono', token_uri: 'http://127.0.0.1:11972/token' });
const ol = await startOllama(11971, { delay: 10 });
const gm = await startGmail(11972);
const blog = HOME + '/bridge.log';
const bridge = spawn(PY, [new URL('../studio-bridge/bridge.py', import.meta.url).pathname], { env: { ...process.env, STUDIO_BRIDGE_HOME: HOME }, stdio: ['ignore', fs.openSync(blog, 'a'), fs.openSync(blog, 'a')] });
for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8768/')).ok) break; } catch {} await sleep(100); }

const HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><style>@page{size:A4;margin:22mm} body{font:13pt Georgia,serif} h1{break-before:page}</style>
<h1 style="break-before:auto">Quaderno di prova</h1><p>La grazia non spezza il lógos umano: rinnova il trópos.</p><h1>Seconda</h1><p>Due.</p><h1>Terza</h1><p>Tre.</p><h1>Quarta</h1><p>Quattro.</p><h1>Quinta</h1><p>Cinque.</p></html>`;
const P = await browser(9395, 'strip');
const q = (expr) => P.eval('return ' + expr);
const STROKE = `[{t:'pen',c:'#d62828',w:0.0035,pts:[[0.7,0.2,1],[0.8,0.25,1],[0.75,0.3,1]]}]`;
async function run(scope, what) {
  await P.eval(`__penna.ask.st.scope=${JSON.stringify(scope)}; __penna.ask.st.src='qwen'; __penna.ask.run(${JSON.stringify(what)}); return 1`);
  await sleep(200);
  await P.waitFor(`!__penna.ask.st.busy`, 20000, 'risposta');
  return q(`__penna.ask.st.sent`);
}
const btn = () => q(`(() => { const b = document.getElementById('ask-mail'); return { hidden: b.hidden, disabled: b.disabled, text: b.textContent.trim() }; })()`);
try {
  await P.goto('file://' + (() => { fs.writeFileSync(OUT + '/trascrivi.html', HTML); return OUT + '/trascrivi.html'; })());
  const pr = await P.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(OUT + '/Quaderno di prova.pdf', Buffer.from(pr.data, 'base64'));
  await device(P, 1024, 768);
  await P.goto(APP); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.eval(`localStorage.setItem('penna.ai', JSON.stringify({ url: 'http://127.0.0.1:8768', token: ${JSON.stringify(TOKEN)}, privacy: 1, webPrivacy: 1, web: true, src: 'qwen', model: {} })); return 1`);
  await P.reload(); await P.waitFor('window.__penna && document.getElementById("btn-new-nb")');
  await P.waitFor(`__penna.ask.cfg.health && __penna.ask.cfg.health.bozza`, 10000, 'salute del bridge 8');
  ok('app v24; il bridge 8 dice che Gmail non è ancora collegato', (await q(`__penna.version`)) === 'v24' && (await q(`__penna.ask.cfg.health.bozza.ok`)) === false);
  await P.setFiles('#pdf-input', [OUT + '/Quaderno di prova.pdf']);
  await P.waitFor(`!document.getElementById('notebook').hidden && __penna.nb.pages.length === 5 && __penna.nb.pages[0].wrap.dataset.rendered==='1'`, 20000, 'PDF aperto');
  await P.eval(`__penna.ask.open(false); return 1`); await sleep(300);
  ok('tra le azioni c’è «Trascrivi»', await q(`[...document.querySelectorAll('#ask-acts button')].map((b) => b.textContent).join('|')`) === 'Spiega|Riassumi|Verifica|Obiezioni|Trascrivi');

  // 1. pagina senza scrittura a mano: non parte niente
  let n0 = ol.st.requests.length;
  await run('page', { action: 'pen' });
  ok('pagina senza segni: «non c’è scrittura a mano da trascrivere», nessuna richiesta', /non c’è scrittura a mano/.test(await q(`__penna.ask.st.error`)) && ol.st.requests.length === n0, await q(`__penna.ask.st.error`));

  // 2. pagina con la penna: foto + richiesta di trascrizione e analisi, mai il web
  await P.eval(`for (const i of [0, 1, 2, 4]) { const r=__penna.nb.pages[i].rec; r.strokes=${STROKE}; r.updated=Date.now(); } return 1`);
  let sent = await run('page', { action: 'pen' });
  const msg = sent.messages[0].content;
  ok('«Trascrivi» sulla pagina: una foto JPEG', sent.images && sent.images.length === 1 && sent.images[0].startsWith('/9j/'), sent.images && sent.images.length);
  ok('la richiesta: foto della pagina 1, «## Trascrizione», «## Analisi», [?] per le parole incerte, testo stampato come contesto',
    /c’è la foto della pagina 1 con la scrittura a mano/.test(msg) && msg.includes('## Trascrizione') && msg.includes('## Analisi') && msg.includes('[?]') && /Per contesto, il testo stampato della pagina 1:[\s\S]*rinnova il trópos/.test(msg), msg.slice(0, 900));
  ok('non cerca sul web anche se «Cerca sul web» è acceso', !sent.web && !sent.web_ctx);
  ok('nel pannello: «Pagina 1 · scrittura a mano»', (await q(`__penna.ask.st.ctxInfo`)) === 'Pagina 1 · scrittura a mano', await q(`__penna.ask.st.ctxInfo`));
  ok('la risposta arriva', (await q(`__penna.ask.st.answer`)).length > 10 && !(await q(`__penna.ask.st.error`)), await q(`__penna.ask.st.error`));

  // 3. Gmail non collegato: il pulsante c'è, spiega cosa fare, niente a Google
  let b = await btn();
  ok('pulsante «Bozza Gmail» visibile e attivo dopo la risposta', !b.hidden && !b.disabled && b.text === 'Bozza Gmail', b);
  P.eval(`__penna.ask.mail('anna@example.org'); return 1`);
  await P.waitFor(`document.getElementById('dlg').open`, 5000, 'finestra');
  ok('Gmail non collegato: finestra con il comando da lanciare sul Mac', (await q(`document.getElementById('dlg-title').textContent`)) === 'Gmail non è collegato' && /gmail_accesso\.py/.test(await q(`document.getElementById('dlg-text').textContent`)) && !gm.st.drafts.length);
  await P.eval(`document.getElementById('dlg-cancel').click(); return 1`); await sleep(200);

  // 4. Gmail collegato (gmail.json sul Mac): bozza con il PDF
  fs.writeFileSync(HOME + '/gmail.json', GMAIL_JSON, { mode: 0o600 });
  P.eval(`__penna.ask.mail(' anna@example.org; luca@example.com '); return 1`);
  await P.waitFor(`__penna.ask.st.mailed === true`, 15000, 'bozza');
  const raw = gm.st.drafts.at(-1) || '';
  const att = /Content-Disposition: attachment;[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(raw);
  const pdf = att ? Buffer.from(att[1].replace(/\s+/g, ''), 'base64') : Buffer.alloc(0);
  fs.writeFileSync(OUT + '/trascrizione.pdf', pdf);
  ok('una bozza a Google (l’app si accorge da sola che Gmail ora è collegato)', gm.st.drafts.length === 1 && gm.st.tokens === 1);
  ok('bozza: destinatari e oggetto «Quaderno di prova · trascrizione e analisi»', /^To: anna@example\.org, luca@example\.com$/m.test(raw) && /^Subject: Quaderno di prova =?[\s\S]{0,80}trascrizione e analisi|^Subject: .*=\?utf-8\?/m.test(raw), raw.slice(0, 300));
  ok('bozza: allegato un PDF vero di nome «Quaderno di prova.pdf»', pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 1500 && /filename="Quaderno di prova\.pdf"/.test(raw), pdf.length);
  const ms = await q(`__penna.ask.st.mailSent`);
  ok('all’interno: titolo, riga «Trascrizione e analisi · Pagina 1 · scrittura a mano · Qwen · data», risposta', ms && ms.subject === 'Quaderno di prova · trascrizione e analisi' && /^# Quaderno di prova\n\nTrascrizione e analisi · Pagina 1 · scrittura a mano · Qwen · \d\d\/\d\d\/\d{4}\n\n/.test(ms.text) && ms.text.includes(await q(`__penna.ask.st.answer`)), ms && ms.text.slice(0, 200));
  b = await btn();
  ok('pulsante: «Bozza creata ✓»; destinatari ricordati per la prossima volta', b.text === 'Bozza creata ✓' && (await q(`__penna.ask.cfg.mailTo`)) === 'anna@example.org, luca@example.com', b);
  const copie = fs.existsSync(HOME + '/copie/trascrizioni') ? fs.readdirSync(HOME + '/copie/trascrizioni') : [];
  ok('copia sul Mac: PDF e .md', copie.length === 2 && copie.some((f) => f.endsWith('.md')) && copie.some((f) => f.endsWith('.pdf')), copie);

  // 5. indirizzo sbagliato: niente parte
  await P.eval(`__penna.ask.mail('anna@@example'); return 1`); await sleep(400);
  ok('indirizzo non valido: nessuna bozza', gm.st.drafts.length === 1);

  // 6. «Tutto il PDF»: le pagine scritte a mano dalla corrente in avanti, al massimo 3; dice che ne restano
  ok('«Tutto il PDF»: azioni «Riassumi il PDF» e «Trascrivi le pagine scritte a mano»', await (async () => { await P.eval(`__penna.ask.st.scope='doc'; document.querySelector('.ask-scope [data-scope="doc"]').click(); return 1`); await sleep(200); return (await q(`[...document.querySelectorAll('#ask-acts button')].map((b) => b.textContent).join('|')`)) === 'Riassumi il PDF|Trascrivi le pagine scritte a mano'; })());
  sent = await run('doc', { action: 'pen' });
  ok('tre foto (pagine 1, 2, 3), in ordine nel messaggio', sent.images && sent.images.length === 3 && /ci sono le foto delle pagine 1, 2, 3 \(una per pagina, in questo ordine\)/.test(sent.messages[0].content), sent.messages[0].content.slice(0, 400));
  ok('nel pannello: «Pagine 1, 2, 3 · scrittura a mano (un’altra pagina scritta: spostati lì e ripeti)»', (await q(`__penna.ask.st.ctxInfo`)) === 'Pagine 1, 2, 3 · scrittura a mano (un’altra pagina scritta: spostati lì e ripeti)', await q(`__penna.ask.st.ctxInfo`));
  ok('risposta nuova: il pulsante torna «Bozza Gmail»', (await btn()).text === 'Bozza Gmail');
  const last = ol.st.requests.at(-1).messages.at(-1);
  ok('Ollama riceve le tre foto attraverso il bridge vero', Array.isArray(last.images) && last.images.length === 3);

  // 7. una domanda normale va in bozza anche lei; bridge vecchio: il pulsante non c'è
  await P.eval(`__penna.ask.cfg.web = false; return 1`);
  await run('page', { question: 'Di cosa parla?' });
  P.eval(`__penna.ask.mail(''); return 1`);
  await P.waitFor(`__penna.ask.st.mailed === true`, 15000, 'seconda bozza');
  ok('domanda normale: bozza senza destinatario, con la domanda nel testo', gm.st.drafts.length === 2 && !/^To:/m.test(gm.st.drafts[1]) && (await q(`__penna.ask.st.mailSent.text`)).includes('**Domanda:** Di cosa parla?') && (await q(`__penna.ask.st.mailSent.subject`)) === 'Quaderno di prova · domanda');
  await P.eval(`__penna.ask.cfg.health.bozza = null; __penna.ask.run({ question: 'Ancora?' }); return 1`); await sleep(200);
  await P.waitFor(`!__penna.ask.st.busy`, 20000, 'risposta');
  ok('bridge vecchio (senza «bozza»): pulsante nascosto', (await btn()).hidden === true);
  const logs = fs.readFileSync(blog, 'utf8');
  ok('registro del bridge: niente token, destinatari o testo', !logs.includes(TOKEN) && !/anna@|rt-buono|Quaderno di prova/.test(logs) && /bozza -> ok/.test(logs));
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e.stack || e));
} finally {
  bridge.kill(); await ol.close(); await gm.close(); try { await P.close(); } catch {}
  console.log('\nRISULTATO: ' + pass + '/' + (pass + fail) + ' ok');
  process.exit(fail ? 1 : 0);
}
