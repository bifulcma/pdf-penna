// Funzioni "moderne" che pdf.js usa ma che Safari/iPadOS più vecchi non hanno.
// Caricato PRIMA di pdf.js, sia nella pagina (script classico) sia nel worker (pdfworker.js).
// È una rete di sicurezza: la build "legacy" di pdf.js ha già i suoi polyfill.
(function (g) {
  const def = (o, k, v) => { if (!o[k]) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); };
  def(Promise, 'withResolvers', function () {
    let resolve, reject;
    const promise = new this((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
  });
  def(Promise, 'try', function (fn, ...args) { return new this((res) => res(fn(...args))); });
  def(Array.prototype, 'at', function (n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; });
  def(Array.prototype, 'findLast', function (f, t) { for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(Array.prototype, 'findLastIndex', function (f, t) { for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  def(String.prototype, 'replaceAll', function (a, b) {
    if (a instanceof RegExp) return this.replace(a, b);
    return this.split(a).join(typeof b === 'function' ? b(a) : b);
  });
  for (const C of [Map, WeakMap]) {
    def(C.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); });
    def(C.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); });
  }
  def(Uint8Array.prototype, 'toHex', function () { let s = ''; for (const b of this) s += b.toString(16).padStart(2, '0'); return s; });
  def(Uint8Array.prototype, 'toBase64', function () { let s = ''; for (const b of this) s += String.fromCharCode(b); return btoa(s); });
  def(Uint8Array, 'fromBase64', function (s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; });
  def(Uint8Array, 'fromHex', function (s) { const u = new Uint8Array(s.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; });
  // ArrayBuffer.transfer (Safari 17.4+): pdf.js lo usa per preparare i font; senza, le pagine restano bianche
  const xfer = function (len) {
    const n = len === undefined ? this.byteLength : Math.max(0, Math.floor(len));
    const out = new ArrayBuffer(n);
    new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(n, this.byteLength)));
    return out;
  };
  def(ArrayBuffer.prototype, 'transfer', xfer);
  def(ArrayBuffer.prototype, 'transferToFixedLength', xfer);
  // Response/Blob.bytes() (Safari 18+): pdf.js li usa per caricare font standard, cmap e immagini
  const bytes = function () { return this.arrayBuffer().then((b) => new Uint8Array(b)); };
  for (const C of [g.Response, g.Request, g.Blob]) if (C) def(C.prototype, 'bytes', bytes);
  // "for await" su un ReadableStream (Safari non lo supporta): pdf.js lo usa per leggere il testo delle pagine (ricerca)
  if (g.ReadableStream && !g.ReadableStream.prototype[Symbol.asyncIterator]) {
    const values = function (opt) {
      const reader = this.getReader(), keep = !!(opt && opt.preventCancel);
      return {
        next: () => reader.read(),
        return: (v) => {
          const p = keep ? Promise.resolve() : reader.cancel(v);
          return p.then(() => { reader.releaseLock(); return { done: true, value: v }; });
        },
        [Symbol.asyncIterator]() { return this; },
      };
    };
    def(g.ReadableStream.prototype, 'values', values);
    def(g.ReadableStream.prototype, Symbol.asyncIterator, values);
  }
  def(Math, 'sumPrecise', function (a) { let s = 0; for (const x of a) s += x; return s; });
  def(URL, 'parse', function (u, b) { try { return new URL(u, b); } catch { return null; } });
  if (!g.structuredClone) {
    g.structuredClone = function clone(v) {
      const seen = new Map();
      const c = (x) => {
        if (x === null || typeof x !== 'object') return x;
        if (seen.has(x)) return seen.get(x);
        let out;
        if (ArrayBuffer.isView(x)) out = new x.constructor(x);
        else if (x instanceof ArrayBuffer) out = x.slice(0);
        else if (x instanceof Map) { out = new Map(); seen.set(x, out); x.forEach((val, k) => out.set(c(k), c(val))); return out; }
        else if (x instanceof Set) { out = new Set(); seen.set(x, out); x.forEach((val) => out.add(c(val))); return out; }
        else if (x instanceof Date) out = new Date(x);
        else if (Array.isArray(x)) { out = []; seen.set(x, out); x.forEach((val, i) => { out[i] = c(val); }); return out; }
        else { out = {}; seen.set(x, out); for (const k of Object.keys(x)) out[k] = c(x[k]); return out; }
        seen.set(x, out);
        return out;
      };
      return c(v);
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
