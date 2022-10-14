const clc = require('cli-color');

const { squire } = require('../../squire.js');
const { Cats, lazyAss } = squire('../../util.js');
const { indexOf } = require('./util.js');
const Rep = require('./rep.js');

/*

Quick prelude on parsing

Parsers are expected to have the signature
  r = parser(s, ...args)
with
  type(s) extending { text: string, i: int }

That is, they take some arguments and the current state s, and perform some
parsing, mutating the state s, and producing a result r.

If you want lookahead, pass in s._sm.clone(s).

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

const p_take =
exports.p_take =
function p_take(s, str) {
  if (!s.text.startsWith(str, s.i))
    throw mkError(s.text, [s.i, s.i + str.length], `Expected '${str}'`);
  s.i += str.length;
  return str;
}

const p_takeTo =
exports.p_takeTo =
function p_takeTo(s, str) {
  const i = s.text.indexOf(str, s.i);
  if (i === -1)
    throw mkError(s.text, s.i, `Expected '${str}' at some point ahead`);
  const r = s.text.slice(s.i, i);
  s.i = i;
  return r;
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
    throw mkError(s.text, xi0, "Expected word (ie, /[\w-]+/)");
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
  const sc = s._sm.clone(s);
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


// mkError(text, idx, msg)
// mkError(text, [i0, iF], msg)    range is inclusive/exclusive
const mkError =
exports.mkError =
function mkError(...args) {

  const err = new ParseError();

  lazyAss(err, 'message', () => mkErrorMsg(...args))
  // nb Compute lazily in case error is swallowed without
  // observing its message (eg when backtracking)

  return err;

}

function mkErrorMsg(text, loc, err) {

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

  return '\n' + result.toString();

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





// Parse block or inline
const p_enclosed =
exports.p_enclosed =
function p_enclosed(s, p_toplevel) {
  if (
      s.text.startsWith(':', s.i)
      || s.text.startsWith('==', s.i)
      || s.text.startsWith(';;', s.i)
  ) {
    const r = p_block(s, p_toplevel);
    return [r, 'block'];
  } else {
    const r = p_inline(s, p_toplevel);
    return [r, 'inline'];
  }
}

const p_block =
exports.p_block =
function p_block(s, p_toplevel) {

  const i0 = s.i;

  if (s.text[s.i] === ':') {
    s.i++;

    const eol = indexOf(s.text, '\n', s.i);

    // \cmd: <stuff>
    if (s.text.slice(s.i + 1, eol).trim() !== '') {
      if (s.text[s.i] === ' ') s.i++;
      const done = s => ['\n', undefined].includes(s.text[s.i]);
      const r = p_toplevel(s, done);
      s.i++;  // skip newline
      return r;

    // \cmd:\n <stuff>
    } else {
      s.i = eol + 1;

      const nnel = getNextNonemptyLine(s.text, s.i);
      const nnelIndent = nnel.length - nnel.trimLeft().length;
      const currentIndent = s.indents[s.indents.length - 1] || 0;
      if (nnelIndent <= currentIndent)
        throw mkError(s.text, s.i, "Expected indent after colon");

      s.indents.push(nnelIndent);
      const result = p_toplevel(s);
      s.indents.pop();
      return result;
    }
  }

  // \cmd <stuff> ==WORD==
  // Consumes to ==/WORD==
  else if (s.text.startsWith('==', s.i)) {
    p_take(s, '==');
    const sentinel = p_takeTo(s, '==');
    p_take(s, '==');
    p_spaces(s);
    p_take(s, '\n');

    const srec = { ...s._sm.clone(s), indents: [] };
    const done = s => s.text[s.i - 1] === '\n' && s.text.startsWith(`==/${sentinel}==`, s.i);
    const result = p_toplevel(srec, done);
    p_take(srec, `==/${sentinel}==`);
    Object.assign(s, { ...srec, indents: s.indents });
    return result;
  }

  // \cmd <stuff> ;;
  // Consumes to EOF
  else if (s.text.startsWith(';;', s.i)) {
    p_take(s, ';;');
    p_spaces(s);
    p_take(s, '\n');
    const done = s => s.i >= s.text.length;
    return p_toplevel(s, done);
  }

  else {
    throw mkError(s.text, s.i, 'Expected colon or double-equals');
  }

}

const p_inline =
exports.p_inline =
function p_inline(s, p_toplevel) {
  // \cmd[], cmd{}, etc

  const open = s.text[s.i];

  const pairs = {
    '(': ')',
    '[': ']',
    '<': '>',
    '{': '}',
  }
  const close = pairs[open];
  if (!close)
    throw mkError(s.text, s.i, "Expected group: [], (), {}, or <>");
  s.i++;

  const done = s => s.text.startsWith(close, s.i);
  const r = p_toplevel(s, done)
  p_take(s, close);

  return r;
}


// Top-level parser: verbatim
// Produces string
const p_toplevel_verbatim =
exports.p_toplevel_verbatim =
function p_toplevel_verbatim(s, done = (_ => false)) {
  return (
    p_toplevel_impl(s, { done, verbatim: true })
    .toHtml()  // TODO: naughty
  );
}

// Top-level parser: markup
// Produces a seq rep
const p_toplevel_markup =
exports.p_toplevel_markup =
function p_toplevel_markup(s, done = (_ => false)) {
  return p_toplevel_impl(s, { done, verbatim: false });
}

// Combination parser for both top-level parsers because
// they share indentation-related logic
const p_toplevel_impl =
exports.p_toplevel_impl =
function p_toplevel_impl(s, { done, verbatim }) {
  const parsers = (
    verbatim
      ? []
      : s.parsers
  );

  const result = new Rep.Seq();

  if (done(s)) return result;

  parsing:
  while (true) {

    // Check indentation
    // If indented block has ended, stop parsing
    // Else, skip indentation whitespace
    const [blockOver, advanceBy] = checkIndent(s);
    if (blockOver) break parsing;
    else s.i += advanceBy;

    // Try each parser
    for (const parser of parsers) {
      const i0 = s.i;
      result.add(parser(s));
      if (s.i !== i0)
        continue parsing;
    }

    // All parsers tried
    // Break out to caller
    if (done(s))
      break parsing;

    // Out of text but not yet done()
    if (s.i >= s.text.length)
      throw mkError(s.text, s.i, "Unexpected EOF!");

    // Default case: advance by one character
    result.add(s.text[s.i]);
    s.i++;
  }

  return result;
}

function checkIndent(s) {
  const isLeftmost = [undefined, '\n'].includes(s.text[s.i - 1]);
  if (!isLeftmost) return [false, 0];

  const nextNonemptyLine = getNextNonemptyLine(s.text, s.i);

  if (nextNonemptyLine === null)
    return [true, null];

  const expectedIndent = s.indents[s.indents.length - 1] || 0;
  const actualIndent = nextNonemptyLine.length - nextNonemptyLine.trimLeft().length;

  if (actualIndent < expectedIndent) {
    return [true, null];
  } else {
    const thisLine = s.text.slice(s.i, indexOf(s.text, '\n', s.i));
    const thisLineIndent = thisLine.length - thisLine.trimLeft().length;
    const advanceBy = Math.min(expectedIndent, thisLineIndent);
    return [false, advanceBy];
  }
}

// Returns *without* the newline
function getNextNonemptyLine(text, i0 = 0) {
  for (let sol = i0; sol < text.length; sol = indexOf(text, '\n', sol) + 1) {
    const eol = indexOf(text, '\n', sol);
    const line = text.slice(sol, eol);
    if (line.trim() !== '') {
      return line;
    }
  }
  return null;
}
