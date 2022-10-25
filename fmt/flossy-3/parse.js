const clc = require('cli-color');

const { squire } = require('../../squire.js');
const { Cats, lazyAss } = squire('../../util.js');
const util = require('./util.js');
const { indexOf } = util;
const repm = require('./repm.js');

/*

Parser module


Parsing intro
-------------

Parsing is a little funky. We keep track of three kinds of state:

1 Nonlocal state
  This is state shared between all parts of the parser
  Here we keep track of things like the file pointer
  Think StateT

2 Local state
  This is state whose modifications are restricted to local-only
  Here we keep track of things like the indentation stack
  Think ReaderT

3 Quasi state
  This is not 'really' state, because parsers are expected to
    not modify it at all
  The reason it's treated as state is that it is still *computed*;
    namely, it is computed from imported modules
  Here we keep track of things like how to clone the mutable state
  Think compile-time parameter


Conceptually a parser is a function with signature

  r = parser(ns, ls, qs, ...args)

where

  ns is the nonlocal state
  ls is the local state
  qs is the quasi state

and the parser

  may modify the mutable or immutable state, but not the quasi-state
  may throw ParseError to signal failure

For convenience, we wrap up the states into one value

  s = { ...ns, ...ls, quasi: qs }

and pass that around instead


Module knowledge
----------------

In terms of abstraction, this module is mid-level, knowing certain
specific features of the target grammar but certainly not all, and
providing affordances for generic parser extension.

This is what the module knows:

type State =

  // Base state //
  { text    :: String          // Source text [local]
  , i       :: Int             // File pointer [nonlocal]
  , indents :: Array Int       // Indent stack [nonlocal]
  , cursyms :: Map String Int  // Gensym state [nonlocal]

  // Extensibility-related state //
  , parsers  :: Array (Parser repm)       // Parser list [local]
  , commands :: Map String (Parser repm)  // Command list [local]

  // Quasi-state //
  , quasi :: Quasi  // Quasi-state [quasi]

  , ...
  }

type Quasi =
  { nonlocalStateKeys :: Array String
  , ...
  }

type Module =
  { parsers           [optional] :: Array (Parser repm)
  , commands          [optional] :: Map String (Parser repm)
  , nonlocalStateKeys [optional] :: Array String
  , prelude           [optional] :: String
  }

*/


// Mutatively initialized thru the rest of the js module
const baseModule = {
  commands: {},
  parsers: [],
  prelude: '',
};


const initState =
exports.initState =
function initState({
  text,     // Parser text
  modules,  // :: Array Module
  quasi,    // Initial quasi-state
}) {

  modules = [baseModule, ...modules];

  // Initialize parser state
  const s = {};


  // NONLOCAL STATE //

  // Index in text
  s.i = 0;

  // Symbol generation
  s.cursyms = {};


  // LOCAL STATE //

  // Indentation stack
  s.indents = [];

  // Source text
  s.text = text;

  // Parsers
  s.parsers = [];
  for (const module of Object.values(modules))
    s.parsers = [...s.parsers, ...(module.parsers ?? [])];

  // Commands mapping
  s.commands = {};
  for (const module of Object.values(modules))
    Object.assign(s.commands, module.commands ?? {});

  // Module state initialization
  for (const module of Object.values(modules))
    Object.assign(s, module.stateInit ?? {});


  // QUASI STATE //

  s.quasi = quasi;

  // Tracks which keys are part of the mutable state
  s.quasi.nonlocalStateKeys = [ 'i', 'cursyms' ];
  for (const module of Object.values(modules))
    s.quasi.nonlocalStateKeys.push(...(module.nonlocalStateKeys ?? []));

  return s;

}

// Generate a fresh symbol under a given namespace
// WANT: rename to p_gensym?
const gensym =
exports.gensym = function(s, namespace = '') {
  if (!(namespace in s.cursyms)) s.cursyms[namespace] = 0;
  const sym = s.cursyms[namespace]++
  return 'gensym-' + (namespace ? (namespace + '-') : '') + sym;
};

// Clone the parser state
// This implementation makes sense only because we mandate that
// the quasi-state not be modified during parsing
// WANT: rename to p_clone?
const clone =
exports.clone = function(s) {
  const sm = s.quasi;
  s.quasi = null;
  const r = util.clone(s);
  r.quasi = s.quasi = sm;
  return r;
};

// Parse with a local state modification
// WANT: rename to p_scope
const local =
exports.local = function(s, inner) {
  const sc = clone(s);
  const res = inner(sc);
  for (const key of s.quasi.nonlocalStateKeys)
    s[key] = sc[key];
  return res;
};


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

// WANT: rename to p_try
const p_backtracking =
exports.p_backtracking =
function p_backtracking(s, parser) {
  const sc = clone(s);
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

    return local(s, s => {
      const done = s => s.text[s.i - 1] === '\n' && s.text.startsWith(`==/${sentinel}==\n`, s.i);
      const result = p_toplevel(s, done);
      p_take(s, `==/${sentinel}==\n`);
      return result;
    });
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

  const result = new repm.Seq();

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


// Execute a backslash command
baseModule.parsers.push(p_command);
function p_command(s) {
  const xi0 = s.i;
  if (s.text[s.i] !== '\\') return '';
  s.i++;

  p_spaces(s);

  const name = p_word(s);

  const command = s.commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}


// Local evaluator modification
baseModule.commands.scope =
function(s) {
  p_spaces(s);
  const json = p_jsExpr(s);
  p_spaces(s);

  return local(s, s => {
    if ('inferReferences' in json)
      s.doImplicitReferences = !!json['inferReferences'];
    const [r, _] = p_enclosed(s, p_toplevel_markup);
    return r;
  });
}


// Dropdowns
baseModule.commands.ddn =
baseModule.commands.dropdown =
function(s) {
  p_spaces(s);
  const [line, _] = p_enclosed(s, p_toplevel_markup);
  p_spaces(s);
  const body = p_block(s, p_toplevel_markup);
  return new Indented({ indent: 2, body: new Expand({ line, body, id: s.gensym('expand') }) });
}


// Lists and indented blocks
baseModule.parsers.push(p_indent);
function p_indent(s) {
  const curIndent = s.indents[s.indents.length - 1] || 0;
  const isStartOfLine = (
    [undefined, '\n'].includes(s.text[s.i - curIndent - 1])
    && s.text.slice(s.i - curIndent - 1, s.i).trim() === ''
  )
  if (!isStartOfLine) return '';

  // Calculate line column
  let i = s.i;
  while (s.text[i] === ' ') i++;
  let dIndent = i - s.i;

  s.i += dIndent;

  // Find bullet
  let style = null;
  {
    if (p_backtracking(s, s => p_take(s, '- '))) {
      style = '-';
    }
    else if (p_backtracking(s, s => p_take(s, '> '))) {
      style = '>';
    }
    else if (p_backtracking(s, s => p_take(s, '# '))) {
      style = '#';
    }
  }

  if (style)
    dIndent += 2;

  // If line not further indented, bail
  if (dIndent <= 0)
    return '';

  const newIndent = curIndent + dIndent;

  if (style === '>') {

    const line = p_toplevel_markup(s, s => s.text.startsWith('\n', s.i));
    p_take(s, '\n');

    s.indents.push(newIndent);
    const body = p_toplevel_markup(s);
    s.indents.pop();

    return new Indented({
      indent: dIndent,
      body: new Expand({ line, body, id: gensym(s, 'expand') }),
    });

  } else {

    s.indents.push(newIndent);
    body = p_toplevel_markup(s);
    s.indents.pop();
    if (style)
      body = new Bulleted({
        body,
        isNumbered: style === '#',
      });
    return new Indented({ indent: dIndent, body });

  }
}

baseModule.prelude += String.raw`

<style>

.expand > .expand-line {
  display: list-item;
  list-style-type: disclosure-closed;
  cursor: pointer;
}
.expand > .expand-line:hover {
  background-color: rgba(var(--color-dynamic-rgb), .05);
}
.expand > .expand-line::marker {
  color: var(--color-dynamic);
}
.expand > .expand-body {
  border-top: 1px dashed rgba(var(--color-static-rgb), 0.3);
  margin-top: .5em;
  padding-top: .5em;
  margin-bottom: .5em;
  padding-bottom: .5em;
  position: relative;
}
.expand > .expand-body::before {
  content: '';
  display: inline-block;
  position: absolute;
  background-color: var(--color-dynamic);
  width: 1px;
  left: -1.5ch;  /* TODO: baked */
  top: 0;
  height: 100%;
}
.expand:not(.open) > .expand-body {
  display: none;
}
.expand.open > .expand-line {
  list-style-type: disclosure-open;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  const openExpands = new Set(urlSynchronizedState.openExpands || []);

  for (const $exp of document.querySelectorAll('.expand')) {
    const $line = $exp.querySelector('.expand-line');
    const $body = $exp.querySelector('.expand-body');

    let isExpanded = openExpands.has($exp.id);;

    function rerender() {
      if (isExpanded)
        $exp.classList.add('open');
      else
        $exp.classList.remove('open');
    }

    rerender();

    $line.addEventListener('click', () => {
      isExpanded = !isExpanded;
      rerender();

      if (isExpanded)
        openExpands.add($exp.id);
      else
        openExpands.delete($exp.id);
      urlSynchronizedState.openExpands = [...openExpands];
      syncToUrl();
    });
  }

});

</script>

`;

const Indented =
exports.Indented =
class Indented {

  constructor({ indent, body }) {
    this.indent = indent;
    this.body = body;
  }

  toHtml(env) {
    return new Cats(`<div style="margin-left: ${this.indent}ch">`, this.body.toHtml(env), '</div>');
  }

  children() {
    return [this.body];
  }

}


const Bulleted =
exports.Bulleted =
class Bulleted {

  constructor({ body, isNumbered, id }) {
    this.body = body;
    this.isNumbered = isNumbered;
  }

  toHtml(env) {
    // TODO: numbers are wrong (make counter inc by parent, I think?)
    return new Cats(
      `<div style="display: list-item; list-style-type: ${this.isNumbered ? 'decimal' : 'disc'}">`,
      this.body.toHtml(env),
      "</div>",
    );
  }

  children() {
    return [this.body];
  }

}

const Expand =
exports.Expand =
class Expand {

  constructor({ line, body, id }) {
    this.line = line;
    this.body = body;
    this.id = id;
  }

  toHtml(env) {
    return new Cats(
      `<div class="expand" id="${this.id}">`,
      '<div class="expand-line">',
      this.line.toHtml(env),
      '</div>',
      '<div class="expand-body">',
      this.body.toHtml(env),
      '</div>',
      '</div>',
    );
  }

  children() {
    return [this.body, this.line];
  }

}



const ParseError =
exports.ParseError =
class ParseError extends Error { }


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
  result.add(strrepm(' ', lineNumberingWidth + 0) + '─────┬─────\n');
  for (let y = y0A; y <= yfA; y++) {
    const line = textLines[y];
    const lineNumber = clc.green((y + 1 + '').padStart(lineNumberingWidth));
    const lineNumberBlank = strrepm(' ', lineNumberingWidth);
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
  result.add(strrepm(' ', lineNumberingWidth + 0) + '─────┼─────\n');
  for (const wrp of wrapText('Error: ' + err))
    result.add(strrepm(' ', lineNumberingWidth + 0) + '     │ ' + clc.yellow(wrp));
  result.add(strrepm(' ', lineNumberingWidth + 0) + '─────┴─────\n');

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

  function strrepm(s, n) {
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
