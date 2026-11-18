# BRIEF 15 — Tratto di penna senza scaletta (MB 18/11/26, v25)

Marco: «Il pennino scrive male, il tratto è seghettato, non fluido».

## Causa (misurata sui quaderni veri, cartella di sync)
Safari su iPad dà la posizione della penna in **punti interi**. Nei tratti salvati ogni punto dista dal precedente un punto
esatto in orizzontale, verticale o diagonale (pagina larga 968 punti → passo 0,001033): la riga è una scaletta, con il 27–44%
delle svolte oltre i 60°. Le curve del brief 13 uniscono i punti ma non possono togliere la scaletta: lettere alte 10–15 punti
con gradini da 1 punto si vedono seghettate.

## Rimedio
- `smoothPts` (`pdfexport.js`): ogni punto diventa la media pesata dei vicini entro R lungo il tratto. Estremità ferme, numero
  di punti e pressione invariati; tratti con punti lontani non cambiano.
- **Mentre scrivi** (`liveInk` in `app.js`): R = 4 punti dello schermo (1,5 se il dispositivo dà posizioni con i decimali).
  I punti a più di R dalla punta sono definitivi e vanno sulla pagina; l'ultimo pezzetto sta in un foglietto trasparente
  (`canvas.tail`, 200 punti) che segue la penna: l'inchiostro arriva fino alla punta e non c'è scatto quando alzi la penna.
  Il tratto si salva già liscio, con `s: 1`.
- **Tratti vecchi** (senza `s`): i dati non si toccano; si lisciano quando vengono disegnati (`strokePts`: R = 4 volte il
  passo più comune del tratto, al massimo 0,006 della larghezza) — schermo, miniature, foto per l'AI, PDF esportato.
- Evidenziatore, righe dritte col dito, gomma: come prima.

Sui quaderni veri: svolta mediana da 27° a 6°; il 90% delle svolte da 180° a 34°.

## Test
`node tests/tratto-unit.mjs` (17) · `node tests/tratto.mjs` (browser, 14). Invariati: e2e 34/34, ipad 97/97, dito 10/10,
inchiostro 9/9, trascrivi 25/25, fase6 83/83. `fase5` (2), `brief11` (1), `brief12` (1): errori che c'erano già.

## Da vedere
La pressione salvata è sempre 0,47 in tutti i quaderni: la penna di Marco non manda la pressione (o Safari non la passa),
quindi lo spessore non cambia mai. Non toccato.

# v26 (18/11/26, sera) — tutte le pagine scritte in un PDF solo; «Condividi PDF»

- **Trascrivi le pagine scritte a mano** («Tutto il PDF»): prima ne prendeva 3 e diceva «spostati lì e ripeti». Ora, se le pagine
  con tratti sono più di 3, l'app fa da sola (`askPenAll`): gruppi di 3 foto con la sola trascrizione (`PEN_PART`, «### Pagina N»),
  poi una richiesta di solo testo per l'analisi (`PEN_SUM`). Risultato: un testo unico («## Trascrizione» + «## Analisi»), quindi
  una bozza sola e un PDF solo. Fino a 3 pagine scritte: una richiesta sola, come prima. Nel pannello: «gruppo 2 di 4».
- **Condividi PDF** (sotto ogni risposta): lo stesso PDF della bozza dato all'iPad/iPhone (foglio «Condividi» → Mail, Gmail, File).
  Non passa dal Mac Studio. «Bozza Gmail» e «Condividi PDF» tengono la scritta anche sull'iPhone.
- Test: `trascrivi` 31/31, `ask-unit` 76. Con Gemma vera: gruppo e analisi nel formato chiesto.
