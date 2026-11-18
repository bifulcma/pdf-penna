// Test del bridge 8 (18/11/2026): POST /bozza mette nelle bozze di Gmail il PDF del testo trascritto. Google finto, nessuna mail vera.
// Uso: node tests/bozza.mjs
import fs from 'node:fs';
import { startBridge, stopBridges, req, GH, TMP } from './bridgekit.mjs';
import { startGmail } from './fakegmail.mjs';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (!c && x !== '' ? '  — ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const TEXT = '# Quaderno di prova\n\nTrascrizione e analisi · Pagina 1 · Qwen · 18/11/2026\n\n## Trascrizione\n\nIl katéchon trattiene [?]\n';
const g = await startGmail(11961);
const bk = TMP + '/copie';
const cfg = (port) => ({ port, gmail_url: 'http://127.0.0.1:11961', backup_dir: bk });
const gj = (rt = 'rt-buono') => JSON.stringify({ client_id: 'cid', client_secret: 'segretissimo', refresh_token: rt, token_uri: 'http://127.0.0.1:11961/token' });
const post = (b, body, o = {}) => req(b, 'POST', '/bozza', { origin: GH, body, ...o });
const good = (extra = {}) => ({ name: 'Quaderno di prova', subject: 'Quaderno di prova · trascrizione e analisi', text: TEXT, to: [], pdf: PDF.toString('base64'), ...extra });
// parti della bozza: intestazioni decodificate, testo, allegato
function parts(raw) {
  const subj = /^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(raw);
  const att = /Content-Disposition: attachment;[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(raw);
  const txt = /Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(raw);
  const enc = /Content-Type: text\/plain[\s\S]*?Content-Transfer-Encoding: (\S+)/.exec(raw);
  let text = txt ? txt[1] : '';
  if (enc && enc[1] === 'base64') text = Buffer.from(text, 'base64').toString('utf8');
  else if (enc && enc[1] === 'quoted-printable') text = Buffer.from(text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return { subject: subj ? subj[1] : '', to: (/^To: (.*)$/m.exec(raw) || [])[1], text, pdf: att ? Buffer.from(att[1].replace(/\s+/g, ''), 'base64') : null, name: (/filename="?([^"\r\n]+)"?/.exec(raw) || /filename\*=utf-8''(\S+)/.exec(raw) || [])[1] };
}
try {
  // 1. senza gmail.json: spento, con le istruzioni
  const off = await startBridge('spento', cfg(8761));
  let h = (await req(off, 'GET', '/health', { origin: GH })).json;
  ok('health: versione 8; senza gmail.json bozza.ok = false, con il comando da lanciare', h && h.version === '8' && h.bozza && h.bozza.ok === false && /gmail_accesso\.py/.test(h.bozza.error), h && h.bozza);
  let r = await post(off, good());
  ok('senza Gmail collegato: 503 con il comando da lanciare, nessuna richiesta a Google', r.status === 503 && /gmail_accesso\.py/.test(r.json.error) && g.st.tokens === 0 && !g.st.drafts.length, r.text);

  // 2. con gmail.json
  const b = await startBridge('gmail', cfg(8762), {}, { 'gmail.json': gj() });
  h = (await req(b, 'GET', '/health', { origin: GH })).json;
  ok('health: bozza.ok = true (senza dire niente dell’accesso)', h.bozza.ok === true && h.bozza.error === '' && !JSON.stringify(h).includes('rt-buono') && !JSON.stringify(h).includes('segretissimo'), h.bozza);
  r = await post(b, good(), { auth: false });
  ok('senza token: 401, niente bozza', r.status === 401 && !g.st.drafts.length);
  r = await post(b, good(), { origin: 'https://altro.example' });
  ok('da un’altra origine: 403, niente bozza', r.status === 403 && !g.st.drafts.length);

  r = await post(b, good());
  let d = g.st.drafts.length === 1 ? parts(g.st.drafts[0]) : null;
  ok('bozza creata: 200 { ok, saved }', r.status === 200 && r.json.ok === true && r.json.saved === true, r.text);
  ok('a Google: rinnovo con client e refresh token, poi UNA bozza (mai un invio)', g.st.tokens === 1 && g.st.lastForm.client_id === 'cid' && g.st.lastForm.client_secret === 'segretissimo' && g.st.drafts.length === 1);
  ok('la bozza: oggetto, nessun destinatario, il testo nella mail', d && /Quaderno di prova/.test(d.subject) && d.to === undefined && d.text.includes('Il katéchon trattiene [?]'), d && { s: d.subject, to: d.to, t: d.text.slice(0, 200) });
  ok('la bozza: il PDF allegato, identico, con il nome del quaderno', d && d.pdf && d.pdf.equals(PDF) && d.name === 'Quaderno di prova.pdf', d && d.name);
  const dir = bk + '/trascrizioni', files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  ok('copia sul Mac: PDF e .md in trascrizioni/, leggibili solo da te', files.length === 2 && /^Quaderno di prova \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.md$/.test(files[0]) && files[1].endsWith('.pdf')
    && fs.readFileSync(dir + '/' + files[1]).equals(PDF) && fs.readFileSync(dir + '/' + files[0], 'utf8') === TEXT && (fs.statSync(dir + '/' + files[0]).mode & 0o777) === 0o600, files);

  r = await post(b, good({ to: ['anna@example.org', ' luca.rossi@studio.example.com '], subject: 'Riga 1\nBcc: spia@example.org' }));
  d = parts(g.st.drafts.at(-1));
  ok('con destinatari: nel campo A; il permesso di Google riusato (nessun secondo rinnovo)', r.status === 200 && d.to === 'anna@example.org, luca.rossi@studio.example.com' && g.st.tokens === 1, d.to);
  ok('oggetto su una riga sola: niente intestazioni infilate', !/^Bcc:/m.test(g.st.drafts.at(-1)) && /Riga 1 Bcc: spia@example\.org/.test(d.subject), d.subject);

  // 3. richieste sbagliate: 400, niente a Google
  const n0 = g.st.drafts.length;
  const bad = async (name, body, re) => { const x = await post(b, body); ok(name, x.status === 400 && re.test(x.json.error) && g.st.drafts.length === n0, x.text); };
  await bad('PDF che non è un PDF → 400', good({ pdf: Buffer.from('ciao').toString('base64') }), /PDF non valido/);
  await bad('PDF non base64 → 400', good({ pdf: '%%%' }), /PDF non valido/);
  await bad('senza PDF → 400', good({ pdf: '' }), /PDF mancante/);
  await bad('senza testo → 400', good({ text: '  ' }), /Testo mancante/);
  await bad('destinatario non valido → 400', good({ to: ['anna@example.org\nBcc: x@y.it'] }), /destinatario non valido/);
  await bad('troppi destinatari → 400', good({ to: Array.from({ length: 6 }, (_, i) => 'a' + i + '@example.org') }), /destinatario non valido/);
  await bad('JSON rovinato → 400', '{"name":', /JSON/);
  r = await post(b, good({ name: '../../fuori', to: 'anna@example.org' }));
  ok('nome del quaderno con «../»: la copia resta dentro trascrizioni/', r.status === 200 && fs.readdirSync(dir).length === 6 && !fs.existsSync(TMP + '/fuori.pdf') && fs.readdirSync(bk).join() === 'trascrizioni', fs.readdirSync(bk));

  // 4. il permesso temporaneo scade prima del previsto: uno nuovo e riprova, una volta
  g.st.expireNext = true;
  r = await post(b, good());
  ok('401 da Gmail: nuovo permesso e bozza creata lo stesso', r.status === 200 && g.st.tokens === 2, r.text);
  g.st.status = 500;
  r = await post(b, good());
  ok('errore di Gmail: 502 con un messaggio chiaro; la copia sul Mac c’è lo stesso', r.status === 502 && /errore \(500\)/.test(r.json.error) && r.json.saved === true, r.text);
  g.st.status = 200;

  // 5. accesso scaduto o tolto (invalid_grant): messaggio con il comando per ricollegare
  const old = await startBridge('scaduto', cfg(8763), {}, { 'gmail.json': gj('rt-vecchio') });
  r = await post(old, good());
  ok('accesso scaduto: 502 «L’accesso a Gmail è scaduto… gmail_accesso.py»', r.status === 502 && /scaduto/.test(r.json.error) && /gmail_accesso\.py/.test(r.json.error), r.text);
  const rotto = await startBridge('rotto', cfg(8764), {}, { 'gmail.json': '{"client_id": "x"' });
  ok('gmail.json rovinato: come spento', (await req(rotto, 'GET', '/health', { origin: GH })).json.bozza.ok === false);
  const giu = await startBridge('giu', { port: 8765, gmail_url: 'http://127.0.0.1:9', backup_dir: bk, gmail_timeout: 3 }, {}, { 'gmail.json': JSON.stringify({ client_id: 'c', client_secret: 's', refresh_token: 'r', token_uri: 'http://127.0.0.1:9/token' }) });
  r = await post(giu, good());
  ok('Google non raggiungibile: 502 «Gmail non risponde»', r.status === 502 && /non risponde/.test(r.json.error), r.text);

  const logs = [b, old, off].map((x) => x.log()).join('\n');
  ok('registri: niente testo, destinatari, token o segreti', !/katéchon|anna@|rt-buono|segretissimo|ya29|Quaderno di prova/.test(logs) && !logs.includes(b.token) && /bozza -> ok/.test(logs), logs.split('\n').filter((l) => /bozza/.test(l)).slice(0, 4));
} catch (e) {
  fail++; console.log('FAIL eccezione: ' + (e.stack || e));
} finally {
  await stopBridges(); await g.close();
  console.log('\nRISULTATO: ' + pass + '/' + (pass + fail) + ' ok');
  process.exit(fail ? 1 : 0);
}
