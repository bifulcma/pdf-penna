# Fase 3: fix bottoni su iPad (segnalato da Marco: colore, spessore, ecc. "bloccati")
Dopo la fase 2. Sistema l'usabilità touch su iPad/iPhone vero:
- Tutti i tasti >=44x44px, `touch-action: manipulation`, `-webkit-user-select:none`, `-webkit-touch-callout:none`, `-webkit-tap-highlight-color` trasparente. Usa pointerup/click affidabile (niente doppio tocco zoom).
- Colore + spessore + opacità in un pannello a comparsa toccando lo strumento attivo (stile GoodNotes), con cursore spessore grande (slider custom, area di tocco ampia) e anteprima del tratto. Il pannello si chiude toccando fuori.
- La barra strumenti deve restare sopra il canvas (z-index) e non essere coperta/intercettata da livelli di disegno; il disegno con Pencil non deve mai attivarsi toccando la barra.
- Scribble iPadOS: sui tasti/slider non deve interferire; i canvas con `touch-action` corretto.
- Verifica con Chrome headless emulando iPad con touch (puppeteer touch events + pointer pen): tocca ogni tasto e controlla che lo stato cambi (strumento, colore, spessore, undo/redo, pannello). Screenshot 1024x768 e 390x844.
- Pubblica e verifica 200. Dichiara cosa non verificato (Pencil reale).
