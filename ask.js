// "Chiedi": domande sul testo del PDF al Mac Studio (bridge: Qwen gratis sul Mac, o Claude con l'abbonamento).
// Qui solo funzioni pure (facili da provare): indirizzo e token, testi delle richieste, scelta delle pagine,
// lettura dello streaming (SSE), markdown semplice, messaggi d'errore. L'interfaccia è in app.js.
import { fold, foldMap } from './find.js';

export const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash';
export const SOURCES = {
  qwen: { label: 'Qwen', long: 'Studio · Qwen (gratis)', budget: 24000 },
  claude: { label: 'Claude', long: 'Studio · Claude (abbonamento)', budget: 60000 },
};
export const CLAUDE_MODELS = { sonnet: 'Sonnet (veloce)', opus: 'Opus (più accurato)', haiku: 'Haiku (rapidissimo)', fable: 'Fable' };
export const modelLabel = (src, m) => (src === 'claude' ? (CLAUDE_MODELS[m] || m || 'Sonnet').replace(/ \(.*\)$/, '') : m || 'modello predefinito');

// ---------- indirizzo del bridge e token ----------
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
// "https://studio.xxxx.ts.net" (anche con "#token=…" incollato tutto insieme) → { ok, url, token? } | { ok: false, error }
export function parseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Scrivi l’indirizzo del Mac Studio (lo trovi alla fine dell’installazione).' };
  let token = null;
  const m = /#(?:token|t)=([^&\s]+)/.exec(s);
  if (m) { token = decodeURIComponent(m[1]); s = s.slice(0, m.index); }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s; // "studio.xxxx.ts.net" senza https://
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'Indirizzo non valido: deve essere come https://nome.xxxx.ts.net' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.test(u.hostname))) {
    return { ok: false, error: 'L’indirizzo deve iniziare con https:// (Tailscale lo dà così: https://nome.xxxx.ts.net).' };
  }
  if (u.username || u.password) return { ok: false, error: 'Togli nome e password dall’indirizzo.' };
  if (u.search) return { ok: false, error: 'Togli la parte dopo il «?» dall’indirizzo.' };
  const url = (u.origin + u.pathname).replace(/\/+$/, '');
  return token === null ? { ok: true, url } : { ok: true, url, token };
}
export function checkToken(raw) {
  const t = String(raw || '').trim();
  if (!t) return { ok: false, error: 'Incolla il token (la riga «Token» alla fine dell’installazione).' };
  if (!/^[A-Za-z0-9_\-.~+/=]{16,200}$/.test(t)) return { ok: false, error: 'Il token sembra incompleto: ricopialo tutto, senza spazi.' };
  return { ok: true, token: t };
}

// ---------- lettura dello streaming SSE (event: nome / data: json, righe vuote tra un evento e l'altro) ----------
export function sseReader(onEvent) {
  let buf = '', raw = '';
  return (chunk) => {
    raw += chunk;
    const cut = raw.endsWith('\r') ? raw.length - 1 : raw.length; // "\r" in fondo: forse arriva il suo "\n" col pezzo dopo
    buf += raw.slice(0, cut).replace(/\r\n?/g, '\n'); raw = raw.slice(cut);
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let name = 'message'; const data = [];
      for (const ln of block.split('\n')) {
        if (!ln || ln[0] === ':') continue; // ":" = ping per tenere viva la linea
        const c = ln.indexOf(':'), k = c < 0 ? ln : ln.slice(0, c), v = c < 0 ? '' : ln.slice(c + 1).replace(/^ /, '');
        if (k === 'event') name = v; else if (k === 'data') data.push(v);
      }
      if (!data.length) continue;
      let d; try { d = JSON.parse(data.join('\n')); } catch { d = { t: data.join('\n') }; }
      onEvent(name, d);
    }
  };
}

// ---------- testi delle richieste ----------
export const SYSTEM = 'Sei l’assistente di lettura di PDF Penna. Rispondi sempre in italiano, in modo chiaro e conciso (di solito meno di 250 parole), '
  + 'con markdown semplice: paragrafi brevi, elenchi puntati, **grassetto** per i concetti chiave. Basati sul testo del documento che ti viene dato; '
  + 'se qualcosa non c’è nel testo dillo chiaramente e distingui ciò che è nel testo da ciò che aggiungi tu. Quando citi un passaggio indica la pagina.';
export const ACTIONS = [
  { id: 'explain', label: 'Spiega', sel: 'Spiega il testo selezionato in parole semplici: che cosa vuol dire e perché conta in questo punto.',
    page: 'Spiega in parole semplici il contenuto di questa pagina.', doc: 'Spiega in parole semplici di che cosa parlano questi passaggi del documento.' },
  { id: 'sum', label: 'Riassumi', sel: 'Riassumi il testo selezionato in pochi punti essenziali.',
    page: 'Riassumi questa pagina in pochi punti essenziali.', doc: 'Riassumi questi passaggi del documento in pochi punti essenziali.' },
  { id: 'tr', label: 'Traduci in italiano', sel: 'Traduci in italiano il testo selezionato, mantenendo senso e tono. Rispondi solo con la traduzione.',
    page: 'Traduci in italiano il testo di questa pagina, mantenendo senso e tono. Rispondi solo con la traduzione.',
    doc: 'Traduci in italiano questi passaggi, mantenendo senso e tono. Rispondi solo con la traduzione, pagina per pagina.' },
  { id: 'obj', label: 'Obiezioni', sel: 'Quali obiezioni, punti deboli o controargomentazioni si possono sollevare a questo passaggio? Elenca le principali, ciascuna con una riga di spiegazione.',
    page: 'Quali obiezioni, punti deboli o controargomentazioni si possono sollevare al contenuto di questa pagina? Elenca le principali, ciascuna con una riga di spiegazione.',
    doc: 'Quali obiezioni, punti deboli o controargomentazioni si possono sollevare a questi passaggi? Elenca le principali, ciascuna con una riga di spiegazione.' },
];
export const actionById = (id) => ACTIONS.find((a) => a.id === id) || null;
const fence = (t) => '"""\n' + String(t).replace(/"""/g, '«»') + '\n"""';
const clipTo = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + ' […]' : t);

// ctx: { title, scope: 'sel'|'page'|'doc', quote?, page (numero), pageText?, docText?, docNote? }
// what: { action } oppure { question }
export function buildMessage(ctx, what) {
  const out = ['Documento: «' + (ctx.title || 'senza titolo') + '»'];
  if (ctx.scope === 'sel') {
    out.push('', 'Testo selezionato (pagina ' + ctx.page + '):', fence(ctx.quote));
    if (ctx.pageText && ctx.pageText.trim()) out.push('', 'Per contesto, il testo della pagina ' + ctx.page + ':', fence(clipTo(ctx.pageText, 6000)));
  } else if (ctx.scope === 'page') {
    out.push('', 'Testo della pagina ' + ctx.page + ':', fence(ctx.pageText || ''));
  } else {
    out.push('', ctx.docNote || 'Passaggi del documento:', fence(ctx.docText || ''));
  }
  const a = what.action ? actionById(what.action) : null;
  out.push('', a ? a[ctx.scope] : 'Domanda: ' + String(what.question || '').trim() + '\nRispondi basandoti sul testo; se la risposta non c’è, dillo.');
  return out.join('\n');
}
// intestazione del commento salvato: si capisce subito da dove viene
export function commentText(what, src, model, answer) {
  const a = what.action ? actionById(what.action) : null;
  const head = (a ? a.label : 'Domanda: ' + clipTo(String(what.question || '').trim(), 160)) + ' — ' + SOURCES[src].label + (src === 'claude' ? ' ' + modelLabel(src, model) : '');
  return '✦ ' + head + '\n\n' + String(answer).trim();
}

// ---------- "Domanda sul PDF": solo i passaggi che servono, entro un budget di caratteri ----------
const STOP = new Set(('il lo la i gli le un uno una di a da in con su per tra fra e ed o od ma se che chi cui cosa come dove quando perche quale quali quanto quanta quanti quante '
  + 'del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi '
  + 'non si mi ti ci vi ne lui lei loro noi voi io tu suo sua suoi sue mio mia tuo tua questo questa questi queste quello quella quelli quelle anche piu meno molto poco '
  + 'e sono sia era erano essere ha hanno ho hai avere fa fanno dice dicono detto parla parlano spiega spiegami dimmi puoi potresti vorrei sai '
  + 'pdf documento documenti testo libro capitolo pagina pagine autore secondo riguardo cosa ce c ci sono qual '
  + 'the of and to in is are was what how why who which does do about this that with for on from').split(' '));
// parole importanti della domanda, accorciate (radice) per trovare anche plurali e varianti: "contratti" → "contrat"
export function keywords(q) {
  const out = [];
  for (const w of fold(q).split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d{1,2}$/.test(w)) continue;
    const stem = w.length >= 6 ? w.slice(0, -2) : w.length >= 4 ? w.slice(0, -1) : w;
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}
const count = (s, k, max = 8) => { let n = 0; for (let i = s.indexOf(k); i >= 0 && n < max; i = s.indexOf(k, i + k.length)) n++; return n; };
// pages: [{ n: numero pagina (da 1), text }]. Ritorna { pages: [numeri inclusi], text, chars, total, all, hits, note }
export function pickPages(pages, question, { budget = 24000, perPage = 8000, current = 0 } = {}) {
  const usable = pages.filter((p) => p.text && p.text.trim());
  const total = pages.length;
  const clip = (t) => clipTo(t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), perPage);
  const texts = new Map(usable.map((p) => [p.n, clip(p.text)]));
  const size = (n) => texts.get(n).length + 14;
  const fmt = (list) => list.slice().sort((a, b) => a - b).map((n) => '[Pagina ' + n + ']\n' + texts.get(n)).join('\n\n');
  const allChars = usable.reduce((s, p) => s + size(p.n), 0);
  if (!usable.length) return { pages: [], text: '', chars: 0, total, all: false, hits: 0, note: '' };
  if (allChars <= budget) {
    const list = usable.map((p) => p.n);
    return { pages: list, text: fmt(list), chars: allChars, total, all: true, hits: 0, note: 'Testo del documento (tutte le ' + list.length + ' pagine con testo):' };
  }
  const keys = keywords(question);
  const folded = new Map(usable.map((p) => [p.n, foldMap(p.text).s]));
  const df = keys.map((k) => usable.filter((p) => folded.get(p.n).includes(k)).length);
  const scored = usable.map((p) => {
    let s = 0, distinct = 0;
    keys.forEach((k, i) => { const c = count(folded.get(p.n), k); if (c) { distinct++; s += Math.log(1 + usable.length / df[i]) * (1 + Math.log(c)); } });
    return { n: p.n, s: s * (1 + 0.5 * (distinct - 1)) + (s && p.n === current ? 0.01 : 0) };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.n - b.n);
  const picked = [], has = new Set(texts.keys());
  let chars = 0;
  const add = (n) => { if (!has.has(n) || picked.includes(n)) return true; const z = size(n); if (chars + z > budget) return false; picked.push(n); chars += z; return true; };
  if (scored.length) {
    for (const { n } of scored) { if (!add(n) && picked.length) break; add(n - 1); add(n + 1); } // la pagina trovata e le sue vicine
  } else {
    for (const n of [current, current - 1, current + 1]) add(n); // nessuna parola trovata: pagina corrente, poi dall'inizio
    for (const p of usable) if (!add(p.n)) break;
  }
  const note = 'Passaggi del documento (pagine ' + picked.slice().sort((a, b) => a - b).join(', ') + ' su ' + total + (scored.length ? '; scelte perché contengono le parole della domanda, con le pagine vicine' : '; nessuna parola della domanda trovata nel testo') + '):';
  return { pages: picked.slice().sort((a, b) => a - b), text: fmt(picked), chars, total, all: false, hits: scored.length, note };
}
// "3 pagine su 300 (149, 150, 151)" / "pagine 1–12 su 300"
export function pagesLabel(list, total) {
  if (!list.length) return 'nessuna pagina';
  const s = list.slice().sort((a, b) => a - b), runs = [];
  for (const n of s) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
  const txt = runs.map(([a, b]) => (a === b ? String(a) : a + '–' + b)).join(', ');
  return (s.length === 1 ? '1 pagina' : s.length + ' pagine') + ' su ' + total + ' (' + (s.length === 1 ? 'pagina ' : '') + txt + ')';
}

// ---------- markdown semplice → blocchi (niente HTML dal modello: si costruisce il DOM a mano) ----------
// blocchi: { t: 'h', level, text } | { t: 'p', text } | { t: 'ul'|'ol', items: [text] } | { t: 'quote', text } | { t: 'code', text } | { t: 'hr' }
export function mdBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let para = null, list = null, quote = null, code = null;
  const end = () => { para = null; list = null; quote = null; };
  for (const ln of lines) {
    if (code) { if (/^\s*```/.test(ln)) { code = null; } else code.text += (code.text ? '\n' : '') + ln; continue; }
    if (/^\s*```/.test(ln)) { end(); code = { t: 'code', text: '' }; out.push(code); continue; }
    if (!ln.trim()) { end(); continue; }
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln))) { end(); out.push({ t: 'h', level: m[1].length, text: m[2] }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(ln)) { end(); out.push({ t: 'hr' }); continue; }
    if ((m = /^\s*([-*+•])\s+(.*)$/.exec(ln)) || (m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(ln))) {
      const t = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.t !== t) { para = null; quote = null; list = { t, items: [] }; if (t === 'ol') list.start = +m[1]; out.push(list); }
      list.items.push(m[2]); continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(ln))) { if (!quote) { para = null; list = null; quote = { t: 'quote', text: m[1] }; out.push(quote); } else quote.text += '\n' + m[1]; continue; }
    if (list && /^\s{2,}\S/.test(ln)) { list.items[list.items.length - 1] += ' ' + ln.trim(); continue; }
    if (!para) { list = null; quote = null; para = { t: 'p', text: ln.trim() }; out.push(para); } else para.text += '\n' + ln.trim();
  }
  return out;
}
// testo in linea: **grassetto**, *corsivo* / _corsivo_, `codice` → [{ t: 'b'|'i'|'code'|'text', s }]
// (niente "lookbehind" nelle espressioni: Safari prima di iOS 16.4 non le capisce e l'app intera non partirebbe)
export function mdInline(s) {
  const out = [], re = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|`([^`\n]+)`|(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\5(?![\w*])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const start = m[6] !== undefined ? m.index + m[4].length : m.index; // il carattere prima del corsivo resta testo
    if (start > last) out.push({ t: 'text', s: s.slice(last, start) });
    if (m[2] !== undefined) out.push({ t: 'b', s: m[2] }); else if (m[3] !== undefined) out.push({ t: 'code', s: m[3] }); else out.push({ t: 'i', s: m[6] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}
export function renderMd(md, doc = document) {
  const frag = doc.createDocumentFragment();
  const inl = (parent, s) => {
    String(s).split('\n').forEach((line, i) => {
      if (i) parent.append(doc.createElement('br'));
      for (const r of mdInline(line)) {
        if (r.t === 'text') { parent.append(r.s); continue; }
        const e = doc.createElement(r.t === 'b' ? 'strong' : r.t === 'i' ? 'em' : 'code');
        if (r.t === 'b') inl(e, r.s); else e.textContent = r.s;
        parent.append(e);
      }
    });
  };
  for (const b of mdBlocks(md)) {
    let e;
    if (b.t === 'h') { e = doc.createElement('h' + Math.min(6, b.level + 2)); inl(e, b.text); }
    else if (b.t === 'p') { e = doc.createElement('p'); inl(e, b.text); }
    else if (b.t === 'quote') { e = doc.createElement('blockquote'); inl(e, b.text); }
    else if (b.t === 'code') { e = doc.createElement('pre'); e.textContent = b.text; }
    else if (b.t === 'hr') e = doc.createElement('hr');
    else { e = doc.createElement(b.t); if (b.t === 'ol' && b.start > 1) e.start = b.start; for (const it of b.items) { const li = doc.createElement('li'); inl(li, it); e.append(li); } }
    frag.append(e);
  }
  return frag;
}

// ---------- errori in parole semplici ----------
export const MSG_DOWN = 'Lo Studio non risponde: è acceso? Tailscale è attivo sull’iPad?';
export function errorText(status, body) {
  const said = body && typeof body.error === 'string' ? body.error : '';
  if (status === 401) return 'Il token non è giusto: ricontrollalo in Impostazioni › Assistente (lo trovi alla fine dell’installazione).';
  if (status === 403) return 'Il Mac Studio non accetta richieste da questa pagina (origine non permessa).';
  if (status === 404) return 'All’indirizzo indicato non c’è il bridge: ricontrolla l’indirizzo in Impostazioni › Assistente.';
  if (status === 502 || status === 504) return MSG_DOWN;
  return said || 'Il Mac Studio ha risposto con un errore (' + status + ').';
}
