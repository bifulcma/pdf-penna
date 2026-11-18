// Test del bridge 7 (15/11/2026): foto della pagina con la scrittura a mano, per Ollama e per Claude.
// Finto Ollama + finto `claude`, nessun modello vero. Uso: node tests/immagini.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { startOllama } from './fakeollama.mjs';
import { startTavily, KEY } from './faketavily.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PY = process.env.PY || execFileSync('/usr/bin/which', ['python3']).toString().trim();
const FAKE_CLAUDE = ROOT + '/tests/fake_claude.py';
const TMP = fs.mkdtempSync(os.tmpdir() + '/sb-img-');
const DUMP = TMP + '/claude.jsonl';
fs.chmodSync(FAKE_CLAUDE, 0o755);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (!c && x !== '' ? '  — ' + x : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// una piccola JPEG vera (1x1) e una PNG vera
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const home = TMP + '/b'; fs.mkdirSync(home);
const token = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
fs.writeFileSync(home + '/token', token + '\n', { mode: 0o600 });
fs.writeFileSync(home + '/tavily.key', KEY + '\n', { mode: 0o600 });
fs.writeFileSync(home + '/config.json', JSON.stringify({ port: 8797, ollama_url: 'http://127.0.0.1:11997', tavily_url: 'http://127.0.0.1:11998', claude_bin: FAKE_CLAUDE }));
const tv = await startTavily(11998, { delay: 10 });
const oll = await startOllama(11997);
const proc = spawn(PY, [ROOT + '/studio-bridge/bridge.py'], { env: { ...process.env, STUDIO_BRIDGE_HOME: home, FAKE_CLAUDE_DUMP: DUMP }, stdio: ['ignore', fs.openSync(TMP + '/log', 'a'), fs.openSync(TMP + '/log', 'a')] });
function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = { Authorization: 'Bearer ' + token, Origin: 'https://bifulcma.github.io' };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port: 8797, method, path: p, headers: h }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, text: t, json: j }); });
    });
    r.on('error', reject); r.end(data || undefined);
  });
}
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await call('GET', '/health')).status === 200; } catch {} if (!up) await sleep(100); }
try {
  const h = (await call('GET', '/health')).json;
  ok('health: versione 7 o successiva e immagini disponibili', h && +h.version >= 7 && h.immagini && h.immagini.ok && h.immagini.claude, JSON.stringify(h && h.immagini));
  const msg = [{ role: 'user', content: 'Che cosa ho scritto a mano?' }];

  let r = await call('POST', '/ask', { provider: 'qwen', model: 'qwen3:14b', messages: msg, images: [JPEG] });
  const last = oll.st.requests.at(-1)?.messages.at(-1);
  ok('Ollama: risposta in streaming', r.status === 200 && r.text.includes('event: text'), r.text.slice(0, 200));
  ok('Ollama: la foto arriva nel campo images dell’ultimo messaggio', last && Array.isArray(last.images) && last.images[0] === JPEG, JSON.stringify(last).slice(0, 200));

  r = await call('POST', '/ask', { provider: 'qwen', model: 'qwen3:14b', messages: msg });
  ok('Ollama senza foto: nessun campo images (come prima)', !('images' in oll.st.requests.at(-1).messages.at(-1)));

  fs.rmSync(DUMP, { force: true });
  r = await call('POST', '/ask', { provider: 'claude', model: 'sonnet', messages: msg, images: [PNG] });
  const rec = fs.existsSync(DUMP) ? JSON.parse(fs.readFileSync(DUMP, 'utf8').trim().split('\n').at(-1)) : null;
  ok('Claude: risposta in streaming', r.status === 200 && r.text.includes('event: text'), r.text.slice(0, 300));
  ok('Claude: parte con --input-format stream-json', rec && rec.argv.join(' ').includes('--input-format stream-json'), rec && rec.argv.join(' '));
  let line = null; try { line = JSON.parse(rec.stdin); } catch {}
  const content = line && line.message && line.message.content;
  ok('Claude: stdin è un messaggio JSON con immagine PNG e testo', content && content[0].type === 'image' && content[0].source.media_type === 'image/png'
     && content[0].source.data === PNG && content.at(-1).type === 'text' && content.at(-1).text.includes('scritto a mano'), rec && rec.stdin.slice(0, 200));
  ok('Claude: nessuno strumento (niente file, niente comandi)', rec && rec.argv[rec.argv.indexOf('--tools') + 1] === '');

  fs.rmSync(DUMP, { force: true });
  await call('POST', '/ask', { provider: 'claude', model: 'sonnet', messages: msg });
  const rec2 = JSON.parse(fs.readFileSync(DUMP, 'utf8').trim().split('\n').at(-1));
  ok('Claude senza foto: testo semplice come prima', !rec2.argv.includes('--input-format') && rec2.stdin.startsWith('Che cosa'));

  // web + foto (15/11): la foto va anche al passo che sceglie le ricerche
  const ctxW = { title: 'Appunti', question: 'Riassumi questa pagina in pochi punti essenziali', quote: '', near: '', page: 1 };
  let p0 = oll.st.plans.length, t0 = tv.st.requests.length;
  r = await call('POST', '/ask', { provider: 'qwen', model: 'qwen3:14b', messages: [{ role: 'user', content: 'Riassumi questa pagina. Sufyani' }], images: [JPEG], web: true, web_ctx: { ...ctxW, question: 'Riassumi Sufyani' } });
  const plan = oll.st.plans[p0];
  ok('web: il passo che sceglie le ricerche riceve la foto', plan && plan.messages[1].images && plan.messages[1].images[0] === JPEG && /scrittura a mano/.test(plan.messages[1].content), JSON.stringify(plan && plan.messages[1]).slice(0, 300));
  ok('web: con un piano buono si cerca su Tavily e si risponde', tv.st.requests.length > t0 && r.text.includes('event: done'), r.text.slice(-300));
  // il modello non propone ricerche: prima si cercava la domanda alla lettera («Riassumi questa pagina…»)
  p0 = oll.st.plans.length; t0 = tv.st.requests.length;
  r = await call('POST', '/ask', { provider: 'qwen', model: 'qwen3:14b', messages: [{ role: 'user', content: 'Riassumi questa pagina. PIANO-ROTTO' }], images: [JPEG], web: true, web_ctx: { ...ctxW, question: ctxW.question + ' piano-vuoto' } });
  ok('web: solo scrittura a mano e nessuna ricerca proposta → niente ricerche a caso', tv.st.requests.length === t0, JSON.stringify(tv.st.requests.slice(t0).map((x) => x.body && x.body.query)));
  ok('web: si risponde lo stesso, dalla pagina', r.text.includes('Niente da cercare sul web') && r.text.includes('event: text') && r.text.includes('event: done'), r.text.slice(0, 400));
  const lastW = oll.st.requests.at(-1).messages.at(-1);
  ok('web saltato: la domanda finale ha la foto e niente blocco fonti', lastW.images && lastW.images[0] === JPEG && !/Fonti dal web/.test(lastW.content));

  r = await call('POST', '/ask', { provider: 'argon', messages: msg, images: [JPEG] });
  ok('Argon con foto: rifiutato con un messaggio chiaro', r.status === 400 && /Argon non legge/.test(r.text), r.text);
  r = await call('POST', '/ask', { provider: 'qwen', messages: msg, images: ['QUJDREVGR0hJSktMTU5PUFFSU1RVVg=='] });
  ok('Immagine che non è JPEG/PNG: rifiutata', r.status === 400, r.text);
  r = await call('POST', '/ask', { provider: 'qwen', messages: msg, images: [JPEG, JPEG, JPEG, JPEG] });
  ok('Più di 3 immagini: rifiutate', r.status === 400, r.text);
  r = await call('POST', '/ask', { provider: 'qwen', messages: msg, images: ['%%%non-base64%%%'] });
  ok('Base64 rovinato: rifiutato', r.status === 400, r.text);
} finally {
  if (fail || !pass) console.log(fs.existsSync(TMP + '/log') ? fs.readFileSync(TMP + '/log', 'utf8').slice(-1500) : 'nessun log');
  proc.kill(); await oll.close(); await tv.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nRISULTATO: ' + pass + '/' + (pass + fail) + ' ok');
  process.exit(fail ? 1 : 0);
}
