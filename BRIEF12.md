# BRIEF 12 — iPhone: evidenziare parti piccole (MB 8/11/26)

Marco ha provato la v21 sull'iPhone vero. Sue parole: «Senza [Aa] non si riesce a sottolineare, dopo [con Aa]
sottolinea interi paragrafi e non si riesce a mettere in evidenza parti più piccole».

Due problemi da risolvere (solo telefono, lato corto < 600 px; iPad IDENTICO):

## 1. Modalità lettura «Aa»: evidenziare UNA PARTE di frase
- Togli il «tocco = evidenzia tutto il paragrafo» come azione principale.
- Selezione del testo: tieni premuto su una parola → si seleziona la parola, con le maniglie native di iOS
  per allargare/restringere (usa la selezione nativa di Safari: `user-select: text`, evento `selectionchange`).
  Appena c'è una selezione compare una piccola barra sopra di essa con: **Evidenzia** (giallo + 2-3 colori),
  **Sottolinea**, **Nota**, **Copia**. Attenzione a non entrare in conflitto con il menu di sistema iOS
  (puoi mostrare la tua barra sotto la selezione o in basso fissa).
- L'evidenziazione salvata copre SOLO le parole selezionate, sulla pagina vera, allineata alle parole
  (usa le posizioni dei singoli item/caratteri dello strato testo pdf.js, spezzando gli item a metà se
  serve). Si vede sul foglio, va nei Commenti, nel Markdown, si sincronizza; Annulla funziona.
- Tocco su un'evidenziazione esistente → piccola barra: Cambia colore / Togli.
- Il paragrafo intero resta possibile: doppio tocco su un paragrafo, o selezione lunga.

## 2. Vista pagina (senza Aa): sottolineare/evidenziare
- Oggi sul telefono un dito scorre sempre e non scrive se non con «Dito» acceso: per Marco «non si riesce».
- Quando è scelto lo strumento **Evidenziatore** (o Penna), sul telefono: **un dito evidenzia/scrive,
  due dita scorrono e ingrandiscono**. Con nessuno strumento (o «Mano/Leggi») un dito scorre.
  Rendi chiaro lo stato: lo strumento attivo evidenziato e un tasto «Mano» per tornare a leggere.
- Evidenziatore «intelligente» sul testo: se il tratto passa sopra righe di testo, aggancialo alle
  parole toccate (come «Evidenzia» al punto 1), non uno sgorbio; fuori dal testo resta tratto libero.
- Alternativa equivalente: tieni premuto sulla pagina → selezione parole sullo strato testo → stessa barra
  del punto 1. Va bene anche avere entrambe.

## Regole
- Dati, sync, ponte Studio intatti; un update non cancella nulla. iPad identico (test pixel come brief 11).
- Test Chrome headless iPhone 390×844@3x: selezione di 3 parole in mezzo a un paragrafo → evidenziazione
  che copre solo quelle (verifica i rettangoli); evidenziatore con un dito in vista pagina; due dita scorrono.
  Tutti i test che passavano in v21 devono passare.
- `VERSION` sw.js → 'v22'. Commit + push main, verifica 200. Rapporto in `claude_out12.txt` con NON verificato.
