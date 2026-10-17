# Fase 4 (sostituisce BRIEF3): su iPad vero 1) il PDF NON si apre 2) l'estetica è orrenda 3) bottoni colore/spessore bloccati
Nota: un'esecuzione precedente (BRIEF3) è stata interrotta e ha lasciato modifiche NON committate: guarda `git diff`, tieni ciò che serve, scarta il resto. Leggi anche BRIEF3.md (è ancora valido per i bottoni).

## 1. PDF non si apre (PRIORITÀ)
Sospetto: pdf.js 6.x (lib/pdf.min.mjs) usa funzionalità JS troppo nuove per Safari iPadOS/iOS (es. Promise.withResolvers, Array.fromAsync, Uint8Array.toHex, Float16, import map, worker module...). Soluzioni, in ordine:
- Passa alla build **legacy** di pdfjs-dist (cartella `legacy/build/`, .mjs o .js classic, worker incluso), scaricata dal registro npm come prima (npm install negato: usa curl/tar del tarball). Se serve, carica in modalità classic script e non ES module.
- Aggiungi polyfill minimi (Promise.withResolvers, Array.prototype.at, structuredClone, Object.hasOwn...) prima di caricare pdf.js.
- Il caricamento file deve funzionare su iOS: `<input type=file accept="application/pdf">` NON con `hidden`/display:none se crea problemi — usa un input visivamente nascosto (opacity 0, posizionato sul bottone) cliccato dal bottone; leggi con file.arrayBuffer() e copia il buffer (iOS stacca gli ArrayBuffer trasferiti al worker).
- **Mostra SEMPRE l'errore a schermo** (toast/box con messaggio tecnico breve + versione app) se l'apertura fallisce, così Marco può fotografarlo. Aggiungi window.onerror/unhandledrejection -> box errore.
- Prova a emulare un Safari vecchio: in Chrome headless disabilita le API nuove (delete Promise.withResolvers ecc. con script iniettato prima del caricamento) e verifica che il PDF si apra comunque. Testa con un PDF reale multi-pagina e uno con font/immagini.

## 2. Estetica (ridisegna tutto l'aspetto, stile pulito alla Apple Note/GoodNotes/Notability)
- Basta tasti testuali grezzi: icone **SVG inline** (stile linea, tratto 1.75px, arrotondato) per penna, evidenziatore, gomma, lazo/testo, annulla, ripeti, pagine, condividi, ricerca, sync, impostazioni.
- Palette: crema #FAF9F5, superfici bianche, accento terracotta #C2664A, testo #2B2623, bordi sottili #E8E2D8, ombre morbide, raggio 14-16px. Font di sistema (-apple-system, SF Pro), gerarchia chiara (titoli 28/20/15px).
- Libreria: griglia di **copertine quaderno** grandi con anteprima prima pagina, titolo sotto, bordi arrotondati, "+" nuovo quaderno come card tratteggiata; cartelle come card distinte.
- Editor: barra strumenti in alto **a pillola flottante** centrata (sfondo bianco, ombra), strumento attivo evidenziato terracotta; pannello colori/spessore a comparsa (popover) sotto lo strumento attivo con: 8 colori (cerchi 36px), cursore spessore grande con anteprima del tratto dal vivo, opacità per l'evidenziatore. Barra pagine laterale con miniature.
- Spazi generosi, nessun testo tagliato, safe-area iOS (notch), tema scuro automatico opzionale (prefers-color-scheme) con terracotta come accento.
- Transizioni leggere (150ms), stati :active evidenti.

## 3. Bottoni su touch
Tutti i target >=44x44px, `touch-action: manipulation`, user-select none, -webkit-touch-callout none; barra sopra il canvas (z-index) e il disegno non parte mai toccando la UI; Scribble non interferisce. Slider spessore custom con area ampia.

## Verifica
- Test automatici esistenti (34) devono ancora passare + nuovi: apertura PDF con API moderne rimosse, tocco su ogni bottone con eventi touch/pointer emulando iPad (stato cambia), popover colore/spessore.
- Screenshot 1024x768 (libreria, editor con PDF, popover aperto) e 390x844; guardali tu con attenzione all'estetica (allineamenti, contrasto) e itera finché è davvero bello, non solo funzionante.
- Alza VERSION in sw.js. Pubblica (push main), verifica 200. Dichiara cosa NON verificato (iPad/Pencil reali).
