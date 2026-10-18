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

**Per aggiornare** (per esempio per avere "Cerca sul web"): rilancia la stessa riga. Token e chiave Tavily restano.

## Cerca sul web

Nel pannello **Chiedi** c'è l'interruttore **Cerca sul web** (spento all'inizio; la scelta resta ricordata).

- **Claude + web** — funziona subito. Claude può usare **solo** la ricerca web e la lettura di pagine: niente comandi, niente file del Mac. Cita le fonti con i link.
- **Qwen + web** — serve una chiave **Tavily** (gratis fino a 1000 ricerche al mese). Il Mac cerca con Tavily e passa a Qwen i primi 5 risultati come fonti numerate [1] [2]…

Per mettere la chiave Tavily:

1. Apri **https://app.tavily.com** e accedi (anche con Google).
2. Copia la **API Key** (inizia con `tvly-`).
3. Sul Mac Studio, nel Terminale, incolla questa riga e premi Invio:

   ```
   curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash -s -- --chiave-tavily
   ```

4. Quando chiede la chiave, incollala e premi Invio (non si vede mentre la incolli: è normale).

La chiave resta solo sul Mac (`~/.studio-bridge/tavily.key`, leggibile solo da te): non va all'iPad, né nei registri.
Senza chiave, con Qwen + web compare: *"Per Qwen col web serve la chiave Tavily sullo Studio: usa Claude o vedi LEGGIMI."*

**Privacy**: con il web acceso la domanda e alcuni pezzi del testo escono dal Mac verso internet (con Claude li usa Anthropic per cercare; con Qwen la ricerca va a Tavily).

## Comandi utili

| Cosa | Comando |
|---|---|
| Rivedere il token | `cat ~/.studio-bridge/token` |
| Cambiare il token | `curl -fsSL …/install.sh \| bash -s -- --nuovo-token` |
| Mettere o cambiare la chiave Tavily | `curl -fsSL …/install.sh \| bash -s -- --chiave-tavily` |
| Vedere il registro | `tail ~/.studio-bridge/bridge.log` |
| Togliere tutto | `bash ~/.studio-bridge/uninstall.sh` |

## Se non funziona

- **"Lo Studio non risponde"** — il Mac Studio è acceso e con l'utente collegato? L'app Tailscale è accesa sull'iPad? Prova ad aprire l'indirizzo in Safari: deve comparire "Studio Bridge di PDF Penna: attivo".
- **"Il token non è giusto"** — ricopialo con `cat ~/.studio-bridge/token`.
- **Qwen ✗** — apri l'app Ollama; se non hai un modello Qwen: `ollama pull qwen3`.
- **Claude ✗** — nel Terminale scrivi `claude` e fai il login con l'account dell'abbonamento.
- **Web con Claude ✗** — aggiorna Claude Code: `claude update`, poi rilancia la riga di installazione.
- **Web con Qwen ✗ (manca la chiave Tavily)** — vedi "Cerca sul web" qui sopra. Intanto usa Claude.

## Dettagli tecnici

- `bridge.py`: Python 3 standard (niente da installare), ascolta solo su `127.0.0.1` (porta 8787, o la prima libera).
- Ogni richiesta vuole `Authorization: Bearer <token>`; CORS solo per `https://bifulcma.github.io`; al massimo 2 domande insieme, 2 MB per domanda, 5 minuti per risposta.
- Claude parte come `claude -p --tools "" --no-session-persistence --safe-mode --restricted --strict-mcp-config …` (nessuno strumento, niente CLAUDE.md, MCP, plugin o hook), la domanda arriva da stdin, la chiave API eventualmente presente nell'ambiente viene tolta.
- Col web: `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch --permission-mode dontAsk`, da una cartella temporanea vuota (poi cancellata). Se Claude prova un altro strumento, o fa più di 10 ricerche/letture, il bridge lo ferma. Tutto il suo traffico passa da un proxy interno al bridge che lascia uscire solo verso internet pubblico (https porta 443, http porta 80): bloccati questo Mac, la rete di casa, Tailscale (100.x), indirizzi "travestiti" e IPv6 locali. Le pagine trovate sono trattate come dati, non istruzioni.
- Qwen col web: il bridge chiama solo `https://api.tavily.com` (chiave nell'header, mai nei registri), passa a Qwen titolo, URL ed estratto dei primi 5 risultati tra virgolette, e gli chiede di rispondere solo su quelle fonti citando [1] [2]. `/health` dice `web_claude` e `web_qwen` (ok / manca la chiave), mai la chiave.
- Avvio automatico: `~/Library/LaunchAgents/com.marco.studio-bridge.plist` (riparte da solo se si ferma).
