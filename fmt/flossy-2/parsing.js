const clc = require('cli-color');

const { squire } = require('../../squire.js');
const { Cats } = squire('../../util.js');
const { indexOf } = require('./util.js');

/*

Quick prelude on parsing

Parsers are expected to have the signature
  r = parser(s, ...args)
with
  type(s) extending { text: string, i: int }

That is, they take some arguments and the current state s, and perform some
parsing, mutating the state s, and producing a result r.

If you want lookahead, pass in s.clone().

Parsers fail by throwing ParseError.

*/

const ParseError =
exports.ParseError =
class ParseError extends Error { }

const p_spaces =
exports.p_spaces =
function p_spaces(s) {
  while (s.text[s.i] === ' ') s.i++;
}

const p_whitespace =
exports.p_whitespace =
function p_whitespace(s) {
  while (/\s/.test(s.text[s.i])) s.i++;
}

const p_consume =
exports.p_consume =
function p_consume(s, str) {
  if (!s.text.startsWith(str, s.i))
    throw mkError(s.text, [s.i, s.i + str.length], `Expected '${str}'`);
  s.i += str.length;
  return str;
}

const p_word =
exports.p_word =
function p_word(s) {
  const xi0 = s.i;
  let word = new Cats();
  while (/[\w-]/.test(s.text[s.i])) {
    word.add(s.text[s.i]);
    s.i++;
  }
  word = word.toString();
  if (!word)
    throw mkError(s.text, xi0, "Expected word");
  return word;
}

const p_integer =
exports.p_integer =
function p_integer(s) {
  const xi0 = s.i;
  let digs = new Cats();
  while (/[0-9]/.test(s.text[s.i])) {
    digs.add(s.text[s.i]);
    s.i++;
  }
  digs = digs.toString();
  if (!digs)
    throw mkError(s.text, [xi0, s.i], "Expected number");
  return parseInt(digs, 10);
}

const p_backtracking =
exports.p_backtracking =
function p_backtracking(s, parser) {
  const sc = s.clone();
  let result;
  try {
    result = parser(sc);
  } catch (e) {
    if (e instanceof ParseError)
      return null;
    else
      throw e;
  }
  Object.assign(s, sc);
  return result;
}


// mkError(text, idx, err)
// mkError(text, [i0, iF], err)    range is [inc, exc]
const mkError =
exports. mkError =
function mkError(text, loc, err) {

  // TODO: p_backtracking will cause creation and then disposal
  //       of errors, so calculating the error message will be a waste.
  //       Benchmark to see if it's worth to calculate lazily.

  const linesAround = 2;
  const wrapWidth = 85;
  const textLines = text.split('\n').map(ln => ln + '\n');
  const textLineC = textLines.length - 1;

  let y0, x0, yf, xf;
  {
    const range = typeof loc === 'number' ? [loc, loc + 1] : loc;
    const [i0, iF] = range;
    [y0, x0] = toCoords(i0);
    [yf, xf] = toCoords(iF);
    yf++;  // end-exclusive range
  }

  const y0A = Math.max(y0 - linesAround, 0);
  const yfA = Math.min(yf + linesAround, textLineC);

  const lineNumberingWidth = ('' + yfA).length;

  const result = new Cats();
  result.add('\n')
  result.add(strRep(' ', lineNumberingWidth + 0) + '─────┬─────\n');
  for (let y = y0A; y <= yfA; y++) {
    const line = textLines[y];
    const lineNumber = clc.green((y + 1 + '').padStart(lineNumberingWidth));
    const lineNumberBlank = strRep(' ', lineNumberingWidth);
    const sigil = y0 <= y && y < yf ? clc.yellow('▶ ') : '  ';

    // Highlight range for this line
    let hlI0, hlIF;
    if (y0 <= y && y < yf) {
      hlI0 = y === y0 ? x0 : 0;
      hlIF = y === yf - 1 ? xf : wrapWidth;
    } else {
      hlI0 = line.length;
      hlIF = line.length;
    }

    const noNewline = line.slice(0, line.length - 1);
    const wrapped = wrapText(noNewline);
    wrapText(noNewline).forEach((wrp, wrpI) => {
      const wrpI0 = wrpI * wrapWidth;
      const [wrpHlI0, wrpHlIF] = [Math.max(0, hlI0 - wrpI0), Math.max(0, hlIF - wrpI0)];
      wrp = wrp.slice(0, wrpHlI0) + clc.bgYellow.black(wrp.slice(wrpHlI0, wrpHlIF)) + wrp.slice(wrpHlIF);

      const lineNo = wrpI === 0 ? lineNumber : lineNumberBlank;
      result.add('  ' + sigil + lineNo + clc(' │') + ' ' + wrp);
    });
  }
  result.add(strRep(' ', lineNumberingWidth + 0) + '─────┼─────\n');
  for (const wrp of wrapText('Error: ' + err))
    result.add(strRep(' ', lineNumberingWidth + 0) + '     │ ' + clc.yellow(wrp));
  result.add(strRep(' ', lineNumberingWidth + 0) + '─────┴─────\n');

  return new ParseError('\n' + result.toString());

  function toCoords(idx) {
    idx = Math.min(Math.max(idx, 0), text.length - 1);
    let sol = 0, y = 0;
    while (true) {
      const eol = indexOf(text, '\n', sol);
      if (eol >= idx) {
        const x = idx - sol;
        return [y, x];
      }
      y++;
      sol = eol + 1;
    }
  }

  function strRep(s, n) {
    let result = '';
    for (let i = 0; i < n; i++)
      result += s;
    return result;
  }

  function wrapText(s) {
    const result = [];
    for (const ln of s.split('\n'))
      for (let i = 0; i * wrapWidth < ln.length; i++)
        result.push(ln.slice(i * wrapWidth, (i + 1) * wrapWidth) + '\n');
    if (result.length === 0)
      result.push('\n');
    return result;
  }

}
