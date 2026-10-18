// Finto Ollama (solo /api/tags e /api/chat in streaming NDJSON), per i test del bridge e dell'app.
// Parole nella domanda: LENTO = non risponde mai, LUNGO = risposta lenta a molti pezzi, ERRORE = errore di Ollama.
import http from 'node:http';
export const QWEN_ANSWER = 'Questo passaggio dice che la **libertà** è un dono.\n\n- serve *virtù*\n- serve pazienza\n\nIn breve: `crescere` insieme.';
// quando nel messaggio ci sono le fonti dal web (Qwen + Tavily): risposta che cita [1] e [2] e un URL
export const QWEN_WEB_ANSWER = 'Secondo le fonti, la Compagnia di Gesù fu approvata da Paolo III nel **1540** [1][2].\n\n- Fondatore: *Ignazio di Loyola* [2]\n\nFonti:\n1. https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9\n2. https://www.ilpost.it/2013/03/14/gesuiti/';
export function startOllama(port, { models = ['qwen3:14b', 'llama3.2:3b', 'nomic-embed-text:latest'], delay = 70 } = {}) {
  const st = { requests: [], closedEarly: 0, open: 0, tags: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { st.tags++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: models.map((name) => ({ name, model: name })) })); }
    if (req.url !== '/api/chat' || req.method !== 'POST') { res.writeHead(404); return res.end('404'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      st.requests.push(body);
      const last = body.messages[body.messages.length - 1].content;
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
