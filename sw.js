// La versione della cache cambia a ogni aggiornamento dell'app. Il nuovo service worker si installa e prende
// subito il controllo; l'app aperta mostra "È pronta una nuova versione · Aggiorna" (niente ricariche a sorpresa).
const VERSION = 'v12';
const CACHE = 'pdf-penna-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.js', 'db.js', 'sync.js', 'pdfexport.js', 'find.js', 'notes.js', 'ask.js', 'config.js', 'polyfills.js', 'pdfworker.js', 'style.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'lib/pdf.min.mjs', 'lib/pdf.worker.min.mjs', 'lib/pdf-lib.min.js', 'lib/msal-browser.min.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = file freschi dal server, non dalla cache HTTP del browser (eviterebbe versioni mescolate)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la cache (funziona offline); se manca, rete e poi salva per la volta dopo.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
