// Test del bridge del Mac Studio (studio-bridge/bridge.py), sul Mac dove girano i test.
// Qwen = finto Ollama (qui Ollama non c'è); Claude = finto `claude` (per controllare argomenti, stdin, ambiente, chiusure)
// e anche il `claude` VERO con l'abbonamento (una domanda banale). Poi: installazione e disinstallazione con un
// LaunchAgent di prova (etichetta e porta diverse da quelle vere), anche nel modo "curl | bash".
// Uso: node tests/bridge.mjs   (per la parte "curl | bash" serve il server statico su http://localhost:8088)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startOllama, QWEN_ANSWER } from './fakeollama.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BRIDGE = ROOT + '/studio-bridge/bridge.py';
const FAKE_CLAUDE = ROOT + '/tests/fake_claude.py';
const PY = process.env.PY || execFileSync('/usr/bin/which', ['python3']).toString().trim();
const GH = 'https://bifulcma.github.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + extra : '')); };
const TMP = fs.mkdtempSync(os.tmpdir() + '/sb-test-');
fs.chmodSync(FAKE_CLAUDE, 0o755);

// ---------- avvio di un bridge con la sua cartella (token + config) ----------
const bridges = [];
async function startBridge(name, cfg, env = {}) {
  const home = TMP + '/' + name; fs.mkdirSync(home, { recursive: true });
  const token = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
  fs.writeFileSync(home + '/token', token + '\n', { mode: 0o600 });
  fs.writeFileSync(home + '/config.json', JSON.stringify(cfg));
  const logf = home + '/bridge.log';
  const proc = spawn(PY, [BRIDGE], { env: { ...process.env, STUDIO_BRIDGE_HOME: home, ...env }, stdio: ['ignore', fs.openSync(logf, 'a'), fs.openSync(logf, 'a')] });
  const b = { name, home, token, port: cfg.port, proc, log: () => fs.readFileSync(logf, 'utf8') };
  bridges.push(b);
  for (let i = 0; i < 100; i++) { try { const r = await req(b, 'GET', '/', { auth: false }); if (r.status === 200) return b; } catch {} await sleep(100); }
  throw new Error('bridge ' + name + ' non parte:\n' + b.log());
}
// richiesta HTTP semplice
function req(b, method, p, { auth = true, token, origin, headers = {}, body, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.Authorization = 'Bearer ' + (token ?? b.token);
    if (origin) h.Origin = origin;
    let data = null;
    if (body !== undefined) { data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); h['Content-Type'] = h['Content-Type'] || 'application/json'; if (!('Content-Length' in h) && !h['Transfer-Encoding']) h['Content-Length'] = data.length; }
    const r = http.request({ host, port: b.port, method, path: p, headers: h }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => {
        const text = Buffer.concat(c).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data) { if (h['Transfer-Encoding']) { r.write(data); r.end(); } else r.end(data); } else r.end();
  });
}
// domanda in streaming: eventi con l'ora d'arrivo; stopAfter = chiudo io la connessione dopo N pezzi di testo
function ask(b, payload, { origin = GH, token, stopAfter = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const h = { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + (token ?? b.token) };
    if (origin) h.Origin = origin;
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port: b.port, method: 'POST', path: '/ask', headers: h }, (res) => {
      const out = { status: res.statusCode, headers: res.headers, events: [], raw: '' };
      let buf = '', texts = 0;
      res.setEncoding('utf8');
      res.on('data', (d) => {
        out.raw += d; buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let name = 'message', dat = '';
          for (const ln of block.split('\n')) { if (ln.startsWith('event: ')) name = ln.slice(7); else if (ln.startsWith('data: ')) dat += ln.slice(6); }
          if (!dat) continue;
          out.events.push({ name, data: JSON.parse(dat), t: Date.now() - t0 });
          if (name === 'text' && ++texts === stopAfter) { r.destroy(); resolve(out); }
        }
      });
      res.on('end', () => { try { out.json = JSON.parse(out.raw); } catch {} resolve(out); });
      res.on('error', () => resolve(out));
    });
    r.on('error', (e) => (stopAfter ? null : reject(e)));
    r.end(data);
  });
}
const textOf = (r) => r.events.filter((e) => e.name === 'text').map((e) => e.data.t).join('');
const last = (r) => r.events[r.events.length - 1] || {};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const fakeCalls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const ol = await startOllama(11991);
const DUMP = TMP + '/claude_calls.jsonl';
let A, B, C;
try {
  // A: Claude VERO (con una finta chiave API nell'ambiente: il bridge deve toglierla, altrimenti Claude userebbe l'API a pagamento)
  A = await startBridge('A', { port: 8791, ollama_url: 'http://127.0.0.1:11991', allowed_origins: [GH, 'http://localhost:8088'] }, { ANTHROPIC_API_KEY: 'chiave-api-finta-non-usare' });
  // B: Claude finto, tempi corti, 2 domande alla volta
  B = await startBridge('B', { port: 8792, ollama_url: 'http://127.0.0.1:11991', claude_bin: FAKE_CLAUDE, first_byte_timeout: 2, idle_timeout: 2, timeout: 8, max_concurrent: 2 },
    { FAKE_CLAUDE_DUMP: DUMP, ANTHROPIC_API_KEY: 'chiave-api-finta-non-usare' });
  // C: niente Ollama (porta chiusa) e niente claude nel PATH né nei posti soliti (HOME finta)
  C = await startBridge('C', { port: 8793, ollama_url: 'http://127.0.0.1:11999' }, { PATH: '/usr/bin:/bin', HOME: TMP + '/C-home' });

  // ---------- rete e autenticazione ----------
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    let reached = true; try { await req(A, 'GET', '/', { auth: false, host: lan.address }); } catch (e) { reached = e.code !== 'ECONNREFUSED'; }
    ok('ascolta solo su 127.0.0.1: dalla rete locale (' + lan.address + ') la porta è chiusa', !reached);
  }
  const root = await req(A, 'GET', '/', { auth: false });
  ok('GET / (senza token) dice solo che il bridge è attivo, utile per provare Tailscale da Safari', root.status === 200 && /attivo/.test(root.text) && !root.text.includes(A.token));
  ok('/health senza token → 401', (await req(A, 'GET', '/health', { auth: false })).status === 401);
  ok('/health con token sbagliato → 401', (await req(A, 'GET', '/health', { token: A.token.slice(0, -2) + 'xx' })).status === 401);
  ok('/health con token senza "Bearer" → 401', (await req(A, 'GET', '/health', { auth: false, headers: { Authorization: A.token } })).status === 401);
  ok('/ask senza token → 401 (e niente parte)', (await req(A, 'POST', '/ask', { auth: false, body: { provider: 'qwen', messages: [{ role: 'user', content: 'ciao' }] } })).status === 401 && ol.st.requests.length === 0);
  const t0 = Date.now();
  const h = await req(A, 'GET', '/health', { origin: GH });
  ok(`/health: Qwen ✓ (modello scelto da solo: ${h.json?.qwen?.default}), Claude ✓ (${h.json?.claude?.plan}) in ${Date.now() - t0} ms`,
    h.status === 200 && h.json.qwen.ok && h.json.qwen.default === 'qwen3:14b' && !h.json.qwen.models.some((m) => /embed/.test(m)) && h.json.claude.ok && h.json.claude.models.includes('opus'), h.text);
  ok('/health non rivela il token né percorsi del Mac', !h.text.includes(A.token) && !h.text.includes(os.homedir()));

  // ---------- CORS ----------
  const pre = await req(A, 'OPTIONS', '/ask', { auth: false, origin: GH, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true' } });
  ok('CORS: preflight dall’app → 204, origine esatta (non *), Authorization permesso, rete privata permessa',
    pre.status === 204 && pre.headers['access-control-allow-origin'] === GH && /Authorization/i.test(pre.headers['access-control-allow-headers']) && pre.headers['access-control-allow-private-network'] === 'true', JSON.stringify(pre.headers));
  const evil = await req(A, 'OPTIONS', '/ask', { auth: false, origin: 'https://sito-cattivo.example', headers: { 'Access-Control-Request-Method': 'POST' } });
  ok('CORS: preflight da un altro sito → 403 senza Access-Control-Allow-Origin', evil.status === 403 && !evil.headers['access-control-allow-origin']);
  const evil2 = await req(A, 'GET', '/health', { origin: 'https://bifulcma.github.io.evil.example' });
  ok('CORS: anche con il token giusto, da un’altra origine → 403', evil2.status === 403 && !evil2.headers['access-control-allow-origin']);
  ok('CORS: risposta all’app con Access-Control-Allow-Origin e Vary: Origin', h.headers['access-control-allow-origin'] === GH && /Origin/.test(h.headers.vary || ''));

  // ---------- Qwen (finto Ollama) ----------
  const q1 = await ask(A, { provider: 'qwen', system: 'Sei un assistente. Rispondi in italiano.', messages: [{ role: 'user', content: 'Spiega: la libertà è il dono più grande' }] });
  const texts = q1.events.filter((e) => e.name === 'text');
  ok('Qwen: risposta in streaming (SSE): meta → testo a pezzi → done', q1.status === 200 && /text\/event-stream/.test(q1.headers['content-type']) && q1.events[0].name === 'meta' && texts.length >= 5 && last(q1).name === 'done', JSON.stringify(q1.events.slice(0, 3)));
  ok(`Qwen: i pezzi arrivano man mano (primo a ${texts[0]?.t} ms, ultimo a ${texts[texts.length - 1]?.t} ms)`, texts.length && texts[texts.length - 1].t - texts[0].t > 500);
  ok('Qwen: il ragionamento <think>…</think> (anche spezzato a metà tag) non finisce nella risposta, ma si segnala', textOf(q1).trim() === QWEN_ANSWER && q1.events.some((e) => e.name === 'thinking'), JSON.stringify(textOf(q1)));
  const sent = ol.st.requests[ol.st.requests.length - 1];
  ok('Qwen: a Ollama arrivano istruzioni + domanda, modello giusto, contesto ampio (num_ctx 16384), streaming', sent.model === 'qwen3:14b' && sent.messages[0].role === 'system' && sent.messages[1].content.includes('libertà') && sent.options.num_ctx === 16384 && sent.stream === true);
  const q2 = await ask(A, { provider: 'qwen', model: 'llama3.2:3b', messages: [{ role: 'user', content: 'ciao' }] });
  ok('Qwen: si può scegliere un altro modello installato', q2.status === 200 && ol.st.requests[ol.st.requests.length - 1].model === 'llama3.2:3b');
  const q3 = await req(A, 'POST', '/ask', { body: { provider: 'qwen', model: 'qwen9:999b', messages: [{ role: 'user', content: 'ciao' }] } });
  ok('Qwen: modello che non c’è → 400 con messaggio chiaro', q3.status === 400 && /non c’è il modello/.test(q3.json?.error), q3.text);
  const q4 = await ask(A, { provider: 'qwen', messages: [{ role: 'user', content: 'ERRORE per favore' }] });
  ok('Qwen: errore di Ollama → evento "error" leggibile', last(q4).name === 'error' && /Qwen: out of memory/.test(last(q4).data.message));

  // ---------- richieste non valide ----------
  const bad = async (body, raw) => (await req(A, 'POST', '/ask', { body: raw ?? body }));
  ok('JSON rotto → 400', (await bad(null, '{"provider": "qwen", ')).status === 400);
  ok('sorgente sconosciuta → 400', (await bad({ provider: 'gpt', messages: [{ role: 'user', content: 'x' }] })).status === 400);
  ok('ruolo "system" dentro i messaggi → 400', (await bad({ provider: 'qwen', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }] })).status === 400);
  ok('ultimo messaggio non dell’utente → 400', (await bad({ provider: 'qwen', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] })).status === 400);
  ok('carattere NUL → 400', (await bad({ provider: 'claude', messages: [{ role: 'user', content: 'a\u0000b' }] })).status === 400);
  for (const m of ['--dangerously-skip-permissions', 'sonnet --tools default', 'opus;rm -rf ~', '../../bin/sh', 'gpt-4']) {
    const r = await bad({ provider: 'claude', model: m, messages: [{ role: 'user', content: 'x' }] });
    ok('modello Claude «' + m + '» → 400', r.status === 400, r.text);
  }
  const big = await req(A, 'POST', '/ask', { body: { provider: 'qwen', messages: [{ role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }] } }).catch((e) => ({ status: 'errore ' + e.code }));
  ok('testo enorme (3 MB) → 413 «Testo troppo lungo»', big.status === 413 && /troppo lungo/.test(big.json?.error), String(big.status));
  const nearly = await ask(A, { provider: 'qwen', messages: [{ role: 'user', content: 'parola '.repeat(270000) + 'fine' }] });
  ok('testo lungo ma nei limiti (1,9 MB) → passa', nearly.status === 200 && last(nearly).name === 'done' && ol.st.requests[ol.st.requests.length - 1].messages[0].content.length > 1.8e6);
  const chunked = await req(A, 'POST', '/ask', { body: { provider: 'qwen', messages: [{ role: 'user', content: 'x' }] }, headers: { 'Transfer-Encoding': 'chunked' } });
  ok('richiesta senza lunghezza (chunked) → 411', chunked.status === 411);
  for (const p of ['/token', '/../token', '/health/../token', '/%2e%2e/%2e%2e/etc/passwd', '/config.json']) {
    const r = await req(A, 'GET', p);
    ok('niente file serviti: GET ' + p + ' → 404', r.status === 404 && !r.text.includes(A.token));
  }
  ok('POST su /health → 404', (await req(A, 'POST', '/health', { body: {} })).status === 404);

  // ---------- Claude finto: come viene avviato ----------
  const c1 = await ask(B, { provider: 'claude', model: 'opus', system: 'ISTRUZIONI DI PROVA', messages: [{ role: 'user', content: 'Domanda segreta $(rm -rf ~) `id` ; echo ciao' }] });
  const call = fakeCalls(DUMP).pop();
  const av = call.argv;
  ok('Claude: risposta in streaming (pezzi + done), "pensa" segnalato', textOf(c1) === 'Risposta finta di **Claude**.' && last(c1).name === 'done' && c1.events.some((e) => e.name === 'thinking'), JSON.stringify(c1.events));
  ok('Claude: avviato con -p, --tools "" (nessuno strumento), --no-session-persistence, --model=opus, stream-json',
    av[0] === '-p' && av[av.indexOf('--tools') + 1] === '' && av.includes('--no-session-persistence') && av.includes('--model=opus') && av[av.indexOf('--output-format') + 1] === 'stream-json', JSON.stringify(av));
  ok('Claude: anche --safe-mode, --strict-mcp-config, --disable-slash-commands, hook spenti (niente CLAUDE.md, MCP, plugin, hook)',
    av.includes('--safe-mode') && av.includes('--strict-mcp-config') && av.includes('--disable-slash-commands') && av.some((a) => a === '--settings={"disableAllHooks": true}'), JSON.stringify(av));
  ok('Claude: la domanda arriva da stdin (non negli argomenti, nessuna shell: $(…) e ` restano testo)', call.stdin === 'Domanda segreta $(rm -rf ~) `id` ; echo ciao' && !av.some((a) => a.includes('Domanda segreta')));
  ok('Claude: istruzioni di sistema passate come un solo argomento --system-prompt=…', av.filter((a) => a.startsWith('--system-prompt=')).length === 1 && av.includes('--system-prompt=ISTRUZIONI DI PROVA'));
  ok('Claude: la chiave API a pagamento viene tolta dall’ambiente (si usa l’abbonamento)', call.api_key === false);
  ok('Claude: parte da una cartella vuota, in un gruppo di processi suo', call.cwd === fs.realpathSync(B.home + '/vuota') && call.cwd_files.length === 0 && call.pgid === call.pid, call.cwd);
  await ask(B, { provider: 'claude', messages: [{ role: 'user', content: 'Prima domanda' }, { role: 'assistant', content: 'Prima risposta' }, { role: 'user', content: 'Seconda domanda' }] });
  const call2 = fakeCalls(DUMP).pop();
  ok('Claude: conversazione con più messaggi → un solo testo con i turni; modello predefinito sonnet', /Utente:\nPrima domanda/.test(call2.stdin) && /Assistente:\nPrima risposta/.test(call2.stdin) && /Seconda domanda$/.test(call2.stdin) && call2.argv.includes('--model=sonnet'));
  const lim = await ask(B, { provider: 'claude', messages: [{ role: 'user', content: 'LIMITE' }] });
  ok('Claude: abbonamento esaurito → messaggio chiaro (e suggerisce Qwen)', last(lim).name === 'error' && /finito i messaggi dell’abbonamento/.test(last(lim).data.message) && /Qwen/.test(last(lim).data.message));

  // ---------- tempi massimi ----------
  let t = Date.now();
  const slowQ = await ask(B, { provider: 'qwen', messages: [{ role: 'user', content: 'LENTO' }] });
  ok(`timeout Qwen: Ollama muto → errore «non ha risposto in tempo» dopo ${Date.now() - t} ms`, last(slowQ).name === 'error' && /non ha risposto in tempo/.test(last(slowQ).data.message) && Date.now() - t < 6000);
  t = Date.now();
  const slowC = await ask(B, { provider: 'claude', messages: [{ role: 'user', content: 'LENTO' }] });
  const slowCall = fakeCalls(DUMP).pop();
  await sleep(500);
  ok(`timeout Claude: errore dopo ${Date.now() - t} ms e il processo claude viene chiuso`, last(slowC).name === 'error' && /in tempo/.test(last(slowC).data.message) && !alive(slowCall.pid));

  // ---------- l'iPad chiude il pannello: il lavoro sul Mac si ferma ----------
  const before = ol.st.closedEarly;
  await ask(B, { provider: 'qwen', messages: [{ role: 'user', content: 'LUNGO' }] }, { stopAfter: 2 });
  await sleep(1500);
  ok('Ferma/chiudi durante Qwen → la richiesta a Ollama viene chiusa subito', ol.st.closedEarly === before + 1 && ol.st.open === 0);
  await ask(B, { provider: 'claude', messages: [{ role: 'user', content: 'LUNGO' }] }, { stopAfter: 2 });
  const longCall = fakeCalls(DUMP).pop();
  await sleep(1500);
  ok('Ferma/chiudi durante Claude → il processo claude viene chiuso', !alive(longCall.pid));

  // ---------- al massimo 2 domande insieme ----------
  const p1 = ask(B, { provider: 'qwen', messages: [{ role: 'user', content: 'LUNGO' }] }, { stopAfter: 3 });
  const p2 = ask(B, { provider: 'qwen', messages: [{ role: 'user', content: 'LUNGO' }] }, { stopAfter: 3 });
  await sleep(250);
  const third = await req(B, 'POST', '/ask', { body: { provider: 'qwen', messages: [{ role: 'user', content: 'ciao' }] } });
  await Promise.all([p1, p2]); await sleep(1200);
  ok('terza domanda mentre ne girano già 2 → 429 «riprova tra poco»', third.status === 429 && /riprova tra poco/.test(third.json?.error));
  const after = await ask(B, { provider: 'qwen', messages: [{ role: 'user', content: 'ciao' }] });
  ok('chiuse le prime due, si può chiedere di nuovo', after.status === 200 && last(after).name === 'done');

  // ---------- servizi non disponibili ----------
  const hc = await req(C, 'GET', '/health');
  ok('Ollama spento → /health dice Qwen ✗ «Ollama non risponde… apri l’app Ollama»', hc.status === 200 && !hc.json.qwen.ok && /Ollama non risponde/.test(hc.json.qwen.error), hc.text);
  ok('claude assente → /health dice Claude ✗ «non trovo il comando claude»', !hc.json.claude.ok && /non trovo il comando/.test(hc.json.claude.error), hc.text);
  const aq = await req(C, 'POST', '/ask', { body: { provider: 'qwen', messages: [{ role: 'user', content: 'ciao' }] } });
  const ac = await req(C, 'POST', '/ask', { body: { provider: 'claude', messages: [{ role: 'user', content: 'ciao' }] } });
  ok('domanda a Qwen con Ollama spento → 503 con messaggio leggibile', aq.status === 503 && /Ollama/.test(aq.json?.error));
  ok('domanda a Claude senza claude → 503 con messaggio leggibile', ac.status === 503 && /claude/.test(ac.json?.error));

  // ---------- Claude VERO (abbonamento) ----------
  t = Date.now();
  const real = await ask(A, { provider: 'claude', model: 'sonnet', system: 'Rispondi in italiano, brevissimo.', messages: [{ role: 'user', content: 'Rispondi soltanto con la parola: pesca' }] });
  const rt = textOf(real);
  ok(`Claude vero (sonnet, abbonamento, chiave API finta tolta): «${rt.trim().slice(0, 40)}» in ${((Date.now() - t) / 1000).toFixed(1)} s`, real.status === 200 && /pesca/i.test(rt) && last(real).name === 'done', JSON.stringify(real.events.slice(-3)));

  // ---------- registro e controlli di sicurezza sul codice ----------
  const logs = A.log() + B.log();
  ok('registro: niente token e niente testi delle domande', !logs.includes(A.token) && !logs.includes(B.token) && !logs.includes('libertà') && !logs.includes('Domanda segreta') && /ask qwen qwen3:14b/.test(logs));
  const src = fs.readFileSync(BRIDGE, 'utf8').replace(/^\s*#.*$/gm, '');
  ok('codice: niente shell (shell=True, os.system, os.popen), niente eval/exec/pickle', !/shell\s*=\s*True|os\.system|os\.popen|\beval\(|\bexec\(|pickle|commands\./.test(src));
  ok('codice: due Popen (risposta e, col web, scelta delle ricerche), entrambi con gli argomenti fissi in lista di self.args(); host fisso 127.0.0.1', (src.match(/Popen\(/g) || []).length === 2 && (src.match(/Popen\(self\.args\(/g) || []).length === 2 && /HOST = '127\.0\.0\.1'/.test(src) && /Server\(\(HOST,/.test(src));
  ok('codice: i file aperti sono solo token, config, claude-token nella cartella del bridge', [...src.matchAll(/(?<![A-Za-z_.])open\(([^,)]+)/g)].every((m) => /^(path|tok)$/.test(m[1].trim())), [...src.matchAll(/(?<![A-Za-z_.])open\(([^,)]+)/g)].map((m) => m[1]).join(' | '));
  const tokMode = fs.statSync(A.home + '/token').mode & 0o777;
  ok('token leggibile solo dal proprietario (600)', tokMode === 0o600, tokMode.toString(8));
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); for (const b of bridges) console.log('--- log ' + b.name + '\n' + b.log().slice(-1500)); }
for (const b of bridges) b.proc.kill('SIGTERM');
for (let i = 0; i < 30 && !bridges.every((b) => b.proc.exitCode !== null || b.proc.signalCode !== null); i++) await sleep(100);
ok('il bridge si chiude con SIGTERM (come fa launchd)', bridges.every((b) => b.proc.exitCode !== null || b.proc.signalCode !== null));
await ol.close();

// ======================= install.sh / uninstall.sh (LaunchAgent di prova, poi tolto) =======================
const INST = ROOT + '/studio-bridge/install.sh', UNINST = ROOT + '/studio-bridge/uninstall.sh';
if (process.env.SKIP_INSTALL) console.log('(installazione saltata)');
else try {
  const fakeHome = TMP + '/home-inst'; fs.mkdirSync(fakeHome, { recursive: true });
  const LABEL = 'com.marco.studio-bridge.test', PORT = '8795';
  const env = { ...process.env, HOME: fakeHome, SB_LABEL: LABEL, SB_PORT: PORT, SB_NO_TAILSCALE_SERVE: '1' };
  const run = (cmd, args, extra = {}) => { try { return { code: 0, out: execFileSync(cmd, args, { env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }) }; } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; } };
  for (const f of [INST, UNINST]) ok('sintassi bash ok: ' + path.basename(f), run('bash', ['-n', f]).code === 0);
  const r1 = run('bash', [INST]);
  const dir = fakeHome + '/.studio-bridge', plist = fakeHome + '/Library/LaunchAgents/' + LABEL + '.plist';
  const tok = fs.existsSync(dir + '/token') ? fs.readFileSync(dir + '/token', 'utf8').trim() : '';
  ok('install.sh: finisce bene', r1.code === 0, r1.out.slice(-800));
  if (process.env.V) console.log(r1.out);
  ok('install.sh: controlla python3, ollama, claude, tailscale con messaggi in italiano', /Python 3/.test(r1.out) && /Ollama/.test(r1.out) && /Claude/.test(r1.out) && /Tailscale/.test(r1.out));
  ok('install.sh: file copiati in ~/.studio-bridge, token di 43 caratteri con permessi 600', fs.existsSync(dir + '/bridge.py') && fs.existsSync(dir + '/uninstall.sh') && tok.length === 43 && (fs.statSync(dir + '/token').mode & 0o777) === 0o600);
  ok('install.sh: mostra token e indirizzo https di Tailscale (…ts.net) da incollare nell’app', r1.out.includes(tok) && /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net/.test(r1.out) && /Impostazioni › Assistente/.test(r1.out));
  ok('install.sh: LaunchAgent valido (plutil), RunAtLoad e KeepAlive', fs.existsSync(plist) && run('plutil', ['-lint', plist]).code === 0 && /<key>RunAtLoad<\/key>\s*<true\/>/.test(fs.readFileSync(plist, 'utf8')) && /<key>KeepAlive<\/key>\s*<true\/>/.test(fs.readFileSync(plist, 'utf8')));
  const hb = { port: +PORT, token: tok };
  let hh = null; for (let i = 0; i < 40 && !hh; i++) { try { const r = await req(hb, 'GET', '/health'); if (r.status === 200) hh = r; } catch {} if (!hh) await sleep(250); }
  ok('install.sh: il bridge parte da solo con launchd e risponde a /health', !!hh && hh.json.ok === true, hh ? hh.text : '');
  const launchList = run('launchctl', ['list']).out;
  ok('launchd: il servizio è caricato', launchList.includes(LABEL));
  // KeepAlive: se il bridge cade, launchd lo riavvia
  const pid = +((run('launchctl', ['list', LABEL]).out.match(/"PID" = (\d+);/) || [])[1] || 0);
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  let back = false; for (let i = 0; i < 60 && !back; i++) { await sleep(500); try { back = (await req(hb, 'GET', '/health')).status === 200; } catch {} }
  ok('launchd KeepAlive: bridge ucciso → riparte da solo', pid > 0 && back);
  const r2 = run('bash', [INST]);
  const tok2 = fs.readFileSync(dir + '/token', 'utf8').trim();
  ok('install.sh rilanciato (idempotente): stesso token, non lo ristampa ma dice come rivederlo', r2.code === 0 && tok2 === tok && !r2.out.includes(tok) && /cat ~\/\.studio-bridge\/token/.test(r2.out), r2.out.slice(-600));
  // modo "curl | bash": lo script arriva da stdin e scarica i file dall'indirizzo base
  let srvUp = false; try { srvUp = (await fetch('http://localhost:8088/studio-bridge/bridge.py')).ok; } catch {}
  if (srvUp) {
    fs.rmSync(dir + '/bridge.py');
    const r3 = run('bash', ['-c', 'curl -fsSL http://localhost:8088/studio-bridge/install.sh | bash'], { SB_BASE_URL: 'http://localhost:8088/studio-bridge' });
    ok('install.sh con "curl … | bash": scarica i file e finisce bene', r3.code === 0 && fs.existsSync(dir + '/bridge.py') && /Fatto/.test(r3.out), r3.out.slice(-600));
    let h3 = null; for (let i = 0; i < 40 && !h3; i++) { try { const r = await req(hb, 'GET', '/health'); if (r.status === 200) h3 = r; } catch {} if (!h3) await sleep(250); }
    ok('dopo "curl | bash" il bridge risponde', !!h3);
  } else console.log('(salto "curl | bash": server statico su 8088 spento)');
  const r4 = run('bash', [dir + '/uninstall.sh']);
  await sleep(800);
  let gone = false; try { await req(hb, 'GET', '/'); } catch (e) { gone = e.code === 'ECONNREFUSED'; }
  ok('uninstall.sh: servizio fermato e tolto, file cancellati', r4.code === 0 && gone && !fs.existsSync(plist) && !fs.existsSync(dir) && !run('launchctl', ['list']).out.includes(LABEL), r4.out.slice(-500));
} catch (e) { fail++; console.log('FAIL eccezione installazione', e.stack); }
finally { try { execFileSync('launchctl', ['bootout', 'gui/' + process.getuid() + '/com.marco.studio-bridge.test'], { stdio: 'ignore' }); } catch {} }

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
