# Fase 9 (feedback di Marco su iPad)

## A. Pannello "Chiedi": deve poter salire
Oggi e' ancorato in basso e con la tastiera aperta lascia poco spazio per leggere la risposta.
- Maniglia di trascinamento in cima: il pannello si trascina verso l'alto con tre posizioni (compatto, meta' schermo, quasi tutto schermo) con scatto magnetico; tocco sulla maniglia cicla le posizioni.
- Con la tastiera iOS aperta il pannello sale sopra la tastiera (visualViewport) e la risposta resta visibile; l'area risposta scorre ed e' piu' alta (usa lo spazio disponibile).
- Chiusura: trascinando verso il basso oltre soglia o con X. Funziona su iPad (1024x768 e verticale) e iPhone 390x844, tema chiaro/scuro.

## B. Ricerca web "stupida" (bug segnalato)
Esempio reale: selezione "Allora sterminera' le armate del tiranno Sufyani e riempira' la terra di giustizia."; la ricerca ha cercato "tiranno" invece di "Sufyani" -> risultati inutili. Rendi la ricerca intelligente:
1. Il bridge NON usa piu' parole grezze della selezione come query. Passo 1: chiede al modello scelto (Qwen o Claude) di generare 1-3 **query di ricerca mirate** dal contesto: domanda dell'utente + testo selezionato + titolo del documento + pagina vicina. Regole del prompt: privilegia nomi propri, termini tecnici/religiosi/storici, date, luoghi (es. "Sufyani", "Mahdi", "occultamento"); aggiungi il contesto utile (es. "Sufyani escatologia sciita"); evita parole generiche; query in italiano e, se il tema lo richiede, anche in inglese/arabo traslitterato.
2. Passo 2: esegue le ricerche (Tavily per Qwen; per Claude lascia che sia Claude a cercare ma con istruzione esplicita: parti dai nomi propri e termini specifici, 2-3 query diverse, verifica con piu' fonti, preferisci fonti accademiche/enciclopediche; cita URL).
3. Deduplica i risultati, scarta fonti di scarsa qualita' (siti di contenuti generati, forum) con una piccola lista e preferisci domini autorevoli (enciclopedie, universita', riviste, istituzioni). Includi 5-6 risultati con estratto.
4. UI: mostra le query effettivamente usate ("Ho cercato: Sufyani escatologia sciita; ...") e un pulsante "Modifica ricerca" per correggerle a mano e rilanciare. Streaming di stato come adesso.
5. Per Qwen: se i risultati sono pochi o fuori tema (controllo semplice: nessun termine chiave nei titoli/estratti), riprova una volta con una query riformulata prima di rispondere; se ancora scarsi, dillo chiaramente ("non ho trovato fonti affidabili") invece di inventare.

## Verifica
Test nuovi + tutti i precedenti. Test del caso reale: dalla frase su Sufyani le query generate devono contenere "Sufyani" (con Qwen finto che restituisce una query, e con Claude vero). Test che la UI mostra le query e "Modifica ricerca" rilancia. Test sul pannello: maniglia, snap, tastiera simulata (visualViewport), screenshot 1024x768 e 390x844. Alza VERSION in sw.js (v10), push, verifica 200 e che bridge.py/install.sh raw siano aggiornati. Dichiara cosa NON verificato.
