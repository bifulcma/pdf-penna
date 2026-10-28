# BRIEF 10 — «Barra» (testo da cancellare) e «Modifica» (testo da sostituire)

Richiesta di Marco (29/10/2026): «In Penna mettiamo opzione sbarrare testo da cancellare e opzione modifica testo».
Rispondi e scrivi tutto in italiano semplice. Usa Opus. Leggi prima `notes.js`, la sezione
«Selezione: Copia · Evidenzia · Commenta» di `app.js` (~riga 1294) e «Evidenziazioni e commenti» (~1489).

## Cosa sono (segni da correttore di bozze, NON modifica vera del PDF)
Il PDF non si riscrive: Marco annota il libro e poi «Copia tutto in Markdown» passa le correzioni a Claude,
che corregge la SORGENTE. Quindi le due funzioni sono due nuovi TIPI di annotazione sul testo selezionato:

1. **Barra** — nel menu della selezione, accanto a Evidenzia / Commenta, un tasto «Barra».
   Il testo selezionato viene disegnato barrato (linea rossa orizzontale a metà altezza delle righe, sopra il
   testo, multi-riga e multi-pagina come l'evidenziazione). Significa: «da cancellare».
2. **Modifica** — tasto «Modifica»: si apre lo stesso riquadro del commento, con il testo originale
   mostrato sopra e un campo «Scrivi il testo nuovo» già pieno con il testo selezionato, da correggere.
   Sul PDF: testo vecchio barrato (rosso) + un piccolo segno ^ con il testo nuovo visibile al tocco
   (come i commenti). Significa: «sostituisci con …».

Entrambe:
- si salvano come le altre annotazioni (IndexedDB, nella pagina: seguono riordino, copia, export PDF, OneDrive);
- si toccano per riaprirle: modifica il testo nuovo, trasforma Barra↔Modifica, elimina;
- compaiono nella lista annotazioni con un'etichetta chiara («Da cancellare», «Da sostituire»);
- nell'esportazione PDF compaiono (barra rossa + nota col testo nuovo);
- in «Copia tutto in Markdown» escono come istruzioni per Claude, nell'ordine del libro, ad es.:
  - `- p. 12 · **CANCELLA:** «testo originale»`
  - `- p. 12 · **SOSTITUISCI** «testo originale» → «testo nuovo»`
  e in testa all'export una riga che spiega le due istruzioni. Le evidenziazioni/commenti restano come oggi.

## Vincoli
- Non rompere nulla delle annotazioni esistenti (dati vecchi devono aprirsi uguali). Nessuna migrazione distruttiva.
- Tasti ≥ 44 px, stessa estetica dell'app, icone SVG come le altre (`#i-strike`, `#i-edit` nello sprite).
- Aggiorna `VERSION` in `sw.js` (v12 → v13) e il testo d'aiuto della lista vuota (menziona Barra e Modifica).

## Verifica obbligatoria
- Test in `tests/` per le funzioni pure di notes.js (Markdown di cancella/sostituisci, ordine, dati vecchi).
  Esegui TUTTI i test esistenti e i nuovi: devono passare.
- Prova in un browser headless (Chrome) su un PDF di prova: seleziona testo → Barra; seleziona → Modifica con
  testo nuovo; ricarica la pagina e verifica che siano ancora lì; «Copia tutto in Markdown» contiene le due righe;
  esporta PDF senza errori. Prova anche con viewport iPad (1180×820, touch).
- Dichiara cosa NON hai potuto verificare (Pencil vera, Safari iPad vero).

## Pubblicazione
Commit chiaro su `main` e push (GitHub Pages). Controlla che https://bifulcma.github.io/pdf-penna/sw.js mostri v13.
Alla fine scrivi in `claude_out10.txt` (lo fa il reindirizzamento) un riassunto di massimo 12 righe per Marco:
cosa c'è di nuovo, come si usa sull'iPad (passi), cosa non è verificato.
