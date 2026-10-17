import { spawn } from 'node:child_process';
import fs from 'node:fs';
export const OUT = process.env.OUT || '/tmp/penna-out';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port) {
  const dir = fs.mkdtempSync(OUT + '/prof-');
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1024,768', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
    await sleep(100);
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const tab = list.find((t) => t.type === 'page');
  const page = new Page(tab.webSocketDebuggerUrl);
  await page.ready;
  page.proc = proc; page.dir = dir;
  return page;
}

export class Page {
  constructor(url) {
    this.id = 0; this.cbs = new Map(); this.logs = []; this.handlers = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res) => { this.ws.onopen = res; });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.cbs.has(d.id)) { const { res, rej } = this.cbs.get(d.id); this.cbs.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
      else if (d.method) {
        if (d.method === 'Runtime.consoleAPICalled') this.logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
        if (d.method === 'Runtime.exceptionThrown') this.logs.push('EXC: ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
        for (const h of this.handlers) h(d);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.cbs.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async init() { await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('DOM.enable'); await this.send('Network.enable'); }
  async goto(url) {
    const loaded = new Promise((r) => { const h = (d) => { if (d.method === 'Page.loadEventFired') { this.handlers = this.handlers.filter((x) => x !== h); r(); } }; this.handlers.push(h); });
    await this.send('Page.navigate', { url }); await loaded;
  }
  async reload() {
    const loaded = new Promise((r) => { const h = (d) => { if (d.method === 'Page.loadEventFired') { this.handlers = this.handlers.filter((x) => x !== h); r(); } }; this.handlers.push(h); });
    await this.send('Page.reload'); await loaded;
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr.slice(0, 200));
    return r.result.value;
  }
  async waitFor(expr, ms = 10000, what = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await this.eval('return ' + expr)) return true; } catch {} await sleep(100); }
    throw new Error('timeout: ' + what);
  }
  async shot(path, w, h, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await sleep(500);
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  }
  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await this.send('DOM.setFileInputFiles', { files, nodeId });
  }
  async type(text) { await this.send('Input.insertText', { text }); }
  close() { try { this.ws.close(); } catch {} this.proc.kill(); }
}
