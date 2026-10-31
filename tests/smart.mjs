// Test della fase 9 sul bridge: ricerca web "intelligente".
// Passo 1: il modello scelto (Qwen finto / Claude finto e VERO) propone 1-3 ricerche mirate dal contesto (richiesta, frase,
// titolo, testo vicino) — mai le parole grezze della selezione. Passo 2: Tavily (finto) per Qwen; per Claude le ricerche
// consigliate in fondo alla domanda. Passo 3: doppioni, forum e social tolti, prima le fonti autorevoli, al massimo 6.
// Passo 5 (Qwen): risultati scarsi o fuori tema → un secondo tentativo riformulato, poi «Non ho trovato fonti affidabili».
// "Modifica ricerca": web_queries usate così come sono, senza passo 1.
// Uso: node tests/smart.mjs   (SKIP_REAL=1 salta Claude vero; REAL_TAVILY=1 con TAVILY_API_KEY prova anche Tavily vero, 1-2 ricerche)
import fs from 'node:fs';
import { startOllama } from './fakeollama.mjs';
import { startTavily, KEY } from './faketavily.mjs';
import { FAKE_CLAUDE, GH, TMP, sleep, startBridge, stopBridges, allBridges, req, ask, textOf, last, evs, alive, fakeCalls } from './bridgekit.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + String(extra).slice(0, 1500) : '')); };
const SUF = 'Allora sterminerà le armate del tiranno Sufyani e riempirà la terra di giustizia.';
const EXPLAIN = 'Spiega il testo selezionato in parole semplici: che cosa vuol dire e perché conta in questo punto.';
const CTX = { title: 'Il ritorno del Mahdi', question: EXPLAIN, quote: SUF, near: 'Capitolo sull’occultamento. ' + SUF + ' Poi verrà la pace.', page: 12 };
const MSG = 'Documento: «Il ritorno del Mahdi»\n\nTesto selezionato (pagina 12):\n"""\n' + SUF + '\n"""\n\n' + EXPLAIN;
const qs = (r) => evs(r, 'queries').map((e) => e.data);
const lastQ = (r) => qs(r).pop() || {};
const tq = (tv, from) => tv.st.requests.slice(from).map((r) => r.body.query);

const ol = await startOllama(11961, { delay: 5 });
const tv = await startTavily(11962);
const DUMP = TMP + '/claude_calls9.jsonl';
try {
  const base = { ollama_url: 'http://127.0.0.1:11961', tavily_url: 'http://127.0.0.1:11962', claude_bin: FAKE_CLAUDE, allowed_origins: [GH] };
  const W = await startBridge('W9', { ...base, port: 8761, web_per_query: 8 }, { FAKE_CLAUDE_DUMP: DUMP }, { 'tavily.key': KEY + '\n' });
  const L = await startBridge('L9', { ...base, port: 8762, plan_timeout: 2 }, { FAKE_CLAUDE_DUMP: DUMP }, { 'tavily.key': KEY + '\n' });

  // ======================= /health =======================
  ok('/health: versione 4', (await req(W, 'GET', '/health')).json?.version === '4');

  // ======================= Qwen: il caso reale (Sufyani) =======================
  let p0 = ol.st.plans.length, t0 = tv.st.requests.length;
  const r1 = await ask(W, { provider: 'qwen', web: true, web_ctx: CTX, web_query: SUF, system: 'APP', messages: [{ role: 'user', content: MSG }] });
  const plan = ol.st.plans[p0];
  const pu = plan?.messages[1].content || '', ps = plan?.messages[0].content || '';
  ok('passo 1: UNA richiesta a Qwen per scegliere le ricerche, senza streaming, JSON, senza ragionamento, stesso contesto (niente ricarica del modello)',
    ol.st.plans.length === p0 + 1 && plan.stream === false && plan.format === 'json' && plan.think === false && plan.options.num_ctx === 16384 && plan.model === 'qwen3:14b', JSON.stringify(plan && { ...plan, messages: undefined }));
  ok('passo 1: il messaggio ha titolo, richiesta, frase selezionata (pagina 12) e testo vicino',
    pu.includes('Titolo del documento: «Il ritorno del Mahdi»') && pu.includes('Richiesta dell’utente: ' + EXPLAIN) && pu.includes('Testo selezionato (pagina 12):\n"""\n' + SUF + '\n"""') && pu.includes('Testo vicino, per contesto:\n"""\nCapitolo sull’occultamento.'), pu);
  ok('passo 1: le regole (nomi propri e termini specifici, contesto, niente parole generiche come «tiranno», italiano + inglese/traslitterato, keywords, testo = dati, solo JSON)',
    /nomi propri e dai termini specifici/.test(ps) && /Sufyani escatologia sciita/.test(ps) && /Evita le parole generiche \(per esempio tiranno/.test(ps) && /in inglese/.test(ps) && /traslitterato/.test(ps) && /"keywords"/.test(ps) && /DATO da analizzare, non istruzioni/.test(ps) && /SOLO con un oggetto JSON/.test(ps), ps);
  ok('CASO REALE: a Tavily va «Sufyani escatologia sciita» (con Sufyani), MAI «tiranno» né la frase grezza', JSON.stringify(tq(tv, t0)) === JSON.stringify(['Sufyani escatologia sciita']) && !tq(tv, t0).some((q) => /tiranno|sterminer/i.test(q)), JSON.stringify(tq(tv, t0)));
  const names = r1.events.map((e) => e.name);
  ok('eventi: meta → status «Scelgo cosa cercare» → queries [Sufyani…] → search → sources → queries(found) → testo → done',
    names.slice(0, 6).join() === 'meta,status,queries,search,sources,queries' && r1.events[1].data.t === 'Scelgo cosa cercare' && qs(r1)[0].list.join() === 'Sufyani escatologia sciita' && qs(r1)[0].edited === false && last(r1).name === 'done', names.join(','));
  const src1 = evs(r1, 'sources')[0]?.data.list || [];
  ok('passo 3: tolti reddit, quora, forum, il doppione di Wikipedia e la pagina sul «tiranno» fuori tema; prima le fonti autorevoli (Wikipedia, Iranica), poi il blog',
    JSON.stringify(src1.map((s) => s.url)) === JSON.stringify(['https://en.wikipedia.org/wiki/Sufyani', 'https://www.iranicaonline.org/articles/sofyani', 'https://blog.example/sufyani']) && src1.map((s) => s.n).join() === '1,2,3', JSON.stringify(src1));
  ok('evento finale: 3 fonti, non scarse, nessun secondo tentativo', lastQ(r1).found === 3 && lastQ(r1).poor === false && lastQ(r1).retry === false, JSON.stringify(lastQ(r1)));
  const um = ol.st.requests[ol.st.requests.length - 1].messages[1].content;
  ok('a Qwen: le fonti con estratto e le ricerche fatte; niente reddit/quora/forum', /Fonti dal web \(ricerche: «Sufyani escatologia sciita»\)/.test(um) && um.includes('[1] Al-Sufyani — Wikipedia\nURL: https://en.wikipedia.org/wiki/Sufyani\nEstratto:\n"""\nAl-Sufyani is an eschatological figure') && !/reddit|quora|forum\./.test(um), um.slice(-1400));

  // ---------- due ricerche (risposta del modello a elenco, non JSON): doppioni tolti anche tra una ricerca e l'altra ----------
  t0 = tv.st.requests.length;
  const r2 = await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, question: 'PIANO-ELENCO' }, messages: [{ role: 'user', content: MSG }] });
  const src2 = evs(r2, 'sources')[0]?.data.list || [];
  ok('modello che risponde a elenco «1. … 2. …»: 2 ricerche fatte, stesse fonti una volta sola', JSON.stringify(tq(tv, t0)) === JSON.stringify(['Sufyani escatologia sciita', 'Sufyani Mahdi']) && src2.length === 3 && new Set(src2.map((s) => s.url)).size === 3 && evs(r2, 'search').length === 2, JSON.stringify([tq(tv, t0), src2]));

  // ---------- passo 5: pochi o fuori tema → un secondo tentativo, poi «Non ho trovato fonti affidabili» ----------
  p0 = ol.st.plans.length; t0 = tv.st.requests.length;
  const r3 = await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, quote: 'testo SCARSO', near: '' }, messages: [{ role: 'user', content: 'SCARSO' }] });
  const rp = ol.st.plans[p0 + 1]?.messages[1].content || '';
  ok('fuori tema (nessun termine chiave negli estratti) → «Pochi risultati utili: provo un’altra ricerca» e una ricerca riformulata', evs(r3, 'status').map((e) => e.data.t).join('|') === 'Scelgo cosa cercare|Pochi risultati utili: provo un’altra ricerca' && JSON.stringify(tq(tv, t0)) === JSON.stringify(['SCARSO tre', 'Compagnia di Gesù 1540 Paolo III']), JSON.stringify([evs(r3, 'status'), tq(tv, t0)]));
  ok('il secondo tentativo sa cosa è già stato cercato («Ho già cercato «SCARSO tre»… DIVERSE…»)', /Ho già cercato «SCARSO tre» ma i risultati erano pochi o fuori tema\. Proponi 1 o 2 ricerche DIVERSE/.test(rp), rp);
  ok('…riuscito: fonti buone (Compagnia di Gesù), non quelle fuori tema; queries = entrambe, retry', (evs(r3, 'sources')[0]?.data.list || []).length === 3 && !JSON.stringify(evs(r3, 'sources')).includes('cucina.example') && lastQ(r3).retry === true && lastQ(r3).list.length === 2 && lastQ(r3).poor === false, JSON.stringify(lastQ(r3)));
  t0 = tv.st.requests.length;
  const r4 = await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, quote: 'SEMPRE-SCARSO', near: '' }, messages: [{ role: 'user', content: 'SEMPRE-SCARSO' }] });
  const um4 = ol.st.requests[ol.st.requests.length - 1].messages[1].content;
  ok('ancora fuori tema: UN solo secondo tentativo (2 ricerche in tutto), nessuna fonte, poor, found 0', tv.st.requests.length === t0 + 2 && evs(r4, 'sources')[0]?.data.list.length === 0 && lastQ(r4).poor === true && lastQ(r4).found === 0 && last(r4).name === 'done', JSON.stringify([tq(tv, t0), lastQ(r4)]));
  ok('…e Qwen deve dirlo chiaramente: «Non ho trovato fonti affidabili sul web per questa domanda.» senza inventare', /comincia la risposta con «Non ho trovato fonti affidabili sul web per questa domanda\.» e poi rispondi solo con il testo del documento, senza inventare fatti/.test(um4), um4.slice(-500));

  // ---------- "Modifica ricerca": web_queries così come sono ----------
  p0 = ol.st.plans.length; t0 = tv.st.requests.length;
  const r5 = await ask(W, { provider: 'qwen', web: true, web_ctx: CTX, web_queries: ['  «al-Sufyani»  Mahdi ', 'Sufyani hadith', 'al-Sufyani mahdi'], messages: [{ role: 'user', content: MSG }] });
  ok('ricerche scritte a mano: niente passo 1, a Tavily esattamente quelle (pulite, senza doppioni), edited', ol.st.plans.length === p0 && JSON.stringify(tq(tv, t0)) === JSON.stringify(['al-Sufyani Mahdi', 'Sufyani hadith']) && qs(r5)[0].edited === true && !evs(r5, 'status').length && last(r5).name === 'done', JSON.stringify([tq(tv, t0), qs(r5)]));
  t0 = tv.st.requests.length;
  const r6 = await ask(W, { provider: 'qwen', web: true, web_ctx: CTX, web_queries: ['SCARSO a mano'], messages: [{ role: 'user', content: 'x' }] });
  ok('scritte a mano ma fuori tema: nessun secondo tentativo (si rispetta la scelta), ma lo dice (poor)', tv.st.requests.length === t0 + 1 && lastQ(r6).poor === true && lastQ(r6).retry === false);

  // ---------- il modello non collabora ----------
  t0 = tv.st.requests.length;
  const r7 = await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, question: 'PIANO-ROTTO' }, messages: [{ role: 'user', content: MSG }] });
  ok('Qwen risponde senza JSON → ricerche di riserva dai nomi propri del testo («Sufyani…»), mai «tiranno»', last(r7).name === 'done' && tq(tv, t0).length >= 1 && /^Sufyani/.test(tq(tv, t0)[0]) && !tq(tv, t0).some((q) => /tiranno|Allora/.test(q)) && /non ha proposto ricerche/.test(W.log()), JSON.stringify(tq(tv, t0)));
  t0 = tv.st.requests.length; let t = Date.now();
  const r8 = await ask(L, { provider: 'qwen', web: true, web_ctx: { ...CTX, question: 'PIANO-LENTO' }, messages: [{ role: 'user', content: MSG }] });
  ok(`Qwen non risponde al passo 1 → dopo plan_timeout (2 s) si va avanti con le ricerche di riserva (${((Date.now() - t) / 1000).toFixed(1)} s)`, last(r8).name === 'done' && /^Sufyani/.test(tq(tv, t0)[0] || '') && Date.now() - t < 6000, JSON.stringify([last(r8), tq(tv, t0)]));
  p0 = ol.st.plans.length;
  const r9 = await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, question: 'NO-THINK' }, messages: [{ role: 'user', content: MSG }] });
  ok('Ollama vecchio che non conosce «think» (400) → riprova senza, funziona', ol.st.plans.length === p0 + 2 && !('think' in ol.st.plans[p0 + 1]) && qs(r9)[0].list[0] === 'Sufyani escatologia sciita' && last(r9).name === 'done');

  // ---------- richieste non valide ----------
  const bad = async (body) => (await req(W, 'POST', '/ask', { body: { provider: 'qwen', web: true, messages: [{ role: 'user', content: 'x' }], ...body } })).status;
  ok('web_queries: 4 ricerche → 400; una da 201 caratteri → 400; non testo → 400; non elenco → 400',
    (await bad({ web_queries: ['a', 'b', 'c', 'd'] })) === 400 && (await bad({ web_queries: ['a'.repeat(201)] })) === 400 && (await bad({ web_queries: [3] })) === 400 && (await bad({ web_queries: 'a' })) === 400);
  ok('web_ctx non oggetto → 400; quote non testo → 400; testi troppo lunghi tagliati (ok)', (await bad({ web_ctx: 'x' })) === 400 && (await bad({ web_ctx: { quote: 5 } })) === 400 && last(await ask(W, { provider: 'qwen', web: true, web_ctx: { ...CTX, near: 'n'.repeat(50000) }, messages: [{ role: 'user', content: MSG }] })).name === 'done');

  // ======================= Claude (finto) =======================
  const r10 = await ask(W, { provider: 'claude', web: true, web_ctx: CTX, system: 'APP', messages: [{ role: 'user', content: MSG }] });
  const calls = fakeCalls(DUMP), cm = calls.pop(), cp = calls.pop();
  const sp = cp.argv.find((a) => a.startsWith('--system-prompt=')) || '';
  ok('Claude passo 1: una chiamata SENZA strumenti (--tools ""), con le regole delle ricerche e il contesto (frase, titolo) da stdin',
    cp.plan === true && cp.argv[cp.argv.indexOf('--tools') + 1] === '' && !cp.argv.includes('--allowedTools') && /RICERCHE WEB/.test(sp) && cp.stdin.includes('Testo selezionato (pagina 12):') && cp.stdin.includes(SUF) && cp.stdin.includes('«Il ritorno del Mahdi»') && ['--safe-mode', '--restricted', '--strict-mcp-config'].every((f) => cp.argv.includes(f)), JSON.stringify(cp.argv.filter((a) => !a.startsWith('--system-prompt'))));
  ok('Claude passo 2: le ricerche proposte (con Sufyani) in fondo alla domanda, come consiglio', cm.stdin === MSG + '\n\nRicerche consigliate per cominciare (poi adattale se servono): «Sufyani escatologia sciita»; «al-Sufyani Mahdi hadith»' && cm.argv[cm.argv.indexOf('--tools') + 1] === 'WebSearch,WebFetch', JSON.stringify(cm.stdin.slice(-200)));
  const csp = cm.argv.find((a) => a.startsWith('--system-prompt=')) || '';
  ok('Claude passo 2: istruzioni esplicite (parti dai nomi propri, 2-3 ricerche diverse, più fonti, fonti autorevoli, evita forum, cita URL)',
    /partendo dai nomi propri e dai termini specifici/.test(csp) && /cerca «Sufyani», non «tiranno»/.test(csp) && /Fai 2-3 ricerche diverse/.test(csp) && /su più fonti/.test(csp) && /Preferisci fonti autorevoli: enciclopedie/.test(csp) && /università/.test(csp) && /Evita forum/.test(csp) && /Cita sempre le fonti con l’URL completo/.test(csp), csp);
  const q10 = qs(r10);
  ok('Claude: evento queries «previste» (Sufyani…) e poi quelle fatte davvero da WebSearch', q10[0].planned === true && /Sufyani/.test(q10[0].list[0]) && q10[q10.length - 1].planned === false && q10[q10.length - 1].list.join() === 'fondazione Compagnia di Gesù 1540' && evs(r10, 'status')[0]?.data.t === 'Scelgo cosa cercare' && last(r10).name === 'done', JSON.stringify(q10));
  const n0 = fakeCalls(DUMP).length;
  await ask(W, { provider: 'claude', web: true, web_ctx: CTX, web_queries: ['al-Sufyani Mahdi'], messages: [{ role: 'user', content: MSG }] });
  const ce = fakeCalls(DUMP);
  ok('Claude con ricerche scritte a mano: niente passo 1, «Ricerche scelte dall’utente: falle per prime, esattamente così: «al-Sufyani Mahdi»»', ce.length === n0 + 1 && ce[n0].plan === false && ce[n0].stdin.endsWith('\n\nRicerche scelte dall’utente: falle per prime, esattamente così: «al-Sufyani Mahdi»'), JSON.stringify(ce.slice(n0).map((c) => c.stdin.slice(-120))));
  const r12 = await ask(W, { provider: 'claude', web: true, web_ctx: { ...CTX, question: 'PIANO-ROTTO' }, messages: [{ role: 'user', content: MSG + ' PIANO-ROTTO' }] });
  ok('Claude senza JSON al passo 1 → ricerche di riserva dai nomi propri («Sufyani…»), poi risponde', /^Sufyani/.test(qs(r12)[0]?.list[0] || '') && last(r12).name === 'done', JSON.stringify(qs(r12)));
  const r13 = await ask(W, { provider: 'claude', web: true, web_ctx: { ...CTX, question: 'STRUMENTI-INIT' }, messages: [{ role: 'user', content: MSG }] });
  const c13 = fakeCalls(DUMP).pop(); await sleep(300);
  ok('Claude parte con uno strumento già al passo 1 → fermato subito, niente seconda chiamata', last(r13).name === 'error' && /strumento non previsto/.test(last(r13).data.message) && c13.plan === true && !alive(c13.pid));
  t = Date.now();
  const r14 = await ask(L, { provider: 'claude', web: true, web_ctx: { ...CTX, question: 'PIANO-LENTO' }, messages: [{ role: 'user', content: MSG }] });
  const c14 = fakeCalls(DUMP).slice(-2); await sleep(300);
  ok(`Claude non risponde al passo 1 → chiuso dopo plan_timeout (2 s), ricerche di riserva, risposta (${((Date.now() - t) / 1000).toFixed(1)} s)`, c14[0].plan === true && !alive(c14[0].pid) && c14[1].plan === false && /Ricerche consigliate .*«Sufyani/.test(c14[1].stdin) && last(r14).name === 'done' && Date.now() - t < 9000, JSON.stringify([last(r14), c14.map((c) => c.plan)]));

  // ---------- registri ----------
  const logs = allBridges().map((b) => b.log()).join('\n');
  ok('registri: niente ricerche, frasi o chiavi (solo cosa è successo)', !/Sufyani|tiranno|Mahdi|SCARSO/.test(logs) && !logs.includes(KEY) && /ask qwen qwen3:14b \+web/.test(logs), logs.slice(-500));

  // ======================= Tavily VERO (facoltativo: REAL_TAVILY=1, consuma 1-2 ricerche) =======================
  if (process.env.REAL_TAVILY && process.env.TAVILY_API_KEY) {
    const T = await startBridge('T9', { ...base, port: 8763, tavily_url: 'https://api.tavily.com' }, { TAVILY_API_KEY: process.env.TAVILY_API_KEY });
    const rt = await ask(T, { provider: 'qwen', web: true, web_ctx: CTX, messages: [{ role: 'user', content: MSG }] });
    const lt = evs(rt, 'sources')[0]?.data.list || [];
    console.log('     Tavily vero — ricerche: ' + JSON.stringify(lastQ(rt).list) + ' · fonti: ' + JSON.stringify(lt.map((s) => s.url)));
    ok(`Tavily VERO con «Sufyani escatologia sciita»: ${lt.length} fonti pertinenti, nessun forum/social`, last(rt).name === 'done' && lt.length >= 2 && !lt.some((s) => /reddit|quora|facebook|forum/.test(s.url)), JSON.stringify(lastQ(rt)));
    ok('Tavily VERO: chiave mai nel registro', !T.log().includes(process.env.TAVILY_API_KEY));
  } else console.log('(Tavily vero saltato: serve REAL_TAVILY=1 e TAVILY_API_KEY)');

  // ======================= Claude VERO: il caso reale =======================
  if (!process.env.SKIP_REAL) {
    const R = await startBridge('R9', { port: 8764, ollama_url: 'http://127.0.0.1:11961', allowed_origins: [GH] }, {});
    t = Date.now();
    const rr = await ask(R, { provider: 'claude', model: 'sonnet', web: true, web_ctx: CTX, system: 'Sei l’assistente di lettura. Rispondi in italiano, in breve (massimo 150 parole).', messages: [{ role: 'user', content: MSG }] });
    const qq = qs(rr), planned = qq.find((x) => x.planned)?.list || [], used = [...qq].reverse().find((x) => !x.planned)?.list || [];
    console.log('     Claude vero — ricerche proposte: ' + JSON.stringify(planned));
    console.log('     Claude vero — ricerche fatte:    ' + JSON.stringify(used));
    console.log('     Claude vero — risposta: ' + JSON.stringify(textOf(rr).slice(0, 400)));
    console.log('     Claude vero — fonti: ' + JSON.stringify((evs(rr, 'sources').pop()?.data.list || []).map((s) => s.url).slice(0, 8)));
    ok(`CASO REALE con Claude VERO: le ricerche proposte contengono «Sufyani» (${planned.length}), nessuna è solo «tiranno»`, planned.length >= 1 && planned.length <= 3 && planned.every((q) => /suf[yi]an/i.test(q) || /mahdi/i.test(q)) && planned.some((q) => /sufyan/i.test(q)) && !planned.some((q) => /^\W*tiranno\W*$/i.test(q)), JSON.stringify(planned));
    ok(`…e le ricerche fatte davvero da Claude cercano «Sufyani» (${used.length}); risposta con link, in ${((Date.now() - t) / 1000).toFixed(0)} s`, used.length >= 1 && used.some((q) => /sufyan|sufyān|sofyan/i.test(q)) && last(rr).name === 'done' && /https?:\/\//.test(textOf(rr)), JSON.stringify([used, last(rr)]));
  } else console.log('(Claude vero saltato: SKIP_REAL)');
} catch (e) { fail++; console.log('FAIL eccezione', e.stack); for (const b of allBridges()) console.log('--- log ' + b.name + '\n' + b.log().slice(-1500)); }
await stopBridges();
await ol.close(); await tv.close();
fs.rmSync(DUMP, { force: true });
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
