// Aiuti comuni dei test "da iPad": API moderne tolte (come un Safari vecchio), tocchi veri, penna, misure dei pulsanti.
import fs from 'node:fs';
import { launch, sleep } from './cdp.mjs';

// ---------- API che Safari 16.4/17 non ha: le tolgo prima di ogni script (pagina e worker) ----------
export const STRIP = `(function(g){const del=(o,k)=>{try{delete o[k]}catch(e){}};
del(Promise,'withResolvers');del(Promise,'try');
const IP=Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
for(const k of ['map','filter','take','drop','flatMap','reduce','toArray','forEach','some','every','find'])del(IP,k);del(g,'Iterator');
for(const k of ['toHex','toBase64','setFromHex','setFromBase64'])del(Uint8Array.prototype,k);del(Uint8Array,'fromHex');del(Uint8Array,'fromBase64');
del(g,'Float16Array');del(Math,'f16round');del(Math,'sumPrecise');
for(const C of [Map,WeakMap]){del(C.prototype,'getOrInsert');del(C.prototype,'getOrInsertComputed');}
del(URL,'parse');del(RegExp,'escape');del(ArrayBuffer.prototype,'transfer');del(ArrayBuffer.prototype,'transferToFixedLength');
del(Object,'groupBy');del(Map,'groupBy');if(g.AbortSignal)del(AbortSignal,'any');del(Error,'isError');
for(const k of ['union','intersection','difference','symmetricDifference','isSubsetOf','isSupersetOf','isDisjointFrom'])del(Set.prototype,k);
if(g.ReadableStream){del(ReadableStream.prototype,Symbol.asyncIterator);del(ReadableStream.prototype,'values');del(ReadableStream,'from');}
for(const C of [g.Response,g.Request,g.Blob])if(C)del(C.prototype,'bytes');del(g,'ImageDecoder');g.__stripped=true;})(typeof self!=='undefined'?self:globalThis);\n`;

// Browser con le richieste di polyfills.js intercettate: 'strip' = API tolte + nostri polyfill; 'nopoly' = API tolte e basta
export async function browser(port, mode) {
  const P = await launch(port); await P.init();
  P.polyHits = 0;
  if (mode) {
    await P.send('Network.setBypassServiceWorker', { bypass: true });
    await P.send('Fetch.enable', { patterns: [{ urlPattern: '*polyfills.js*', requestStage: 'Response' }] });
    const orig = fs.readFileSync(new URL('../polyfills.js', import.meta.url), 'utf8');
    P.handlers.push(async (d) => {
      if (d.method !== 'Fetch.requestPaused') return;
      P.polyHits++;
      const body = STRIP + (mode === 'nopoly' ? '' : orig);
      await P.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(body).toString('base64') });
    });
  }
  // UA=ipad: mi presento come Safari su iPad (attiva i limiti di memoria pensati per iPad/iPhone)
  if (process.env.UA === 'ipad') await P.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1', platform: 'iPad' });
  await P.send('Page.setInterceptFileChooserDialog', { enabled: true });
  P.chooser = 0;
  P.handlers.push((d) => { if (d.method === 'Page.fileChooserOpened') P.chooser++; });
  return P;
}
export async function device(P, w, h, dpr = 2) {
  await P.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
  await P.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(300);
}
export const rect = (P, sel) => P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}`);
export const touch = (P, type, x, y) => P.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
export async function tapXY(P, x, y) { await touch(P, 'touchStart', x, y); await sleep(50); await touch(P, 'touchEnd', x, y); await sleep(220); }
export async function tap(P, sel) { const r = await rect(P, sel); if (!r) throw new Error('manca ' + sel); await tapXY(P, r.cx, r.cy); }
// il punto centrale del pulsante deve essere davvero il pulsante (non coperto da canvas/barre)
export const reachable = (P, sel) => P.eval(`const e=document.querySelector(${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!h && (h===e || e.contains(h))`);
export async function pen(P, pts) {
  const [x0, y0] = pts[0];
  await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
  for (const [x, y] of pts.slice(1)) { await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 }); await sleep(6); }
  const [xl, yl] = pts[pts.length - 1];
  await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xl, y: yl, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await sleep(120);
}
export const strokes = (P, i = 0) => P.eval(`return __penna.nb.pages[${i}].rec.strokes.length`);
export const small = (P) => P.eval(`return [...document.querySelectorAll('button, label.pill, label.ib, .slider')].filter(e=>{const r=e.getBoundingClientRect(); if(!r.width||!r.height||!e.offsetParent) return false; if(getComputedStyle(e).visibility==='hidden') return false; return r.width<43.5||r.height<43.5}).map(e=>(e.id||e.className)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))`);
// pixel scuri e colorati su un canvas (per capire se il PDF è stato disegnato davvero)
export const pixels = (P, sel) => P.eval(`const c=document.querySelector(${JSON.stringify(sel)}); if(!c||!c.width) return {dark:0,color:0}; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let dark=0,color=0; for(let i=0;i<d.length;i+=16){const r=d[i],g=d[i+1],b=d[i+2]; if(r<90&&g<90&&b<90)dark++; if(Math.max(r,g,b)-Math.min(r,g,b)>70)color++;} return {dark,color}`);

