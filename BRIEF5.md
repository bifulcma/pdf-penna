# Fase 5 (feedback di Marco dopo prova su iPad vero con PDF da 292 pagine)
Funziona, ma mancano:
1. **Vai a pagina**: nella barra dell'editor un campo "pagina X di N" toccabile -> si apre un piccolo pannello con tastierino numerico, Invio salta alla pagina. Visibile sempre (non solo sidebar). Aggiorna X mentre si scorre. Aggiungi anche pulsanti pagina precedente/successiva. Con PDF da 292 pagine deve restare fluido (render solo pagine visibili, virtualizzazione se non già fatto, scroll con barra rapida/trascinamento).
2. **Tasto Salva** ben visibile nella barra: salva subito (flush IndexedDB + sync se collegato) e mostra conferma "Salvato ✓ alle 19:42"; nello stesso menu: "Esporta PDF con annotazioni" (condividi/scarica in File) e "Salva copia". Mostra sempre in barra lo stato salvataggio (Salvato / Modifiche non salvate).
3. Pensa a ciò che serve a chi annota un libro/contratto da 300 pagine: segnalibri con nome (tocca per aggiungere pagina corrente), ricorda ultima pagina letta alla riapertura, ricerca testo nel PDF (pdf.js getTextContent) con elenco risultati.
## Verifica
Come BRIEF4: test automatici (esistenti + nuovi: vai a pagina 150 di un PDF generato da 300 pagine, salva, riapri e riprende pagina, segnalibro, ricerca), screenshot 1024x768 e 390x844 da guardare per estetica coerente. Alza VERSION in sw.js, push, verifica 200. Dichiara cosa NON verificato.
