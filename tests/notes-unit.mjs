// Test delle funzioni pure di notes.js: Barra (da cancellare) e Modifica (da sostituire), Markdown per Claude, ordine del libro,
// dati vecchi (evidenziazioni e commenti di prima: Markdown identico alla versione precedente). Uso: node tests/notes-unit.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as N from '../notes.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && (!cond || process.env.V) ? '  — ' + JSON.stringify(extra) : '')); };
const date = new Date(2026, 9, 29);

// notes.js com'era prima di Barra e Modifica (ultimo commit che non le conosce): serve per confrontare i dati vecchi
let OLD = null;
try {
  const rev = execFileSync('git', ['log', '--format=%H', '-S', 'withFix', '--', 'notes.js'], { cwd: new URL('..', import.meta.url).pathname }).toString().trim().split('\n').pop();
  const src = execFileSync('git', ['show', (rev ? rev + '~1' : 'HEAD') + ':notes.js'], { cwd: new URL('..', import.meta.url).pathname }).toString();
  if (!src.includes('withFix')) { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-old-')), 'notes.mjs'); fs.writeFileSync(f, src); OLD = await import(f); }
} catch {}

// ---------- dati vecchi: niente cambia ----------
const oldAnns = [
  { page: 1, q: 'La libertà è il dono più grande' },
  { page: 1, q: 'la città possa crescere', n: 'Verificare con l’avvocato: è davvero così?' },
  { page: 3, q: 'Riga 3: il contratto\nprevede', n: '  Controllare il termine  ' },
];
const mdOld = N.toMarkdown('reale', oldAnns, { date });
ok('dati vecchi: Markdown come prima (titolo, riga di intestazione, pagine, citazioni, commenti)', mdOld === '# reale\n\n_Evidenziazioni e commenti da PDF Penna · 29 ottobre 2026 · 3 voci_\n\n## Pagina 1\n> "La libertà è il dono più grande"\n\n> "la città possa crescere"\n\n**Commento:** Verificare con l’avvocato: è davvero così?\n\n## Pagina 3\n> "Riga 3: il contratto prevede"\n\n**Commento:** Controllare il termine\n', mdOld);
ok('dati vecchi: nessuna riga di istruzioni per Claude', !mdOld.includes('CANCELLA') && !mdOld.includes('Istruzioni'));
if (OLD) {
  ok('dati vecchi: Markdown identico byte per byte a quello della versione precedente di notes.js', mdOld === OLD.toMarkdown('reale', oldAnns, { date }));
  const one = { page: 2, q: 'Riga 3: il contratto prevede', n: 'Controllare il termine di 30 giorni' };
  ok('dati vecchi: «Copia con commento» identico alla versione precedente', N.entryMarkdown('reale', one) === OLD.entryMarkdown('reale', one) && N.entryMarkdown('reale', one) === '# reale\n\n## Pagina 2\n> "Riga 3: il contratto prevede"\n\n**Commento:** Controllare il termine di 30 giorni\n');
} else console.log('     (versione precedente di notes.js non trovata in git: confronto byte per byte saltato)');
ok('dati vecchi: tipo giusto (evidenziazione / commento)', N.annKind({ q: 'x' }) === 'hl' && N.annKind({ q: 'x', n: 'nota' }) === 'note' && !N.isFix({ q: 'x', n: 'nota' }) && !N.isFix({ q: 'x' }));
ok('tipo sconosciuto (versione futura) trattato come evidenziazione, non come correzione', !N.isFix({ q: 'x', k: 'boh' }) && N.annKind({ q: 'x', k: 'boh' }) === 'hl');

// ---------- Barra / Modifica ----------
const base = { id: 'a1', q: 'il prezzo entro trenta giorni', c: '#f5c400', a: 0.35, r: [{ l: 0.1, t: 0.2, w: 0.3, h: 0.02 }], t: 1, u: 1 };
const del = N.withFix(base, '');
ok('Barra: k=del, rosso, niente testo nuovo, stessi riquadri e citazione', del.k === 'del' && del.c === N.STRIKE && !('s' in del) && del.q === base.q && JSON.stringify(del.r) === JSON.stringify(base.r) && del.id === 'a1');
ok('Barra: l’annotazione di partenza non viene toccata', base.c === '#f5c400' && !('k' in base));
const sub = N.withFix(base, '  il prezzo entro sessanta giorni ');
ok('Modifica: k=sub con il testo nuovo (spazi tolti)', sub.k === 'sub' && sub.s === 'il prezzo entro sessanta giorni' && sub.c === N.STRIKE);
ok('Modifica → Barra: il testo nuovo sparisce', (() => { const v = N.withFix(sub, ''); return v.k === 'del' && !('s' in v); })());
ok('Barra → Modifica', (() => { const v = N.withFix(del, 'nuovo'); return v.k === 'sub' && v.s === 'nuovo'; })());
ok('Modifica di un commento: il commento non resta appeso', !('n' in N.withFix({ ...base, n: 'vecchia nota' }, 'x')));
ok('etichette chiare', N.KIND_LABEL[N.annKind(del)] === 'Da cancellare' && N.KIND_LABEL[N.annKind(sub)] === 'Da sostituire' && N.isFix(del) && N.isFix(sub));
ok('testo uguale (a capo e spazi a parte) = niente da correggere', N.sameText('il prezzo\n entro  trenta giorni', 'il prezzo entro trenta giorni') && !N.sameText('il prezzo entro 30 giorni', 'il prezzo entro trenta giorni'));

// ---------- Markdown per Claude ----------
const e = (page, a) => ({ page, q: a.q, n: a.n, k: a.k, s: a.s });
const mix = [
  e(12, { q: 'Introduzione' }),
  e(12, { q: 'testo da togliere', k: 'del' }),
  e(12, { q: 'parola sbagliata', k: 'sub', s: 'parola giusta' }),
  e(12, { q: 'frase con nota', n: 'da rivedere' }),
  e(13, { q: 'riga 1\nriga 2', k: 'sub', s: 'prima riga\nseconda riga' }),
  e(14, { q: 'ultima', k: 'del' }),
];
const md = N.toMarkdown('Libro', mix, { date });
ok('righe CANCELLA e SOSTITUISCI come nel brief', md.includes('\n- p. 12 · **CANCELLA:** «testo da togliere»\n') && md.includes('\n- p. 12 · **SOSTITUISCI** «parola sbagliata» → «parola giusta»\n'), md);
ok('in testa: la riga che spiega CANCELLA e SOSTITUISCI', md.split('\n')[4] === N.FIX_HELP && /CANCELLA/.test(N.FIX_HELP) && /SOSTITUISCI/.test(N.FIX_HELP) && /sorgente/.test(N.FIX_HELP), md.split('\n').slice(0, 6));
ok('intestazione: «Evidenziazioni, commenti e correzioni» e numero di voci', md.split('\n')[2] === '_Evidenziazioni, commenti e correzioni da PDF Penna · 29 ottobre 2026 · 6 voci_');
ok('a capo dentro citazione e testo nuovo → spazi (una riga per istruzione)', md.includes('- p. 13 · **SOSTITUISCI** «riga 1 riga 2» → «prima riga seconda riga»\n'));
const order = ['Introduzione', 'testo da togliere', 'parola sbagliata', 'frase con nota', 'riga 1 riga 2', 'ultima'].map((t) => md.indexOf(t));
ok('ordine del libro: le voci escono nell’ordine in cui arrivano (pagina per pagina)', order.every((x, i) => x > 0 && (!i || x > order[i - 1])), order);
ok('evidenziazioni e commenti accanto alle correzioni restano come prima', md.includes('## Pagina 12\n> "Introduzione"\n\n- p. 12 · **CANCELLA:**') && md.includes('→ «parola giusta»\n\n> "frase con nota"\n\n**Commento:** da rivedere\n'), md);
ok('correzioni vicine: un elenco unico (senza riga vuota in mezzo)', md.includes('«testo da togliere»\n- p. 12 · **SOSTITUISCI**'));
ok('una sezione per pagina anche con sole correzioni', md.includes('## Pagina 13\n- p. 13') && md.endsWith('## Pagina 14\n- p. 14 · **CANCELLA:** «ultima»\n'), md.slice(-80));
const single = N.entryMarkdown('Libro', e(5, { q: 'vecchio', k: 'sub', s: 'nuovo' }));
ok('copia di una correzione sola: titolo, istruzioni, pagina, riga SOSTITUISCI (senza intestazione con la data)', single === '# Libro\n\n' + N.FIX_HELP + '\n\n## Pagina 5\n- p. 5 · **SOSTITUISCI** «vecchio» → «nuovo»\n', single);
ok('solo correzioni: 1 voce', N.toMarkdown('L', [e(1, { q: 'x', k: 'del' })], { date }).includes('· 1 voce_'));

// ---------- ordine sulla pagina (sortAnns) con tipi mescolati ----------
const r = (t, l) => [{ l, t, w: 0.1, h: 0.02 }];
const page = [{ id: 'c', r: r(0.5, 0.1), k: 'del' }, { id: 'a', r: r(0.1, 0.5) }, { id: 'b', r: r(0.1, 0.6), k: 'sub', s: 'x' }, { id: 'd', r: r(0.8, 0.1), n: 'nota' }];
ok('sulla pagina: dall’alto in basso, poi da sinistra, qualunque sia il tipo', N.sortAnns(page).map((x) => x.id).join('') === 'abcd');
ok('riquadri vuoti (dati rovinati) non rompono l’ordine', N.sortAnns([{ id: 'z', r: [] }, { id: 'y', r: r(0.1, 0.1) }]).map((x) => x.id).join('') === 'zy');

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
