# BRIEF 13 — L'AI legge la scrittura a mano; tratto di penna morbido (MB 15/11/26)

## 1. Scrittura a mano all'AI
Prima l'AI riceveva solo testo (frase scelta e testo stampato della pagina): i tratti a penna non arrivavano mai.
Ora, se la pagina ha tratti (penna o evidenziatore), l'app manda anche una **foto della pagina** (lo stesso disegno
delle miniature, largo 1100 px, JPEG): testo + evidenziazioni + immagini + testi + tratti.

- App (`app.js`): `inkImage()` / `inkOk()`; `askContext` aggiunge `images` e `ctx.ink`; il pannello scrive
  «Pagina N · con la scrittura a mano». Una pagina senza testo stampato ma con tratti ora si può chiedere.
- Messaggio (`ask.js`, `INK_NOTE`): dice al modello di leggere anche la scrittura a mano e di segnalare le parole incerte.
- Bridge 7 (`studio-bridge/bridge.py`): campo `images` (max 3, JPEG/PNG in base64, max ~1,1 MB l'una; `max_body` 6 MB).
  - Ollama (Nemotron, Qwen, Gemma: tutti con `vision`): le immagini vanno nel campo `images` dell'ultimo messaggio.
  - Claude: `--input-format stream-json`, un messaggio JSON con blocchi immagine + testo; sempre senza strumenti.
  - Argon: rifiutato con messaggio chiaro (legge solo testo).
  - `/health` → `immagini: { ok, claude, max }`; registro e `save_answers` senza i dati delle immagini.
- Bridge vecchio (senza `immagini`): l'app manda solo il testo, come prima.

Provato con i modelli veri (15/11): Claude Sonnet e Gemma 4 31B leggono un «OK» scritto a mano nel margine e la riga evidenziata.

## 2. Tratto di penna morbido
Prima: una retta da un punto al successivo, ognuna con il suo spessore → con la penna veloce si vedevano gli spigoli.
Ora: curve quadratiche per i punti medi (`penPieces`, `penPieceAt` in `pdfexport.js`), stesse sullo schermo, mentre si
scrive e nel PDF esportato; la pressione è ammorbidita mentre si scrive (60% precedente + 40% nuova). I dati salvati
non cambiano formato: i tratti vecchi si vedono subito più morbidi.

## Test
- `node tests/immagini.mjs` (bridge, 13), `node tests/inchiostro.mjs` (app nel browser + bridge vero, 9).
- Invariati: e2e 34/34, ipad 97/97, dito 10/10. `fase9` ha 2 errori che c'erano già prima (aspetta il bridge «versione 4»).

## Da fare sul Mac
Aggiornare il bridge (versione 7): rilanciare `install.sh` dal Mac Studio.
