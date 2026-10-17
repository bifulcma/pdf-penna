// Sincronizzazione con OneDrive (cartella dell'app, Microsoft Graph). Offline-first: l'archivio locale è la fonte,
// qui si confrontano solo le differenze. Per ogni pagina/quaderno vince l'ultima modifica.
import * as D from './db.js';

const SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access', 'User.Read'];
let GRAPH = 'https://graph.microsoft.com/v1.0';
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export const status = { state: 'off', msg: '', last: 0, account: '' };
const listeners = new Set(), dataListeners = new Set();
export const hooks = { flush: async () => {} };
export const onStatus = (f) => listeners.add(f);
export const onData = (f) => dataListeners.add(f);
function setStatus(state, msg = '') {
  status.state = state; status.msg = msg;
  if (state === 'idle') status.last = Date.now();
  listeners.forEach((f) => f(status));
}

let getToken = null, msalApp = null, account = null;
export const isConfigured = () => {
  const id = (window.PENNA_CONFIG || {}).CLIENT_ID || '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
};
export const isConnected = () => !!getToken;

// Per i test: token finto e server Graph finto
export function useCustom({ token, base }) {
  getToken = async () => token;
  if (base) GRAPH = base;
  setStatus('idle');
  requestSync(0);
}

export async function init() {
  if (!isConfigured() || !window.msal) { setStatus('off'); return; }
  const redirectUri = new URL('./', location.href).href;
  msalApp = new window.msal.PublicClientApplication({
    auth: { clientId: window.PENNA_CONFIG.CLIENT_ID, authority: 'https://login.microsoftonline.com/common', redirectUri },
    cache: { cacheLocation: 'localStorage' },
  });
  try {
    await msalApp.initialize();
    const r = await msalApp.handleRedirectPromise();
    if (r && r.account) msalApp.setActiveAccount(r.account);
  } catch (e) { setStatus('error', 'Accesso non riuscito: ' + (e.message || e)); return; }
  account = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0] || null;
  if (!account) { setStatus('off'); return; }
  msalApp.setActiveAccount(account);
  status.account = account.username || '';
  getToken = async () => {
    try {
      return (await msalApp.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
    } catch (e) {
      const err = new Error('Serve riaccedere a Microsoft'); err.needLogin = true; throw err;
    }
  };
  setStatus('idle');
  requestSync(0);
}
export function signIn() { return msalApp.loginRedirect({ scopes: SCOPES }); }
export async function signOut() {
  if (msalApp && account) { try { await msalApp.logoutRedirect({ account, onRedirectNavigate: () => false }); } catch {} }
  getToken = null; account = null; status.account = '';
  setStatus('off');
}

// ---------- Graph ----------
class Offline extends Error {}
async function gfetch(url, opts = {}, retry = true) {
  if (!navigator.onLine) throw new Offline('offline');
  const token = await getToken();
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  } catch (e) { throw new Offline('rete'); }
  if ((res.status === 429 || res.status === 503) && retry) {
    await new Promise((r) => setTimeout(r, Math.min(5000, (Number(res.headers.get('Retry-After')) || 1) * 1000)));
    return gfetch(url, opts, false);
  }
  return res;
}
const itemUrl = (name, suffix = '') => `${GRAPH}/me/drive/special/approot:/${encodeURIComponent(name)}:${suffix}`;

async function listRemote() {
  const map = new Map();
  let url = `${GRAPH}/me/drive/special/approot/children?$select=name,eTag,size&$top=200`;
  while (url) {
    const res = await gfetch(url);
    if (res.status === 404) return map;
    if (!res.ok) throw new Error('Elenco OneDrive: ' + res.status);
    const j = await res.json();
    for (const it of j.value || []) if (it.name) map.set(it.name, { etag: it.eTag });
    url = j['@odata.nextLink'];
  }
  return map;
}
async function download(name) {
  const res = await gfetch(itemUrl(name, '/content'));
  if (!res.ok) throw new Error('Download ' + name + ': ' + res.status);
  return res;
}
// ritorna il nuovo eTag, oppure null se il file remoto era cambiato nel frattempo (412)
async function upload(name, body, ifMatch) {
  const headers = {};
  if (ifMatch) headers['If-Match'] = ifMatch;
  const size = body.byteLength ?? body.length;
  if (size <= 3.5 * 1024 * 1024) {
    const res = await gfetch(itemUrl(name, '/content'), { method: 'PUT', body, headers });
    if (res.status === 412) return null;
    if (!res.ok) throw new Error('Upload ' + name + ': ' + res.status);
    return (await res.json()).eTag;
  }
  // file grande: sessione di caricamento a pezzi
  const s = await gfetch(itemUrl(name, '/createUploadSession'), {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (s.status === 412) return null;
  if (!s.ok) throw new Error('Sessione upload ' + name + ': ' + s.status);
  const { uploadUrl } = await s.json();
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const CH = 320 * 1024 * 10;
  let last;
  for (let off = 0; off < bytes.length; off += CH) {
    const end = Math.min(bytes.length, off + CH);
    let res;
    try {
      res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${off}-${end - 1}/${bytes.length}` }, body: bytes.slice(off, end) });
    } catch (e) { throw new Offline('rete'); }
    if (!res.ok) throw new Error('Upload a pezzi ' + name + ': ' + res.status);
    last = res;
  }
  return (await last.json()).eTag;
}

// ---------- Confronto ----------
const nameOf = { nodes: (r) => `n-${r.id}.json`, pages: (r) => `p-${r.id}.json`, blobs: (r) => `b-${r.id}.${EXT[r.mime] || 'bin'}` };
const prefix = { nodes: 'n-', pages: 'p-', blobs: 'b-' };
const strip = (r) => { const { dirty, etag, ...rest } = r; return rest; };
let changed = false;

async function markSent(store, sent, etag) {
  const fresh = await D.get(store, sent.id);
  if (!fresh) return;
  if (fresh.updated === sent.updated) fresh.dirty = 0;
  fresh.etag = etag;
  await D.put(store, fresh);
}
const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));

async function syncJson(store, rec, remote) {
  const name = nameOf[store](rec);
  const r = remote.get(name);
  const send = async (ifMatch) => {
    const et = await upload(name, enc(strip(rec)), ifMatch);
    if (et) await markSent(store, rec, et);
    return et;
  };
  if (!r) { await send(); remote.set(name, {}); return; }
  if (r.etag === rec.etag) { if (rec.dirty) await send(r.etag); return; }
  // il file remoto è diverso da quello che conosco
  const theirs = await (await download(name)).json();
  if (!rec.dirty || (theirs.updated || 0) >= rec.updated) {
    await D.put(store, { ...theirs, dirty: 0, etag: r.etag });
    changed = true;
  } else {
    await send(r.etag);   // vince la mia modifica (più recente); se 412 si riprova al prossimo giro
  }
}
async function syncBlob(rec, remote) {
  const name = nameOf.blobs(rec);
  if (remote.has(name)) {
    if (rec.dirty) { rec.dirty = 0; rec.etag = remote.get(name).etag; await D.put('blobs', rec); }
    return;
  }
  const et = await upload(name, rec.data);
  if (et) { rec.dirty = 0; rec.etag = et; await D.put('blobs', rec); }
}
async function pullNew(store, remote, localIds) {
  for (const [name, info] of remote) {
    if (!name.startsWith(prefix[store])) continue;
    const m = /^[npb]-([^.]+)\.(\w+)$/.exec(name);
    if (!m || localIds.has(m[1])) continue;
    if (store === 'blobs') {
      const buf = await (await download(name)).arrayBuffer();
      await D.put('blobs', { id: m[1], mime: MIME[m[2]] || 'application/octet-stream', name: 'allegato.' + m[2], data: buf, dirty: 0, etag: info.etag });
    } else if (m[2] === 'json') {
      const rec = await (await download(name)).json();
      await D.put(store, { ...rec, dirty: 0, etag: info.etag });
    } else continue;
    changed = true;
  }
}

let running = false, again = false, timer = null;
export function requestSync(delay = 4000) {
  if (!getToken) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}
export async function syncNow() {
  clearTimeout(timer);
  if (!getToken) return;
  if (running) { again = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  running = true; changed = false;
  setStatus('syncing');
  try {
    await hooks.flush();
    const remote = await listRemote();
    for (const store of ['blobs', 'nodes', 'pages']) {
      const local = await D.all(store);
      for (const rec of local) {
        if (store === 'blobs') await syncBlob(rec, remote);
        else await syncJson(store, rec, remote);
      }
      await pullNew(store, remote, new Set(local.map((x) => x.id)));
    }
    setStatus('idle');
    if (changed) dataListeners.forEach((f) => f());
  } catch (e) {
    if (e instanceof Offline) setStatus('offline');
    else setStatus('error', e.needLogin ? e.message : (e.message || String(e)));
  } finally {
    running = false;
    if (again) { again = false; requestSync(500); }
  }
}

window.addEventListener('online', () => requestSync(500));
window.addEventListener('offline', () => { if (getToken) setStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestSync(300); });
setInterval(() => { if (!document.hidden) requestSync(0); }, 60000);
