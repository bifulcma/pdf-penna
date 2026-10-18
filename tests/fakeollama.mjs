// Finto Ollama (solo /api/tags e /api/chat in streaming NDJSON), per i test del bridge e dell'app.
// Parole nella domanda: LENTO = non risponde mai, LUNGO = risposta lenta a molti pezzi, ERRORE = errore di Ollama.
import http from 'node:http';
export const QWEN_ANSWER = 'Questo passaggio dice che la **libertà** è un dono.\n\n- serve *virtù*\n- serve pazienza\n\nIn breve: `crescere` insieme.';
// quando nel messaggio ci sono le fonti dal web (Qwen + Tavily): risposta che cita [1] e [2] e un URL
export const QWEN_WEB_ANSWER = 'Secondo le fonti, la Compagnia di Gesù fu approvata da Paolo III nel **1540** [1][2].\n\n- Fondatore: *Ignazio di Loyola* [2]\n\nFonti:\n1. https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9\n2. https://www.ilpost.it/2013/03/14/gesuiti/';
// Passo 1 del web (fase 9): il bridge chiede le ricerche senza streaming ("stream": false, risposta JSON). Parole nel messaggio:
// Sufyani = una ricerca mirata; SCARSO = ricerca che dà risultati fuori tema (poi, al secondo tentativo, una buona);
// SEMPRE-SCARSO = fuori tema anche al secondo tentativo; PIANO-ROTTO = risposta senza JSON; PIANO-LENTO = non risponde;
// PIANO-ELENCO = elenco "1. …" invece del JSON; NO-THINK = Ollama vecchio che non conosce "think" (errore 400 la prima volta).
export function planFor(text) {
  if (text.includes('Ho già cercato')) {
    if (text.includes('SEMPRE-SCARSO')) return { queries: ['SCARSO quattro'], keywords: ['Zorbex'] };
    if (text.includes('SCARSO')) return { queries: ['Compagnia di Gesù 1540 Paolo III'], keywords: ['Compagnia di Gesù'] };
    return { queries: ['al-Sufyani hadith Mahdi'], keywords: ['Sufyani'] };
  }
  if (text.includes('SCARSO')) return { queries: ['SCARSO tre'], keywords: ['Zorbex'] };
  if (text.includes('Sufyani')) return { queries: ['Sufyani escatologia sciita'], keywords: ['Sufyani'] };
  return { queries: ['Compagnia di Gesù approvazione 1540'], keywords: ['Compagnia di Gesù'] };
}
export function startOllama(port, { models = ['qwen3:14b', 'llama3.2:3b', 'nomic-embed-text:latest'], delay = 70, planDelay = 30 } = {}) {
  const st = { requests: [], plans: [], closedEarly: 0, open: 0, tags: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { st.tags++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: models.map((name) => ({ name, model: name })) })); }
    if (req.url !== '/api/chat' || req.method !== 'POST') { res.writeHead(404); return res.end('404'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const last = body.messages[body.messages.length - 1].content;
      if (body.stream === false) { // scelta delle ricerche
        st.plans.push(body);
        if (last.includes('PIANO-LENTO')) return;
        if (last.includes('NO-THINK') && 'think' in body) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid option "think"' })); }
        const content = last.includes('PIANO-ROTTO') ? 'Mi dispiace, non so.' : last.includes('PIANO-ELENCO') ? 'Ecco:\n1. Sufyani escatologia sciita\n2. Sufyani Mahdi'
          : '<think>scelgo</think>' + JSON.stringify(planFor(last));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return setTimeout(() => res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content }, done: true })), planDelay);
      }
      st.requests.push(body);
      if (!models.includes(body.model)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `model "${body.model}" not found` })); }
      if (last.includes('LENTO')) return; // nessuna risposta
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      if (last.includes('ERRORE')) { res.end(JSON.stringify({ error: 'out of memory' }) + '\n'); return; }
      // il ragionamento <think> spezzato a metà del tag, come capita davvero
      const pieces = last.includes('LUNGO') ? Array.from({ length: 80 }, (_, i) => 'pezzo ' + i + ' ')
        : ['<thi', 'nk>ci penso', ' un attimo</th', 'ink>\n\n', ...(last.includes('Fonti dal web') ? QWEN_WEB_ANSWER : QWEN_ANSWER).match(/.{1,9}/gs)];
      let i = 0, done = false;
      st.open++;
      res.on('close', () => { st.open--; if (!done) st.closedEarly++; });
      const tick = () => {
        if (res.destroyed) return;
        if (i < pieces.length) { res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: pieces[i++] }, done: false }) + '\n'); setTimeout(tick, last.includes('LUNGO') ? 150 : delay); return; }
        done = true;
        res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true }) + '\n');
      };
      tick();
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, st, close: () => new Promise((c) => { srv.closeAllConnections?.(); srv.close(c); }) })));
}
