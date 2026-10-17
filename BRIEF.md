# Progetto: "PDF Penna" — web app per iPad (PWA)
Obiettivo: aprire un PDF e scrivere/disegnare sopra con Apple Pencil su iPad (Safari, aggiungibile a Home). Utente non tecnico, italiano.

## Funzioni (v1)
- Apri PDF da file (input file / "Apri con"), elenco dei PDF recenti salvati in IndexedDB (con le annotazioni).
- Visualizza PDF con PDF.js (pdfjs-dist copiato IN LOCALE nel repo, niente CDN), scroll continuo tra le pagine, zoom a pizzico con due dita.
- Strato di disegno sopra ogni pagina (canvas) con Pointer Events: penna (pressione Apple Pencil -> spessore), evidenziatore (trasparente), gomma, colori (nero, blu, rosso, verde, giallo), spessore regolabile, annulla/ripeti.
- Con la penna si scrive; con un dito si scorre/zoomma (touch-action corretto). Palm rejection: se pointerType==='pen' disegna solo la penna.
- Salvataggio automatico delle annotazioni (vettoriali, tratti normalizzati per pagina) in IndexedDB.
- Esporta: "Condividi/Scarica PDF annotato" (pdf-lib locale, tratti disegnati nel PDF) + navigator.share se disponibile.
- PWA: manifest + service worker (funziona offline dopo la prima apertura), icona, meta apple-mobile-web-app.
- Interfaccia in italiano, stile chiaro: sfondo crema #FAF9F5, accento terracotta #C2664A. Barra strumenti in alto, grande e comoda per iPad.

## Regole
- Cartella: ~/work/pdf-penna. Niente dipendenze da CDN. File statici (index.html, app.js, style.css, sw.js, manifest.webmanifest, lib/).
- Verifica obbligatoria: node --check su JS; test e2e con Chrome headless/puppeteer o jsdom dove possibile (carica un PDF di prova, disegna un tratto con eventi pointer, controlla che venga salvato ed esportato un PDF valido con pdf-lib); screenshot Chrome headless a 1024x768 (iPad) per layout.
- Pubblica: crea repo pubblico GitHub bifulcma/pdf-penna (gh repo create ... --push; prima `gh auth setup-git`), poi link raw.githack.com/bifulcma/pdf-penna/main/index.html. Verifica che il service worker/manifest e i JS siano serviti con MIME corretto; se githack non va bene per SW, usa GitHub Pages (.nojekyll).
- Alla fine stampa: link finale, cosa è stato verificato e cosa NO (non posso testare Apple Pencil reale).
