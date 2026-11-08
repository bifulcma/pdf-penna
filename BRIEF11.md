# BRIEF 11 — Penna sull'iPhone: leggere comodo (MB 8/11/26)

Marco ora usa Penna anche sull'iPhone (sincronizzato col Mac Studio, funziona). Problema, sua parola:
«Più grande! Così no. Leggo». Su iPhone la pagina PDF intera sta nella larghezza dello schermo e il
testo è minuscolo, illeggibile. Sull'iPhone Penna serve soprattutto per LEGGERE (e sottolineare).

## Da fare (solo su schermi stretti, < 600 px; l'iPad deve restare IDENTICO)
1. **Testo grande di default**: su iPhone apri le pagine adattate alla larghezza del TESTO, non del foglio:
   taglia i margini bianchi (usa l'area dell'inchiostro/testo già calcolata, es. fitToInk / contenuto
   testuale pdf.js; ripiego: ritaglio fisso dei margini). Obiettivo: corpo del testo leggibile
   (≥ ~15 px apparenti) senza fare nulla.
2. **Ingrandire facile**: pizzico a due dita fluido (fino a 3×) e doppio tocco = ingrandisci/torna.
   Pagina ingrandita: scorrimento orizzontale libero. Lo zoom scelto si ricorda per quel quaderno.
   Un dito sullo schermo: scorre (non disegna) quando lo strumento è "mano/lettura"; con penna/
   evidenziatore selezionati il dito scrive come ora.
3. **Modalità lettura** (opzionale ma consigliata): tasto "Aa" che mostra il TESTO del PDF (strato testo
   pdf.js) riflesso in colonna, carattere regolabile (3 misure), sfondo carta; tocco su un paragrafo =
   evidenzialo (salva come evidenziazione sulla pagina vera, così si sincronizza). Se troppo rischioso,
   rimandala e dillo.
4. **Barra strumenti compatta** su iPhone: icone 44 px, una riga sola, scorrevole, non copre il testo;
   rispetta le zone sicure (notch/Dynamic Island in alto, barra home in basso).
5. Testo impostazioni: "Sincronizzazione tra iPad" → "Sincronizzazione tra i tuoi dispositivi";
   "Solo su questo iPad" → "Solo su questo dispositivo".

## Regole
- Non toccare dati, sincronizzazione, ponte Studio. Un update non deve cancellare nulla (IndexedDB).
- Test automatici in Chrome headless emulando **iPhone 390×844 @3x** E **iPad** (non regressioni):
  misura la dimensione apparente del testo prima/dopo; screenshot iPhone prima/dopo in `shots/brief11/`.
  Tutti i test esistenti devono passare.
- `VERSION` in sw.js → 'v21'. Commit + push su main, verifica HTTP 200 della pagina pubblicata.
- Alla fine scrivi in `claude_out11.txt`: cosa hai fatto, test ok/ko, e sezione **NON verificato**
  (iPhone vero, gesti reali).
