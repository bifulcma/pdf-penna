# Fase 2: da "PDF Penna" a quaderno unico con sync OneDrive
Estendi l'app esistente (stesso repo, stesso URL https://bifulcma.github.io/pdf-penna/). Non rompere le funzioni attuali.

## Aggiungere
1. **Libreria quaderni**: schermata iniziale con quaderni e cartelle; ogni quaderno ha pagine: foglio bianco / righe / quadretti, oppure un PDF importato. Riordino pagine, rinomina, elimina, copertina colorata.
2. **Note di testo** (blocchi di testo formattato semplice: titolo, elenco, checklist) + scrittura a mano con Pencil (riusa il motore penna attuale) + immagini incollate/inserite.
3. **Ricerca** per titolo e testo delle note (la scrittura a mano non è ricercabile in v1).
4. **Sync OneDrive**: login Microsoft con MSAL.js (libreria salvata IN LOCALE in lib/, niente CDN), flusso SPA PKCE, scope `Files.ReadWrite.AppFolder offline_access User.Read`, API Microsoft Graph sulla approot (cartella Apps/<nome app>). Ogni quaderno = una cartella o un file JSON + allegati (PDF/immagini) su OneDrive. Sync bidirezionale con ultima modifica che vince per pagina (timestamp + eTag), funzionamento offline-first (IndexedDB locale è la fonte, sync in background quando c'è rete e al ritorno in primo piano), indicatore di stato (sincronizzato / in corso / offline / errore) e pulsante "Sincronizza ora". Il Client ID sta in un file `config.js` (CLIENT_ID = 'INSERIRE_CLIENT_ID'); se vuoto l'app funziona solo in locale e mostra "Collega OneDrive" disattivato con spiegazione semplice. Redirect URI = URL dell'app (https://bifulcma.github.io/pdf-penna/).
5. UI italiano, stile crema #FAF9F5 / terracotta #C2664A, comoda su iPad e iPhone (layout responsive: su iPhone barra in basso, lista singola).
6. Service worker aggiornato (cache versionata, nuova versione si carica al riavvio).

## Verifica obbligatoria
- node --check; test e2e Chrome headless: crea quaderno, nota, tratto, riavvio -> persistenza; PDF importato in quaderno; export PDF.
- Test del sync con un finto Graph (mock server locale o fetch mockato): upload, download da secondo "dispositivo" (secondo profilo/DB), conflitto, offline->online. Il login reale Microsoft NON si può provare: dichiaralo.
- Screenshot 1024x768 e 390x844. 
- Pubblica con push su main (GitHub Pages già attivo), verifica 200 e MIME.
- Stampa alla fine: cosa verificato / NON verificato.
