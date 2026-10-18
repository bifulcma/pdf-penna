// Aiuti per i test del bridge (studio-bridge/bridge.py): avvio con la sua cartella, richieste HTTP, domande in streaming (SSE).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const BRIDGE = ROOT + '/studio-bridge/bridge.py';
export const FAKE_CLAUDE = ROOT + '/tests/fake_claude.py';
export const PY = process.env.PY || execFileSync('/usr/bin/which', ['python3']).toString().trim();
export const GH = 'https://bifulcma.github.io';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const TMP = fs.mkdtempSync(os.tmpdir() + '/sb-test-');
fs.chmodSync(FAKE_CLAUDE, 0o755);

const bridges = [];
// files: altri file nella cartella del bridge (es. { 'tavily.key': '…' }, sempre con permessi 600)
export async function startBridge(name, cfg, env = {}, files = {}) {
  const home = TMP + '/' + name; fs.mkdirSync(home, { recursive: true });
  const token = execFileSync(PY, ['-c', 'import secrets;print(secrets.token_urlsafe(32))']).toString().trim();
  fs.writeFileSync(home + '/token', token + '\n', { mode: 0o600 });
  fs.writeFileSync(home + '/config.json', JSON.stringify(cfg));
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(home + '/' + f, v, { mode: 0o600 });
  const logf = home + '/bridge.log';
  const base = { ...process.env }; delete base.TAVILY_API_KEY; // solo se il test la passa apposta
  const proc = spawn(PY, [BRIDGE], { env: { ...base, STUDIO_BRIDGE_HOME: home, ...env }, stdio: ['ignore', fs.openSync(logf, 'a'), fs.openSync(logf, 'a')] });
  const b = { name, home, token, port: cfg.port, proc, log: () => fs.readFileSync(logf, 'utf8') };
  bridges.push(b);
  for (let i = 0; i < 100; i++) { try { const r = await req(b, 'GET', '/', { auth: false }); if (r.status === 200) return b; } catch {} await sleep(100); }
  throw new Error('bridge ' + name + ' non parte:\n' + b.log());
}
export async function stopBridges() {
  for (const b of bridges) b.proc.kill('SIGTERM');
  for (let i = 0; i < 30 && !bridges.every((b) => b.proc.exitCode !== null || b.proc.signalCode !== null); i++) await sleep(100);
}
export const allBridges = () => bridges;

export function req(b, method, p, { auth = true, token, origin, headers = {}, body, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.Authorization = 'Bearer ' + (token ?? b.token);
    if (origin) h.Origin = origin;
    let data = null;
    if (body !== undefined) { data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); h['Content-Type'] = h['Content-Type'] || 'application/json'; h['Content-Length'] = data.length; }
    const r = http.request({ host, port: b.port, method, path: p, headers: h }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => {
        const text = Buffer.concat(c).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data) r.end(data); else r.end();
  });
}
// domanda in streaming: eventi con l'ora d'arrivo
export function ask(b, payload, { origin = GH, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const h = { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + (token ?? b.token) };
    if (origin) h.Origin = origin;
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port: b.port, method: 'POST', path: '/ask', headers: h }, (res) => {
      const out = { status: res.statusCode, headers: res.headers, events: [], raw: '' };
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        out.raw += d; buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let name = 'message', dat = '';
          for (const ln of block.split('\n')) { if (ln.startsWith('event: ')) name = ln.slice(7); else if (ln.startsWith('data: ')) dat += ln.slice(6); }
          if (dat) out.events.push({ name, data: JSON.parse(dat), t: Date.now() - t0 });
        }
      });
      res.on('end', () => { try { out.json = JSON.parse(out.raw); } catch {} out.ms = Date.now() - t0; resolve(out); });
      res.on('error', () => resolve(out));
    });
    r.on('error', reject);
    r.end(data);
  });
}
export const textOf = (r) => r.events.filter((e) => e.name === 'text').map((e) => e.data.t).join('');
export const last = (r) => r.events[r.events.length - 1] || {};
export const evs = (r, name) => r.events.filter((e) => e.name === name);
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const fakeCalls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
