# BRIEF 14 — Scrittura a mano → testo + analisi → PDF nelle bozze di Gmail (MB 18/11/26)

Richiesta: «inviare e analizzare un contenuto scritto con il pennino, trasformato in testo dall'AI, in PDF, da Google Mail».
Scelte di Marco: da Penna alla mail · **bozza** in Gmail (la manda lui) · trascrizione **+ analisi** · legge l'AI scelta nell'app.

## 1. «Trascrivi» (pannello Chiedi)
Nuova azione accanto a Spiega / Riassumi / Verifica / Obiezioni.
- Manda la **foto della pagina** (come nel brief 13) e chiede due parti con titoli fissi: `## Trascrizione` (fedele, in bella
  copia; parola incerta `[?]`, parola non letta `[illeggibile]`) e `## Analisi` (idea centrale, punti, cose da fare, dubbi).
- Selezione o pagina: quella pagina. **Tutto il PDF** → «Trascrivi le pagine scritte a mano»: le pagine con tratti dalla
  corrente in avanti, al massimo 3 per volta (limite del bridge); se ne restano lo dice («spostati lì e ripeti»).
- Mai il web, anche con «Cerca sul web» acceso. Pagina senza tratti: «non c'è scrittura a mano da trascrivere».
- Codice: `ask.js` (`PEN`, azione `pen`, scope `ink` in `buildMessage`), `app.js` (`inkContext`).

## 2. «Bozza Gmail» (sotto ogni risposta)
- L'iPad fa il PDF da solo (`textpdf.js`, pdf-lib): A4, titolo del quaderno, riga piccola (che cos'è · pagina · modello ·
  data), titoli, elenchi, grassetto e corsivo, a capo conservati, «PDF Penna · pagina N di M».
- Chiede il destinatario (facoltativo, ricordato) e manda tutto al Mac: `POST /bozza { name, subject, text, to, pdf }`.
- **Bridge 8** (`studio-bridge/bridge.py`): crea una **bozza** in Gmail con il PDF allegato e il testo nella mail. Non spedisce
  mai. Tiene una copia (PDF + `.md`) in `backup_dir/trascrizioni/`. `/health` → `bozza: { ok, error }`.
- Bridge vecchio: il pulsante non si vede. Gmail non collegato: il pulsante spiega il comando da lanciare.
- Funziona con qualunque risposta (anche una domanda normale), non solo con «Trascrivi».

## 3. Collegare Gmail (una volta, sul Mac Studio)
    python3 ~/.studio-bridge/gmail_accesso.py
Apre Google nel browser → «Consenti». Permesso chiesto: solo `gmail.compose` (bozze). Risultato in `~/.studio-bridge/gmail.json`
(600). Usa `~/Tools/gmail/credentials.json`. Solo libreria standard: il vecchio `gmail_tool.py` su questo Mac non parte
(ambiente Python copiato da un altro Mac) e il suo accesso era scaduto (`invalid_grant`).
Se il progetto Google è «in prova» l'accesso scade ogni 7 giorni: Google Cloud › Google Auth Platform › Pubblico › «Pubblica app».

## Test
- `node tests/bozza.mjs` (bridge + Google finto, 26) · `node tests/textpdf-unit.mjs` (17) · `node tests/ask-unit.mjs` (74)
- `node tests/trascrivi.mjs` (app nel browser + bridge vero + Ollama e Google finti, 25)
- Invariati: inchiostro 9/9, immagini 18/18, e2e 34/34, ipad 97/97, dito 10/10. `bridge` (2), `web` (1), `smart` (1): errori
  che c'erano già (aspettano versioni vecchie del bridge).
- Con i modelli veri (18/11): Gemma e Claude Sonnet trascrivono una nota di prova di 7 righe senza errori.

## Da fare
1. Sul Mac: `python3 ~/.studio-bridge/gmail_accesso.py` (il bridge 8 è già installato sullo Studio).
2. Pubblicare l'app v24 (push su GitHub Pages).
