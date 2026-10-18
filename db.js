// Archivio locale (IndexedDB): è la fonte principale dei dati. Il sync con OneDrive lavora sopra questo.
// nodes  = quaderni e cartelle   pages = pagine   blobs = allegati (PDF/immagini)   meta = piccole impostazioni
const DB_NAME = 'pdf-penna';
let dbp;
export function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = (ev) => {
      const d = r.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' }); // vecchia v1
      for (const s of ['nodes', 'pages', 'blobs', 'meta']) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'k' : 'id' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn, opts) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = opts ? d.transaction(store, mode, opts) : d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const put = (s, rec) => tx(s, 'readwrite', (o) => o.put(rec));
export const get = (s, id) => tx(s, 'readonly', (o) => o.get(id));
export const all = (s) => tx(s, 'readonly', (o) => o.getAll());
export const del = (s, id) => tx(s, 'readwrite', (o) => o.delete(id));
// molti record in una sola transazione (un PDF da 300 pagine si importa in un attimo)
export const putMany = (s, recs) => tx(s, 'readwrite', (o) => { for (const r of recs) o.put(r); });
export const getMeta = async (k) => (await get('meta', k))?.v;
export const setMeta = (k, v) => put('meta', { k, v });
// scrittura "sicura": il browser la mette subito sul disco (e con lei tutto quello che è stato salvato prima)
export const setMetaStrict = (k, v) => tx('meta', 'readwrite', (o) => o.put({ k, v }), { durability: 'strict' });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const now = () => Date.now();

// ---- Modello ----
// nodo:  { id, kind:'notebook'|'folder', parent:null|id, name, color, updated, deleted?, dirty, etag }
// pagina:{ id, nb, order, type:'blank'|'lined'|'grid'|'pdf', blob?, pdfPage?, strokes:[], blocks:[], images:[], anns?:[] (evidenziazioni e commenti sul testo, vedi notes.js), bm?, updated, deleted?, dirty, etag }
// blob:  { id, mime, name, data:ArrayBuffer, dirty, etag }
export const COLORS = ['#C2664A', '#D9A441', '#7A9E6B', '#5B87A6', '#8C6BA8', '#6B6560'];

export async function newNode(kind, name, parent) {
  const n = { id: uid(), kind, parent: parent || null, name, color: COLORS[Math.floor(Math.random() * COLORS.length)], updated: now(), dirty: 1 };
  await put('nodes', n);
  return n;
}
export function blankPage(nb, order, type, extra) {
  return { id: uid(), nb, order, type, strokes: [], blocks: [], images: [], updated: now(), dirty: 1, ...extra };
}
// il campo etag appartiene al sync: lo rileggo dall'archivio così un salvataggio dell'interfaccia non lo rovina
async function keepEtag(store, rec) { const cur = await get(store, rec.id); if (cur) rec.etag = cur.etag; else delete rec.etag; }
export async function saveNode(n) { n.updated = now(); n.dirty = 1; await keepEtag('nodes', n); await put('nodes', n); }
export async function savePage(p) { p.updated = now(); p.dirty = 1; await keepEtag('pages', p); await put('pages', p); }
export async function addBlob(data, mime, name) {
  const b = { id: uid(), mime, name, data, dirty: 1 };
  await put('blobs', b);
  return b;
}
export async function pagesOf(nbId) {
  return (await all('pages')).filter((p) => p.nb === nbId && !p.deleted).sort((a, b) => a.order - b.order);
}
// elimina (cancellazione "morbida": resta un segno così il sync la propaga agli altri dispositivi)
export async function deleteNode(n) {
  const kids = (await all('nodes')).filter((x) => x.parent === n.id && !x.deleted);
  for (const k of kids) await deleteNode(k);
  if (n.kind === 'notebook') for (const p of await pagesOf(n.id)) await deletePage(p);
  n.deleted = true; await saveNode(n);
}
export async function deletePage(p) {
  p.deleted = true; p.strokes = []; p.blocks = []; p.images = []; p.anns = [];
  await savePage(p);
}
