// Test delle funzioni pure di ask.js (indirizzo, token, streaming SSE, testi, scelta delle pagine, markdown). Uso: node tests/ask-unit.mjs
import * as A from '../ask.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + JSON.stringify(extra) : '')); };

// ---------- indirizzo e token ----------
const u = (s) => A.parseUrl(s);
ok('https://studio.tail1234.ts.net va bene', u('https://studio.tail1234.ts.net').url === 'https://studio.tail1234.ts.net');
ok('spazi e / finale tolti', u('  https://studio.tail1234.ts.net/  ').url === 'https://studio.tail1234.ts.net');
ok('senza https:// lo aggiungo io', u('studio.tail1234.ts.net').url === 'https://studio.tail1234.ts.net');
ok('porta tenuta (Tailscale può usare :8443)', u('https://studio.tail1234.ts.net:8443').url === 'https://studio.tail1234.ts.net:8443');
ok('http:// rifiutato (contenuto misto: Safari lo bloccherebbe)', !u('http://studio.tail1234.ts.net').ok && /https:\/\//.test(u('http://studio.tail1234.ts.net').error));
ok('http://127.0.0.1 e localhost accettati (prove sul Mac)', u('http://127.0.0.1:8787').ok && u('http://localhost:8787/').url === 'http://localhost:8787');
ok('ftp:// e javascript: rifiutati', !u('ftp://x.ts.net').ok && !u('javascript:alert(1)').ok);
ok('nome:password@ rifiutato', !u('https://a:b@studio.ts.net').ok);
ok('?query rifiutata', !u('https://studio.ts.net/?x=1').ok);
ok('vuoto → messaggio', !u('').ok && /indirizzo/.test(u('').error));
const both = u('https://studio.tail1234.ts.net#token=AbC_dEf-123456789012345678901234567890xyz');
ok('riga unica "indirizzo#token=…" → indirizzo e token separati', both.ok && both.url === 'https://studio.tail1234.ts.net' && both.token === 'AbC_dEf-123456789012345678901234567890xyz', both);
ok('token buono', A.checkToken(' AbC_dEf-1234567890123456789012345678901234 ').token === 'AbC_dEf-1234567890123456789012345678901234');
ok('token vuoto, corto o con spazi → messaggio', !A.checkToken('').ok && !A.checkToken('abc').ok && !A.checkToken('abc def ghi jkl mno pqr').ok);
ok('token con a capo (header rotto) rifiutato', !A.checkToken('AbCdEfGhIjKlMnOpQrStUv\nX-Evil: 1').ok);

// ---------- SSE ----------
const evs = [];
const feed = A.sseReader((n, d) => evs.push([n, d]));
const stream = 'event: meta\ndata: {"provider":"qwen","model":"qwen3:14b"}\n\n: ping\n\nevent: text\ndata: {"t":"Ciao "}\n\nevent: text\r\ndata: {"t":"**mondo**\\n"}\r\n\r\nevent: done\ndata: {}\n\n';
for (let i = 0; i < stream.length; i += 7) feed(stream.slice(i, i + 7)); // pezzi spezzati a caso
ok('SSE: eventi letti anche spezzati a metà, ping ignorati, \\r\\n ok', JSON.stringify(evs) === JSON.stringify([['meta', { provider: 'qwen', model: 'qwen3:14b' }], ['text', { t: 'Ciao ' }], ['text', { t: '**mondo**\n' }], ['done', {}]]), evs);

// ---------- testi ----------
const sel = A.buildMessage({ title: 'Libro', scope: 'sel', quote: 'La libertà è un dono', page: 3, pageText: 'Tutta la pagina 3' }, { action: 'explain' });
ok('Spiega (selezione): titolo, frase, pagina, contesto della pagina, istruzione', /Documento: «Libro»/.test(sel) && /Testo selezionato \(pagina 3\):\n"""\nLa libertà è un dono\n"""/.test(sel) && /Tutta la pagina 3/.test(sel) && /Spiega il testo selezionato/.test(sel), sel);
const pg = A.buildMessage({ title: 'Libro', scope: 'page', page: 7, pageText: 'Testo sette' }, { action: 'sum' });
ok('Riassumi questa pagina', /Testo della pagina 7:/.test(pg) && /Riassumi questa pagina/.test(pg));
const fq = A.buildMessage({ title: 'Libro', scope: 'doc', docText: '[Pagina 1]\nAbc', docNote: 'Passaggi (pagine 1 su 9):' }, { question: '  Chi è l’autore? ' });
ok('Domanda sul PDF: passaggi + domanda', /Passaggi \(pagine 1 su 9\):/.test(fq) && /Domanda: Chi è l’autore\?\nRispondi basandoti sul testo/.test(fq));
ok('le virgolette triple nel testo non chiudono il blocco', !/"""x"""/.test(A.buildMessage({ title: 't', scope: 'sel', quote: 'a """x""" b', page: 1 }, { action: 'tr' }).split('\n').slice(2, 5).join('')));
ok('tutte le azioni hanno testo per selezione, pagina e PDF', A.ACTIONS.length === 4 && A.ACTIONS.every((a) => a.sel && a.page && a.doc) && A.ACTIONS.map((a) => a.label).join('|') === 'Spiega|Riassumi|Traduci in italiano|Obiezioni');
ok('commento salvato: azione — sorgente, poi la risposta', A.commentText({ action: 'explain' }, 'claude', 'sonnet', ' Risposta. ') === '✦ Spiega — Claude Sonnet\n\nRisposta.' && A.commentText({ question: 'Perché?' }, 'qwen', 'qwen3:14b', 'X') === '✦ Domanda: Perché? — Qwen\n\nX');

// ---------- scelta delle pagine ----------
ok('parole chiave: niente parole vuote, accenti tolti, radici', JSON.stringify(A.keywords('Cosa dice il PDF sulla clausola rescissoria e sulla libertà?')) === JSON.stringify(['clauso', 'rescissor', 'liber']), A.keywords('Cosa dice il PDF sulla clausola rescissoria e sulla libertà?'));
const book = Array.from({ length: 300 }, (_, i) => ({ n: i + 1, text: 'Pagina ' + (i + 1) + '. ' + 'Riga del testo di prova con parole comuni per riempire. '.repeat(18) + (i + 1 === 150 ? 'Clausola rescissoria: il contratto si scioglie se.' : '') + (i + 1 === 40 ? 'Le clausole del contratto sono tre.' : '') }));
const pk = A.pickPages(book, 'Cosa dice la clausola rescissoria?', { budget: 24000, current: 1 });
ok(`libro da 300 pagine: scelte ${pk.pages.join(', ')} (la pagina giusta e le vicine), ${pk.chars} caratteri entro 24.000`, pk.pages.includes(150) && pk.pages.includes(149) && pk.pages.includes(151) && pk.chars <= 24000 && !pk.all && pk.pages.length < 30, pk.pages);
ok('la pagina con entrambe le parole viene prima di quella con una sola', pk.pages.indexOf(150) >= 0 && pk.text.indexOf('[Pagina 150]') >= 0 && (!pk.pages.includes(40) || pk.hits >= 2));
ok('nota per il modello: quali pagine e perché', /pagine .*150.* su 300; scelte perché contengono le parole della domanda/.test(pk.note), pk.note);
ok('etichetta: "4 pagine su 300 (39–41, 149–151)"', A.pagesLabel([149, 150, 151], 300) === '3 pagine su 300 (149–151)' && A.pagesLabel([7], 9) === '1 pagina su 9 (pagina 7)' && A.pagesLabel([1, 2, 5], 9) === '3 pagine su 9 (1–2, 5)');
const small = A.pickPages(book.slice(0, 5), 'qualsiasi', { budget: 24000 });
ok('PDF corto: va tutto (5 pagine)', small.all && small.pages.length === 5 && /tutte le 5 pagine/.test(small.note));
const none = A.pickPages(book, 'xyzzy quux', { budget: 6000, current: 100 });
ok('nessuna parola trovata: pagina corrente e vicine, poi dall’inizio', none.pages.includes(100) && none.pages.includes(99) && none.pages.includes(1) && none.chars <= 6000 && /nessuna parola/.test(none.note), none.pages);
ok('pagine senza testo (scansioni) saltate', A.pickPages([{ n: 1, text: '' }, { n: 2, text: '  ' }], 'a').pages.length === 0);
const huge = A.pickPages([{ n: 1, text: 'a '.repeat(20000) + 'parola' }, { n: 2, text: 'b '.repeat(20000) }], 'parola', { budget: 9000, perPage: 8000 });
ok('una pagina enorme viene accorciata (al massimo 8.000 caratteri)', huge.chars <= 9000 && huge.pages.length === 1);

// ---------- markdown ----------
const b = A.mdBlocks('# Titolo\n\nUn **paragrafo** con *corsivo*\nsu due righe.\n\n- uno\n- due\n  continua\n\n1. primo\n2. secondo\n\n> citazione\n\n```\ncodice <b>\n```\n\n---');
ok('markdown: titolo, paragrafo, elenchi, citazione, codice, riga', b.map((x) => x.t).join(',') === 'h,p,ul,ol,quote,code,hr' && b[2].items[1] === 'due continua' && b[5].text === 'codice <b>', b);
const inl = A.mdInline('a **b** c *d* e `f` g_h_i 2*3*4 **non chiuso');
ok('markdown in linea: grassetto, corsivo, codice; niente corsivo dentro le parole', JSON.stringify(inl.filter((x) => x.t !== 'text')) === JSON.stringify([{ t: 'b', s: 'b' }, { t: 'i', s: 'd' }, { t: 'code', s: 'f' }]) && inl.map((x) => x.s).join('') === 'a b c d e f g_h_i 2*3*4 **non chiuso', inl);
ok('nessun "lookbehind" nelle espressioni (Safari < 16.4 non partirebbe)', !/\(\?<[=!]/.test((await import('node:fs')).readFileSync(new URL('../ask.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')));

// ---------- "Cerca sul web" (fase 8) ----------
const lk = A.mdInline('Vedi [Il Post](https://www.ilpost.it/2013/03/14/gesuiti/) e https://it.wikipedia.org/wiki/Compagnia_(ordine)). Fine.');
ok('link in linea: [titolo](url) e URL scritto per intero (con le parentesi sue, senza la punteggiatura dopo)', JSON.stringify(lk.filter((x) => x.t === 'a')) === JSON.stringify([{ t: 'a', s: 'Il Post', href: 'https://www.ilpost.it/2013/03/14/gesuiti/' }, { t: 'a', s: 'https://it.wikipedia.org/wiki/Compagnia_(ordine)', href: 'https://it.wikipedia.org/wiki/Compagnia_(ordine)' }]) && lk[lk.length - 1].s === '). Fine.', lk);
const ev = A.mdInline('[clic](javascript:alert(1)) e javascript:alert(2) e data:text/html,x e [f](file:///etc/hosts)');
ok('niente link per javascript:, data:, file: (restano testo)', ev.every((x) => x.t === 'text'), ev);
ok('safeUrl: solo http/https', A.safeUrl('https://a.it/x') === 'https://a.it/x' && A.safeUrl('http://b.it') === 'http://b.it/' && [' javascript:alert(1)', 'data:text/html,x', 'file:///etc/hosts', 'https://a b.it', 'ftp://x.it', '//x.it', ''].every((u) => A.safeUrl(u) === null));
ok('URL tra «» o con punto finale', A.trimUrl('https://d.it».') === 'https://d.it' && A.trimUrl('https://x.it/a_(b)') === 'https://x.it/a_(b)' && A.trimUrl('https://x.it/a)') === 'https://x.it/a');
const found = [{ n: 1, title: 'Wiki', url: 'https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9' }, { n: 2, title: 'Il Post', url: 'https://www.ilpost.it/2013/03/14/gesuiti/' }, { n: 3, title: 'Tranello', url: 'https://esempio.example/t' }, { n: 4, title: 'x', url: 'javascript:alert(1)' }];
const cq = A.collectSources('Approvata nel **1540** [2][1].\n\nFonti:\n1. https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9\n2. https://ilpost.it/2013/03/14/gesuiti', found, true);
ok('Fonti (Qwen): i numeri [2][1] → quelle fonti, in ordine di citazione, con il titolo; URL ripetuti una volta sola; la [3] non citata no', cq.cited && cq.list.map((s) => s.title).join('|') === 'Il Post|Wiki' && cq.list[0].host === 'ilpost.it', cq);
const cc = A.collectSources('Nel 1540 ([Il Post](https://www.ilpost.it/2013/03/14/gesuiti/)).\n\nFonti: https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9, https://nuovo.example/x.', [{ title: 'Compagnia di Gesù [Wikipedia]', url: 'https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9' }]);
ok('Fonti (Claude): link e URL della risposta; titolo da quello del link o della ricerca, se no il sito', cc.cited && cc.list.map((s) => s.title).join('|') === 'Il Post|Compagnia di Gesù [Wikipedia]|nuovo.example' && cc.list[2].url === 'https://nuovo.example/x', cc);
const cn = A.collectSources('Nessuna fonte citata.', found, false);
ok('risposta senza citazioni → «Pagine consultate» (le trovate, senza javascript:)', !cn.cited && cn.list.length === 3 && !JSON.stringify(cn).includes('javascript'), cn);
ok('nessuna fonte → lista vuota', A.collectSources('ciao', [], false).list.length === 0);
const srcs = cq.list;
ok('Salva come commento col web: «· web» nell’intestazione e in fondo «Fonti:» con gli URL', A.commentText({ action: 'explain' }, 'qwen', '', 'Risposta [1].', { web: true, sources: srcs }) === '✦ Spiega — Qwen · web\n\nRisposta [1].\n\nFonti:\n1. Il Post — https://www.ilpost.it/2013/03/14/gesuiti/\n2. Wiki — https://it.wikipedia.org/wiki/Compagnia_di_Ges%C3%B9');
ok('Copia: risposta + fonti; senza fonti solo la risposta', A.withSources(' R ', srcs.slice(0, 1)) === 'R\n\nFonti:\n1. Il Post — https://www.ilpost.it/2013/03/14/gesuiti/' && A.withSources(' R ', []) === 'R');
ok('cosa cercare: domanda corta + la frase selezionata', A.webQuery({ scope: 'sel', quote: 'La Compagnia di Gesù\nfu approvata', title: 'Libro' }, { question: ' quando? ' }) === 'quando? — La Compagnia di Gesù fu approvata');
ok('cosa cercare: domanda lunga da sola; azione → la frase; pagina/PDF → il titolo; al massimo 380 caratteri',
  A.webQuery({ scope: 'page', title: 'T' }, { question: 'chi ha fondato la Compagnia di Gesù e quando' }) === 'chi ha fondato la Compagnia di Gesù e quando'
  && A.webQuery({ scope: 'sel', quote: 'Ignazio di Loyola', title: 'T' }, { action: 'explain' }) === 'Ignazio di Loyola'
  && A.webQuery({ scope: 'doc', title: 'Storia dei gesuiti' }, { action: 'sum' }) === 'Storia dei gesuiti'
  && A.webQuery({ scope: 'sel', quote: 'parola '.repeat(200) }, { action: 'explain' }).length <= 380);
ok('stato: «Sto cercando: «…»» / «Sto leggendo: sito»', A.searchLabel({ q: 'gesuiti 1540' }) === 'Sto cercando: «gesuiti 1540»' && A.searchLabel({ url: 'https://www.vatican.va/x' }) === 'Sto leggendo: vatican.va' && A.searchLabel({}) === 'Sto cercando sul web');

// ---------- errori ----------
ok('401 → token non giusto', /token non è giusto/.test(A.errorText(401, null)));
ok('503 con messaggio del bridge → quel messaggio', A.errorText(503, { error: 'Ollama non risponde' }) === 'Ollama non risponde');
ok('rete giù → "Lo Studio non risponde: è acceso? Tailscale è attivo sull’iPad?"', A.MSG_DOWN === 'Lo Studio non risponde: è acceso? Tailscale è attivo sull’iPad?');

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
