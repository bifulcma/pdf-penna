// Test di textpdf.js (brief 14): la risposta in markdown diventa un PDF A4. Uso: node tests/textpdf-unit.mjs [cartella per guardare i PDF]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.PDFLib = require('../lib/pdf-lib.min.js');
const { buildTextPdf, safeText } = await import('../textpdf.js');
const pdfjs = await import('../lib/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (!c && x !== '' ? '  — ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
async function textOf(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, standardFontDataUrl: new URL('../lib/standard_fonts/', import.meta.url).pathname }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const rows = new Map(); // righe per altezza
    for (const it of tc.items) { const y = Math.round(it.transform[5]); rows.set(y, (rows.get(y) || []).concat(it)); }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join('')).join('\n'));
  }
  return { n: doc.numPages, pages, meta: (await doc.getMetadata()).info };
}
const MD = `## Trascrizione

Il **katéchon** trattiene: «non spezza il lógos», lo *rinnova* — così [?] dice la nota a margine, con un link https://example.org/una/pagina/lunga.

- primo punto, con una parola [illeggibile]
- secondo punto → conseguenza ≥ 3 ✓
1. uno
2. due

> una citazione scritta a mano

---

## Analisi

L’idea centrale: perché l’ordine regge. 😀 Čapek, Łódź, Ω.

\`\`\`
codice  fisso
\`\`\``;
const out = process.argv[2];
let bytes = await buildTextPdf(MD, { title: 'Quaderno di prova — escaton', meta: 'Trascrizione e analisi · Pagina 3 · Claude Sonnet · 18/11/2026' });
if (out) fs.writeFileSync(out + '/breve.pdf', bytes);
ok('è un PDF', Buffer.from(bytes.slice(0, 5)).toString() === '%PDF-' && bytes.length > 1500, bytes.length);
let t = await textOf(bytes);
const all = t.pages.join('\n');
ok('una pagina, con titolo e riga piccola', t.n === 1 && all.includes('Quaderno di prova — escaton') && all.includes('Trascrizione e analisi · Pagina 3 · Claude Sonnet · 18/11/2026'), all);
ok('titolo del documento nei dati del PDF', t.meta.Title === 'Quaderno di prova — escaton' && t.meta.Creator === 'PDF Penna', t.meta);
ok('i titoli delle due parti, senza i «##»', /^Trascrizione$/m.test(all) && /^Analisi$/m.test(all) && !all.includes('#'), all);
ok('grassetto e corsivo senza asterischi; accenti, «», trattino lungo e [?] interi', all.includes('Il katéchon trattiene: «non spezza il lógos», lo rinnova — così [?] dice') && !all.includes('*'), all);
ok('elenchi: punto e numeri davanti', /^• ?primo punto, con una parola \[illeggibile\]$/m.test(all) && /^1\. ?uno$/m.test(all) && /^2\. ?due$/m.test(all), all);
ok('caratteri che il font non ha: freccia → «->», ≥ → «>=», ✓ → ok, emoji via, lettere senza il segno che manca, il resto «?»', all.includes('secondo punto -> conseguenza >= 3 ok') && all.includes('regge. Capek, ?ódz, ?.'), all);
ok('citazione, codice e link scritti', all.includes('una citazione scritta a mano') && all.includes('codice') && all.includes('https://example.org/una/pagina/lunga'), all);
ok('in fondo: «PDF Penna · pagina 1 di 1»', all.trim().endsWith('PDF Penna · pagina 1 di 1'), all.slice(-80));

// testo lungo: più pagine, niente parole perse, niente righe fuori dal margine
const words = Array.from({ length: 2600 }, (_, i) => 'parola' + i);
const long = '## Trascrizione\n\n' + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => words.slice(k * 325, k * 325 + 325).join(' ')).join('\n\n') + '\n\n' + 'x'.repeat(400);
bytes = await buildTextPdf(long, { title: 'Lungo', meta: 'm' });
if (out) fs.writeFileSync(out + '/lungo.pdf', bytes);
t = await textOf(bytes);
const flat = t.pages.join(' ').replace(/\s+/g, ' ');
ok('testo lungo: più pagine', t.n >= 4, t.n);
ok('testo lungo: tutte le 2600 parole, in ordine', words.every((w) => flat.includes(w + ' ') || flat.includes(w)) && flat.indexOf('parola0 ') < flat.indexOf('parola2599'), words.filter((w) => !flat.includes(w)).slice(0, 5));
ok('ogni pagina dice «pagina N di M»', t.pages.every((p, i) => p.includes('PDF Penna · pagina ' + (i + 1) + ' di ' + t.n)));
ok('una parola più larga della riga si spezza (400 x)', (flat.match(/x{20,}/g) || []).join('').length === 400, (flat.match(/x{20,}/g) || []).map((s) => s.length));
{
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise; let bad = 0;
  for (let i = 1; i <= doc.numPages; i++) for (const it of (await (await doc.getPage(i)).getTextContent()).items) if (it.transform[4] < 55 || it.transform[4] + it.width > 595.28 - 55 || it.transform[5] < 30 || it.transform[5] > 841.89 - 56) bad++;
  ok('niente testo fuori dai margini', bad === 0, bad);
}
t = await textOf(await buildTextPdf('## Trascrizione\nPagina 1\nRiunione fornitori\n1) chiedere il prezzo\n\n> riga uno\n> riga due', {}));
ok('gli a capo dentro un capoverso restano: ogni riga scritta a mano è una riga', /^Pagina 1\nRiunione fornitori\n1\. ?chiedere il prezzo\nriga uno\nriga due$/m.test(t.pages[0]), t.pages[0]);
bytes = await buildTextPdf('', {});
ok('testo vuoto: un PDF di una pagina, senza errori', (await textOf(bytes)).n === 1);
ok('safeText: tab → spazi, caratteri di controllo strani → ?', (() => { const f = { encodeText: (c) => { if (!/^[\x20-\x7eàèéìòù]*$/.test(c)) throw new Error('no'); } }; return safeText(f, 'a\tb') === 'a  b' && safeText(f, '漢') === '?'; })());
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
