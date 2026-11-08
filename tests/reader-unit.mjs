// Test delle funzioni pure di reader.js (righe, riquadro del testo, margini da tagliare, paragrafi). Uso: node tests/reader-unit.mjs
import * as R from '../reader.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== '' && !cond ? '  — ' + JSON.stringify(extra) : '')); };
const it = (str, x, y, fs = 11, w = str.length * fs * 0.5, eol = false) => ({ str, transform: [fs, 0, 0, fs, x, y], width: w, height: fs, hasEOL: eol });
// pagina A4 (595×842): margini 70 / 60, corpo 11, interlinea 16, titolo 18
const items = [it('Capitolo primo', 70, 780, 18, 150, true),
  it('Il contratto prevede che la parte acquirente versi il prezzo entro trenta', 70, 740, 11, 465, true),
  it('giorni dalla consegna della merce, salvo un lun-', 70, 724, 11, 465, true),
  it('ghissimo accordo scritto.', 70, 708, 11, 140, true),
  it('Secondo paragrafo con rientro della prima riga che va avanti fino', 88, 692, 11, 447, true),
  it('al margine destro della pagina.', 70, 676, 11, 180, true),
  it('Terzo', 70, 640, 11, 30), it(' ', 100, 640, 11, 3), it('paragrafo dopo uno spazio più grande.', 103, 640, 11, 200, true),
  it('12', 290, 40, 9, 10, true), it('nota ruotata', 20, 400, 9, 50)];
items[items.length - 1].transform = [0, 9, -9, 0, 20, 400];
const ls = R.lines(items);
ok('righe: 8 (la scritta ruotata è ignorata)', ls.length === 8, ls.map((l) => l.str));
ok('righe: pezzi della stessa riga uniti con lo spazio', ls[6].str === 'Terzo paragrafo dopo uno spazio più grande.', ls[6].str);
ok('corpo del testo = 11', R.bodySize(ls) === 11, R.bodySize(ls));
const box = R.textBox(ls, [0, 0, 595, 842]);
ok('riquadro del testo ≈ 70…535 su 595', box && Math.abs(box[0] - 70 / 595) < 0.01 && Math.abs(box[1] - 535 / 595) < 0.01, box);
const crop = R.cropOf([box, [0.13, 0.92]]);
ok('margini: unione delle pagine pari/dispari + filo di margine', crop && crop.l < box[0] && crop.l > 0.08 && crop.r > 0.92 && crop.r < 0.96, crop);
ok('margini: niente taglio se il testo occupa già quasi tutto il foglio', R.cropOf([[0.02, 0.98]]) === null);
ok('margini: niente taglio se non c’è testo', R.cropOf([null, null]) === null && R.textBox([], [0, 0, 595, 842]) === null);
const ps = R.paragraphs(ls);
ok('paragrafi: titolo + 3 paragrafi + numero di pagina', ps.length === 5, ps.map((p) => p.text));
ok('paragrafi: il titolo è riconosciuto', ps[0].heading && ps[0].text === 'Capitolo primo' && !ps[1].heading);
ok('paragrafi: a capo col trattino riunito («lunghissimo»)', /salvo un lunghissimo accordo scritto\.$/.test(ps[1].text), ps[1].text);
ok('paragrafi: il rientro della prima riga apre un paragrafo nuovo', /^Secondo paragrafo .* della pagina\.$/.test(ps[2].text), ps[2].text);
ok('paragrafi: lo spazio più grande apre un paragrafo nuovo', ps[3].text.startsWith('Terzo'), ps[3].text);
const lb = R.lineBox(ls[1]);
ok('riquadro di una riga: dalla linea di base un po’ sotto e sopra', lb[0] === 70 && lb[1] < 740 && lb[3] > 740 && lb[3] - lb[1] > 10 && lb[3] - lb[1] < 13, lb);
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
