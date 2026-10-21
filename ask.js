// "Chiedi": domande sul testo del PDF al Mac Studio (bridge: Qwen gratis sul Mac, o Claude con l'abbonamento).
// Qui solo funzioni pure (facili da provare): indirizzo e token, testi delle richieste, scelta delle pagine,
// lettura dello streaming (SSE), markdown semplice, messaggi d'errore. L'interfaccia è in app.js.
import { fold, foldMap } from './find.js';

export const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/bifulcma/pdf-penna/main/studio-bridge/install.sh | bash';
export const SOURCES = {
  qwen: { label: 'Qwen', long: 'Studio · Qwen (gratis)', budget: 24000 },
  claude: { label: 'Claude', long: 'Studio · Claude (abbonamento)', budget: 60000 },
};
// Quanto testo del PDF mandare. Se il bridge dice quanto contesto ha Qwen (num_ctx, in token) e supera i 16k,
// si manda fino a ~3 caratteri per token, lasciando 16k token per istruzioni, domanda e risposta: un libro intero
// entra in 256k. Con un bridge che non lo dice resta il budget fisso.
export function docBudget(src, health) {
  const base = SOURCES[src].budget, n = health && health[src] && health[src].num_ctx;
  return src === 'qwen' && Number.isInteger(n) && n > 16384 ? Math.max(base, (n - 16000) * 3) : base;
}
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
// intestazione del commento salvato: si capisce subito da dove viene; col web, in fondo le ricerche e le fonti con gli URL
export function commentText(what, src, model, answer, { web = false, sources = [], queries = [] } = {}) {
  const a = what.action ? actionById(what.action) : null;
  const head = (a ? a.label : 'Domanda: ' + clipTo(String(what.question || '').trim(), 160)) + ' — ' + SOURCES[src].label + (src === 'claude' ? ' ' + modelLabel(src, model) : '') + (web ? ' · web' : '');
  return '✦ ' + head + '\n\n' + withSources(answer, sources, queries);
}
// risposta + "Ho cercato: …" + "Fonti:" numerate (per Salva come commento e Copia)
export function withSources(answer, sources = [], queries = []) {
  const s = String(answer).trim() + (queries.length ? '\n\nHo cercato: ' + queries.join('; ') : '');
  if (!sources.length) return s;
  return s + '\n\nFonti:\n' + sources.map((x, i) => (i + 1) + '. ' + (x.title && x.title !== x.url ? x.title + ' — ' : '') + x.url).join('\n');
}

// ---------- "Cerca sul web" ----------
// solo indirizzi http/https ben fatti (mai javascript:, data:, file:…), altrimenti null
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(s) || s.length > 2000) return null;
  try { const x = new URL(s); return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname ? x.href : null; } catch { return null; }
}
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const urlKey = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch { return u; } };
// un URL scritto nel testo finisce prima della punteggiatura ("…/pagina)." → "…/pagina"), ma tiene le parentesi sue: wiki/X_(Y)
export function trimUrl(u) {
  let s = u;
  for (;;) {
    const c = s[s.length - 1];
    if ('.,;:!?»"\'*]'.includes(c)) { s = s.slice(0, -1); continue; }
    if (c === ')' && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) { s = s.slice(0, -1); continue; }
    return s;
  }
}
// Ricerca intelligente (bridge 3): il Mac Studio sceglie le ricerche da questo contesto (richiesta, frase, titolo, testo intorno),
// mai dalle parole grezze della selezione. web_query qui sotto resta solo per i bridge vecchi (fase 8).
export function webCtx(ctx, what) {
  const a = what.action ? actionById(what.action) : null;
  const one = (s, n) => clipTo(String(s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), n);
  const out = { title: one(ctx.title, 300), question: one(a ? a[ctx.scope] : what.question, 2000), quote: '', near: '', page: ctx.page || 0 };
  if (ctx.scope === 'sel') { out.quote = one(ctx.quote, 4000); out.near = around(ctx.pageText, ctx.quote, 3000); }
  else if (ctx.scope === 'page') out.near = one(ctx.pageText, 4000);
  else out.near = one(ctx.docText, 4000);
  return out;
}
// il pezzo di pagina intorno alla frase selezionata (se la trova), se no l'inizio della pagina
export function around(text, quote, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(), qq = String(quote || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const i = qq ? t.indexOf(qq.slice(0, 60)) : -1;
  if (i < 0) return clipTo(t, n);
  const from = Math.max(0, Math.min(i - Math.floor((n - qq.length) / 2), t.length - n)), more = from + n < t.length;
  let s = t.slice(from, from + n);
  if (from) s = s.replace(/^\S*\s/, ''); // niente mezze parole ai bordi
  if (more) s = s.replace(/\s\S*$/, '');
  return (from ? '… ' : '') + s + (more ? ' …' : '');
}
// "Modifica ricerca": una ricerca per riga (o separate da «;»), al massimo 3, senza doppioni
export function parseQueries(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const s = raw.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').replace(/["“”«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200).trim();
    if (!s || seen.has(fold(s))) continue;
    seen.add(fold(s)); out.push(s);
    if (out.length === 3) break;
  }
  return out;
}
// "Ho cercato: a; b" a lavoro finito; "Ricerche: …" mentre cerca; "Ricerche previste: …" se Claude poi non ha cercato
export const queriesLabel = (list, mode = 'done') => ({ busy: 'Ricerche: ', planned: 'Ricerche previste: ' }[mode] || 'Ho cercato: ') + list.join('; ');
// cosa cercare per un bridge vecchio (fase 8): la domanda; se è corta, con l'argomento (frase selezionata o titolo).
export function webQuery(ctx, what) {
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') : s);
  const q = one(what.question), about = ctx.scope === 'sel' ? one(ctx.quote) : one(ctx.title);
  let out;
  if (q) out = q.split(' ').length < 6 && about ? q + ' — ' + cut(about, 160) : q;
  else out = ctx.scope === 'page' && !about ? cut(one(ctx.pageText), 300) : cut(about, 300);
  return cut(out, 380);
}
// "Sto cercando: «…»" / "Sto leggendo: sito.it" mentre lavora
export function searchLabel(d) {
  if (d && d.q) return 'Sto cercando: «' + clipTo(String(d.q), 120) + '»';
  if (d && d.url && hostOf(d.url)) return 'Sto leggendo: ' + hostOf(d.url);
  return 'Sto cercando sul web';
}
// Le fonti da mostrare sotto la risposta, nell'ordine in cui la risposta le cita:
// link markdown [titolo](url), URL scritti per intero e, per Qwen, i numeri [1] [2] delle fonti di Tavily.
// found = fonti mandate dal bridge [{ n?, title, url }]. Se la risposta non ne cita nessuna: le pagine consultate.
const CITE_RE = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)|\[(\d{1,2})\](?!\()|(https?:\/\/[^\s<>"«»]+)/g;
export function collectSources(answer, found = [], numbered = false) {
  const known = new Map(), list = [], seen = new Set();
  for (const f of found) { const u = safeUrl(f && f.url); if (u && !known.has(urlKey(u))) known.set(urlKey(u), { url: u, title: String(f.title || '').trim() }); }
  const add = (url, title) => {
    const u = safeUrl(url); if (!u) return;
    const k = urlKey(u); if (seen.has(k)) return; seen.add(k);
    const f = known.get(k), t = (f && f.title) || String(title || '').trim();
    list.push({ url: f ? f.url : u, title: t && !/^https?:\/\//.test(t) ? clipTo(t, 160) : hostOf(u), host: hostOf(u) });
  };
  const s = String(answer || '');
  CITE_RE.lastIndex = 0;
  let m;
  while ((m = CITE_RE.exec(s))) {
    if (m[2]) add(m[2], m[1]);
    else if (m[3]) { if (numbered) { const f = found.find((x) => x && x.n === +m[3]); if (f) add(f.url, f.title); } }
    else add(trimUrl(m[4]));
  }
  if (list.length) return { list, cited: true };
  return { list: [...known.values()].slice(0, 8).map((f) => ({ url: f.url, title: f.title || hostOf(f.url), host: hostOf(f.url) })), cited: false };
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
// testo in linea: **grassetto**, *corsivo* / _corsivo_, `codice`, [link](https://…) e https://… scritti per intero
// → [{ t: 'b'|'i'|'code'|'text', s } | { t: 'a', s, href }]
// (niente "lookbehind" nelle espressioni: Safari prima di iOS 16.4 non le capisce e l'app intera non partirebbe)
export function mdInline(s) {
  const out = [], re = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|`([^`\n]+)`|(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\5(?![\w*])|\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)|(https?:\/\/[^\s<>"«»]+)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const start = m[6] !== undefined ? m.index + m[4].length : m.index; // il carattere prima del corsivo resta testo
    if (start > last) out.push({ t: 'text', s: s.slice(last, start) });
    last = m.index + m[0].length;
    if (m[2] !== undefined) out.push({ t: 'b', s: m[2] }); else if (m[3] !== undefined) out.push({ t: 'code', s: m[3] });
    else if (m[6] !== undefined) out.push({ t: 'i', s: m[6] });
    else if (m[8] !== undefined) out.push({ t: 'a', s: m[7].replace(/\*\*|__|`/g, ''), href: m[8] });
    else { const u = trimUrl(m[9]); out.push({ t: 'a', s: u, href: u }); last = m.index + u.length; re.lastIndex = last; } // la punteggiatura dopo resta testo
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
        if (r.t === 'a') { // link: solo http/https, si apre in una scheda nuova, senza dire alla pagina da dove arrivi
          const href = safeUrl(r.href);
          if (!href) { parent.append(r.s); continue; }
          const a = doc.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = r.s;
          parent.append(a); continue;
        }
        const e = doc.createElement(r.t === 'b' ? 'strong' : r.t === 'i' ? 'em' : 'code');
        if (r.t === 'b' || r.t === 'i') inl(e, r.s); else e.textContent = r.s;
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
