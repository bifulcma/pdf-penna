// Evidenziazioni e commenti sul testo del PDF: solo funzioni pure (facili da provare), usate da app.js.
// annotazione (nella pagina, campo anns): { id, q: testo citato, c: colore, a: opacità, r: [{l,t,w,h}] in frazioni della pagina mostrata,
//   n?: commento, t: creata, u: modificata }

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

const quoteLine = (q) => '> "' + String(q).replace(/\s*\n\s*/g, ' ') + '"';
// una voce: citazione e, se c'è, il commento
function entryMd(e) {
  const out = [quoteLine(e.q)];
  if (e.n && e.n.trim()) out.push('', '**Commento:** ' + e.n.trim());
  return out.join('\n');
}
// entries: [{ page, q, n }] già in ordine. Formato pensato per incollarlo in Claude Code.
export function toMarkdown(title, entries, { header = true, date = new Date() } = {}) {
  const out = ['# ' + title];
  if (header) out.push('', '_Evidenziazioni e commenti da PDF Penna · ' + date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + entries.length + (entries.length === 1 ? ' voce' : ' voci') + '_');
  let last = null;
  for (const e of entries) {
    if (e.page !== last) { out.push('', '## Pagina ' + e.page); last = e.page; } else out.push('');
    out.push(entryMd(e));
  }
  return out.join('\n') + '\n';
}
// "Copia con commento" / "Copia" di una singola voce: stesso formato, senza la riga di intestazione
export const entryMarkdown = (title, e) => toMarkdown(title, [e], { header: false });
