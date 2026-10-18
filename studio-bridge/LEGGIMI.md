# Studio Bridge — "Chiedi" di PDF Penna sul Mac Studio

Fa rispondere il tuo Mac Studio alle domande che fai in PDF Penna (pulsante **Chiedi** ✦):

- **Qwen** — gira sul Mac con Ollama, gratis.
- **Claude** — usa il comando `claude` già collegato al tuo abbonamento Max (niente API a pagamento).

L'iPad arriva al Mac con **Tailscale** (https, solo dentro la tua rete Tailscale). Il bridge riceve solo testo e restituisce solo testo: non esegue comandi sul Mac.

## Installare (una volta, sul Mac Studio)

1. Apri il **Terminale** sul Mac Studio.
2. Incolla questa riga e premi Invio:

   ```
   curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash
   ```

3. Alla fine compaiono **Indirizzo** e **Token**: incollali sull'iPad in **PDF Penna › Impostazioni › Assistente**, poi tocca **Prova connessione**.

Se manca qualcosa (Ollama, un modello Qwen, il login di Claude, i certificati https di Tailscale) lo script lo dice in italiano e spiega cosa fare: poi basta rilanciare la stessa riga.

## Comandi utili

| Cosa | Comando |
|---|---|
| Rivedere il token | `cat ~/.studio-bridge/token` |
| Cambiare il token | `curl -fsSL …/install.sh \| bash -s -- --nuovo-token` |
| Vedere il registro | `tail ~/.studio-bridge/bridge.log` |
| Togliere tutto | `bash ~/.studio-bridge/uninstall.sh` |

## Se non funziona

- **"Lo Studio non risponde"** — il Mac Studio è acceso e con l'utente collegato? L'app Tailscale è accesa sull'iPad? Prova ad aprire l'indirizzo in Safari: deve comparire "Studio Bridge di PDF Penna: attivo".
- **"Il token non è giusto"** — ricopialo con `cat ~/.studio-bridge/token`.
- **Qwen ✗** — apri l'app Ollama; se non hai un modello Qwen: `ollama pull qwen3`.
- **Claude ✗** — nel Terminale scrivi `claude` e fai il login con l'account dell'abbonamento.

## Dettagli tecnici

- `bridge.py`: Python 3 standard (niente da installare), ascolta solo su `127.0.0.1` (porta 8787, o la prima libera).
- Ogni richiesta vuole `Authorization: Bearer <token>`; CORS solo per `https://bifulcma.github.io`; al massimo 2 domande insieme, 2 MB per domanda, 5 minuti per risposta.
- Claude parte come `claude -p --tools "" --no-session-persistence --safe-mode --strict-mcp-config …` (nessuno strumento, niente CLAUDE.md, MCP, plugin o hook), la domanda arriva da stdin, la chiave API eventualmente presente nell'ambiente viene tolta.
- Avvio automatico: `~/Library/LaunchAgents/com.marco.studio-bridge.plist` (riparte da solo se si ferma).
