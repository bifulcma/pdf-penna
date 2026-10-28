// Evidenziazioni e commenti sul testo del PDF: solo funzioni pure (facili da provare), usate da app.js.
// annotazione (nella pagina, campo anns): { id, q: testo citato, c: colore, a: opacità, r: [{l,t,w,h}] in frazioni della pagina mostrata,
//   n?: commento, k?: 'del' (Barra: da cancellare) | 'sub' (Modifica: da sostituire con s), s?: testo nuovo, t: creata, u: modificata }
// Barra e Modifica sono segni da correttore di bozze: il PDF non cambia, le istruzioni vanno a Claude col Markdown.
// Senza k è un'evidenziazione o un commento come prima (i dati vecchi restano uguali).

const r4 = (x) => Math.round(x * 10000) / 10000;

// pdf.js dà un riquadro per ogni pezzo di testo: unisco quelli della stessa riga (meno elementi, bordi puliti)
export function mergeRects(rects) {
  const list = rects.filter((r) => r.w > 0.0005 && r.h > 0.0005).map((r) => ({ ...r })).sort((a, b) => a.t - b.t || a.l - b.l);
  const lines = [];
  for (const r of list) {
    const mid = r.t + r.h / 2;
    const ln = lines.find((x) => mid > x.t && mid < x.t + x.h && Math.abs(x.h - r.h) < Math.max(x.h, r.h) * 0.6);
    if (ln) ln.items.push(r); else lines.push({ t: r.t, h: r.h, items: [r] });
  }
  const out = [];
  for (const ln of lines) {
    ln.items.sort((a, b) => a.l - b.l);
    let cur = null;
    for (const r of ln.items) {
      // stesso rigo e vicini (lo spazio tra due parole non spezza l'evidenziazione)
      if (cur && r.l <= cur.l + cur.w + Math.max(cur.h, r.h) * 0.8) {
        const right = Math.max(cur.l + cur.w, r.l + r.w), bottom = Math.max(cur.t + cur.h, r.t + r.h);
        cur.t = Math.min(cur.t, r.t); cur.w = right - cur.l; cur.h = bottom - cur.t;
      } else { cur = { ...r }; out.push(cur); }
    }
  }
  return out.map((r) => ({ l: r4(r.l), t: r4(r.t), w: r4(r.w), h: r4(r.h) }));
}

// testo selezionato -> citazione su una riga: le righe del PDF diventano spazi ("parola-" a fine riga resta attaccata)
export function cleanQuote(s) {
  return String(s).split('\n').map((x) => x.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean)
    .reduce((acc, ln) => (!acc ? ln : /-$/.test(acc) ? acc + ln : acc + ' ' + ln), '');
}

// ordine di lettura: pagina, poi dall'alto in basso, poi da sinistra
export function sortAnns(list) {
  return list.sort((a, b) => ((a.r[0] || {}).t || 0) - ((b.r[0] || {}).t || 0) || ((a.r[0] || {}).l || 0) - ((b.r[0] || {}).l || 0));
}

export const STRIKE = '#d93025'; // rosso dei segni da correttore (una versione vecchia dell'app li mostra come evidenziazione rossa)
export const isFix = (a) => !!a && (a.k === 'del' || a.k === 'sub');
export const annKind = (a) => (a.k === 'del' ? 'del' : a.k === 'sub' ? 'sub' : a.n ? 'note' : 'hl');
export const KIND_LABEL = { del: 'Da cancellare', sub: 'Da sostituire', note: 'Commento', hl: 'Evidenziazione' };
// Barra ↔ Modifica: stesso testo e stessi riquadri, cambia solo l'istruzione. Testo nuovo vuoto = da cancellare.
export function withFix(a, text) {
  const v = JSON.parse(JSON.stringify(a)), t = String(text ?? '').trim();
  if (t) { v.k = 'sub'; v.s = t; } else { v.k = 'del'; delete v.s; }
  v.c = STRIKE; delete v.n;
  return v;
}
// il testo nuovo è uguale al vecchio (spazi a parte): niente da correggere
export const sameText = (a, b) => cleanQuote(a) === cleanQuote(b);

const quoteLine = (q) => '> "' + String(q).replace(/\s*\n\s*/g, ' ') + '"';
const oneLine = (t) => String(t).replace(/\s*\n\s*/g, ' ').trim();
// istruzioni per Claude: una riga per correzione (la pagina c'è anche qui: la riga si capisce da sola)
const fixLine = (e) => e.k === 'del' ? '- p. ' + e.page + ' · **CANCELLA:** «' + oneLine(e.q) + '»'
  : '- p. ' + e.page + ' · **SOSTITUISCI** «' + oneLine(e.q) + '» → «' + oneLine(e.s || '') + '»';
export const FIX_HELP = '_Istruzioni per Claude: correggi la sorgente del testo. **CANCELLA** «…» = togli quel testo; **SOSTITUISCI** «vecchio» → «nuovo» = metti il nuovo al posto del vecchio. Le citazioni vengono dal PDF: a capo e trattini possono essere diversi._';
// una voce: citazione e, se c'è, il commento (o la correzione)
function entryMd(e) {
  if (isFix(e)) return fixLine(e);
  const out = [quoteLine(e.q)];
  if (e.n && e.n.trim()) out.push('', '**Commento:** ' + e.n.trim());
  return out.join('\n');
}
// entries: [{ page, q, n?, k?, s? }] già in ordine. Formato pensato per incollarlo in Claude Code.
// Senza correzioni il testo è identico a quello delle versioni prima di Barra e Modifica.
export function toMarkdown(title, entries, { header = true, date = new Date() } = {}) {
  const out = ['# ' + title], fixes = entries.some(isFix);
  if (header) out.push('', '_' + (fixes ? 'Evidenziazioni, commenti e correzioni' : 'Evidenziazioni e commenti') + ' da PDF Penna · ' + date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + entries.length + (entries.length === 1 ? ' voce' : ' voci') + '_');
  if (fixes) out.push('', FIX_HELP);
  let last = null, prev = null;
  for (const e of entries) {
    if (e.page !== last) { out.push('', '## Pagina ' + e.page); last = e.page; }
    else if (!(isFix(e) && isFix(prev))) out.push(''); // correzioni una sotto l'altra, come un elenco
    out.push(entryMd(e));
    prev = e;
  }
  return out.join('\n') + '\n';
}
// "Copia con commento" / "Copia" di una singola voce: stesso formato, senza la riga di intestazione
export const entryMarkdown = (title, e) => toMarkdown(title, [e], { header: false });
