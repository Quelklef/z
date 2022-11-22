const clc = require('cli-color');

const { squire, closureStr } = require('../../squire.js');
const { lazyAss } = require('../../util.js');
const util = require('./util.js');
const { indexOf } = util;
const repm = require('./repm.js');

/*

Parser module


Parsing intro
-------------

Parsing is a little funky. We keep track of three kinds of state:

(WANT -- slight rewrite. just call quasistate 'env' or 'aff' lol)

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
  { text     :: String          // Source text [local]
  , i        :: Int             // File pointer [nonlocal]
  , cursyms  :: Map String Int  // Gensym state [nonlocal]
  , indents  :: Array Int       // Indent stack [nonlocal]
  , keepNewline :: Bool  // [local]
  , sentinel :: State -> Bool   // Sentinel [local]
                                // Gives a "stop parsing here" condition

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


/*

nb. The indentation-aware parsing is tricky to get right. Have to balance at least all of the following
    use-cases:

* Line
  \f: x

* Block
  \f:
    x

* Block within block
  \f:
    \g:
      x

* Block within line
  \f: \g: \h:
    x

* Newline-within-inline

  \something-json [{
    "i": "am",
    "multiline": "json"
  }]

  (this means we can't just disallow \n in inline)

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

  // Source text
  s.text = text;

  s.sentinel = s => s.i >= s.text.length;

  // Indentation stuff
  s.indents = [];
  s.keepNewline = false;

  s.counterCoord = { depth: 0, index: 0 };

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

  s.quasi.modules = modules;

  return s;

}

// toplevel run
const p_run =
exports.p_run =
function p_run(s) {
  const rep = p_toplevel_markup(s);

  let prelude = '';
  for (const module of s.quasi.modules)
    prelude += (module.prelude ?? '');

  return { prelude, rep };
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
  let word = '';
  while (/[\w-]/.test(s.text[s.i])) {
    word += s.text[s.i];
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
  let digs = '';
  while (/[0-9]/.test(s.text[s.i])) {
    digs += s.text[s.i];
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
      const r = local(s, s => {
        s.keepNewline = true;  // Prevent inner '\cmd: <stuff>' syntax from consuming
                               // the newline; within several such nested forms like
                               //   \a: \b: \c: def
                               // we want only the outermost to consume the newline.
                               // This feels hacky, but whatever.
        s.sentinel = s => ['\n', undefined].includes(s.text[s.i]);
        return p_toplevel(s);
      });

      if (!s.keepNewline)
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

      return local(s, s => {
        s.indents.push(nnelIndent);
        return p_toplevel(s);
      });
    }
  }

  // \cmd <stuff> ==WORD==
  // Consumes to ==/WORD==
  else if (s.text.startsWith('==', s.i)) {
    p_take(s, '==');
    const marker = p_takeTo(s, '==');
    p_take(s, '==');
    p_spaces(s);
    p_take(s, '\n');

    return local(s, s => {
      s.sentinel = s => isStartOfLine(s) && s.text.startsWith(`==/${marker}==`, s.i);
      // s.sentinel = s => s.text[s.i - 1] === '\n' && s.text.startsWith(`==/${marker}==\n`, s.i);
      const result = p_toplevel(s);
      p_take(s, `==/${marker}==`);

      // Consume optional spaces+newline
      p_backtracking(s, s => {
        p_spaces(s);
        p_take(s, '\n');
      });

      return result;
    });
  }

  // \cmd <stuff> ;;
  // Consumes to EOF
  else if (s.text.startsWith(';;', s.i)) {
    p_take(s, ';;');
    p_spaces(s);
    p_take(s, '\n');
    return local(s, s => {
      s.sentinel = s => s.i >= s.text.length;
      return p_toplevel(s);
    });
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

  const r = local(s, s => {
    s.sentinel = s => s.text.startsWith(close, s.i);
    return p_toplevel(s);
  });
  p_take(s, close);

  return r;
}


// Top-level parser: verbatim
// Produces string
const p_toplevel_verbatim =
exports.p_toplevel_verbatim =
function p_toplevel_verbatim(s) {
  return (
    p_toplevel_impl(s, [])
    .toHtml()  // TODO: naughty
  );
}

// Top-level parser: markup
// Produces a seq rep
const p_toplevel_markup =
exports.p_toplevel_markup =
function p_toplevel_markup(s) {
  return p_toplevel_impl(s, s.parsers);
}

// Combination parser for both top-level parsers because
// they share indentation-related logic
const p_toplevel_impl =
exports.p_toplevel_impl =
function p_toplevel_impl(s, parsers) {
  const result = new repm.Seq();

  if (s.sentinel(s)) return result;

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
    if (s.sentinel(s))
      break parsing;

    // Out of text but not yet done according to the sentinel
    if (s.i >= s.text.length)
      throw mkError(s.text, s.i, "Unexpected EOF!");

    // Default case: advance by one character
    result.add(s.text[s.i]);
    s.i++;
  }

  return result;
}

// Returns [blockOver, advanceBy]
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

// Escape
baseModule.parsers.push(p_escape);
function p_escape(s) {
  if (s.text[s.i] !== '~') return '';
  s.i++;
  const c = s.text[s.i] ?? '<easter egg discovered>';
  s.i++;
  return c;
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
// WANT: make parameter optional
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

const p_jsExpr =
exports.p_jsExpr =
function p_jsExpr(s) {
  const [expr, _] = p_enclosed(s, p_toplevel_verbatim);
  s.quasi.env.env.log.info('JS Expr:', expr);
  return eval('(' + expr + ')');
}


// Dropdowns
baseModule.commands.ddn =
baseModule.commands.dropdown =
function(s) {
  p_spaces(s);
  const [line, _] = p_enclosed(s, p_toplevel_markup);
  p_spaces(s);
  const body = p_block(s, p_toplevel_markup);
  return new Indented({ indent: 2, body: new Dropdown({ line, body, id: gensym(s, 'dropdown') }) });
}


const isStartOfLine =
exports.isStartOfLine =
function isStartOfLine(s) {
  const curIndent = s.indents[s.indents.length - 1] || 0;
  return (
    [undefined, '\n'].includes(s.text[s.i - curIndent - 1])
    && s.text.slice(s.i - curIndent - 1, s.i).trim() === ''
  );
}


// Lists and indented blocks
baseModule.parsers.push(p_indent);
function p_indent(s) {
  const curIndent = s.indents[s.indents.length - 1] || 0;
  if (!isStartOfLine(s)) return '';

  // Calculate line column
  let i = s.i;
  while (s.text[i] === ' ') i++;
  let dIndent = i - s.i;
    // "dIndent" is "delta indent" ie "change in indent"

  s.i += dIndent;

  // Find bullet
  let style = null;
  {
    if (p_backtracking(s, s => p_take(s, '- ')))
      style = '-';
    else if (p_backtracking(s, s => p_take(s, '> ')))
      style = '>';
    else if (p_backtracking(s, s => p_take(s, '# ')))
      style = '#';
  }

  if (style)
    dIndent += 2;

  const eol = indexOf(s.text, '\n', s.i);
  const lineEmpty = s.text.slice(s.i, eol).trim() === '';
  if (dIndent <= 0 && !lineEmpty)
    s.counterCoord = { depth: s.counterCoord.depth, index: 0 };
        // ^ hmmm.. nontrivial use of local mutation

  // If line not further indented, bail
  if (dIndent <= 0)
    return '';

  const newIndent = curIndent + dIndent;

  if (style === '-') {
    let body = local(s, s => {
      s.indents.push(newIndent);
      s.counterCoord = { depth: 0, index: 0 };
      return p_toplevel_markup(s);
    });

    body = new Bulleted({ body, counterCoord: null });
    return new Indented({ indent: dIndent, body });
  }

  else if (style === '>') {
    const line = local(s, s => {
      s.sentinel = s => s.text.startsWith('\n', s.i);
      return p_toplevel_markup(s);
    });
    p_take(s, '\n');

    let body = local(s, s => {
      s.indents.push(newIndent);
      s.counterCoord = { depth: 0, index: 0 };
      return p_toplevel_markup(s);
    });

    body = new Dropdown({ line, body, id: gensym(s, 'dropdown') });
    return new Indented({ indent: dIndent, body });
  }

  else if (style === '#') {
    let body = local(s, s => {
      s.counterCoord = { depth: s.counterCoord.depth + 1, index: 0 };
      s.indents.push(newIndent);
      return p_toplevel_markup(s);
    });

    s.counterCoord = { depth: s.counterCoord.depth, index: s.counterCoord.index + 1 };
        // ^ hmmm.. nontrivial use of local mutation
    body = new Bulleted({ body, counterCoord: s.counterCoord });
    return new Indented({ indent: dIndent, body });
  }

  else {
    let body = local(s, s => {
      s.indents.push(newIndent);
      s.counterCoord = { depth: 0, index: 0 };
      return p_toplevel_markup(s);
    });
    return new Indented({ indent: dIndent, body });
  }
}

baseModule.prelude += String.raw`

<style>

.dropdown > .dropdown-line {
  display: list-item;
  list-style-type: disclosure-closed;
  cursor: pointer;
}
.dropdown > .dropdown-line:hover {
  background-color: rgba(var(--color-dynamic-rgb), .05);
}
.dropdown > .dropdown-line::marker {
  color: var(--color-dynamic);
}
.dropdown > .dropdown-body {
  border-top: 1px dashed rgba(var(--color-static-rgb), 0.3);
  margin-top: .5em;
  padding-top: .5em;
  margin-bottom: .5em;
  padding-bottom: .5em;
  position: relative;
}
.dropdown > .dropdown-body::before {
  content: '';
  display: inline-block;
  position: absolute;
  background-color: var(--color-dynamic);
  width: 1px;
  left: -1.5ch;  /* TODO: baked */
  top: 0;
  height: 100%;
}
.dropdown:not(.open) > .dropdown-body {
  display: none;
}
.dropdown.open > .dropdown-line {
  list-style-type: disclosure-open;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  const openDropdowns = new Set(urlSynchronizedState.openDropdowns || []);

  for (const $exp of document.querySelectorAll('.dropdown')) {
    const $line = $exp.querySelector('.dropdown-line');
    const $body = $exp.querySelector('.dropdown-body');

    let isDropdowned = openDropdowns.has($exp.id);;

    function rerender() {
      if (isDropdowned)
        $exp.classList.add('open');
      else
        $exp.classList.remove('open');
    }

    rerender();

    $line.addEventListener('click', () => {
      isDropdowned = !isDropdowned;
      rerender();

      if (isDropdowned)
        openDropdowns.add($exp.id);
      else
        openDropdowns.delete($exp.id);
      urlSynchronizedState.openDropdowns = [...openDropdowns];
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
    return `<div style="margin-left: ${this.indent}ch">` + this.body.toHtml(env) + '</div>';
  }

  children() {
    return [this.body];
  }

}


const Bulleted =
exports.Bulleted =
class Bulleted {

  constructor({ body, counterCoord }) {
    this.body = body;
    this.counterCoord = counterCoord;
  }

  toHtml(env) {
    // TODO: numbers are wrong (make counter inc by parent, I think?)

    const styles = [ 'decimal', 'lower-roman', 'lower-latin', ];
    const listStyle = (
      this.counterCoord
        ? styles[this.counterCoord.depth % styles.length]
        : 'disc'
    );
    return (
      `<div style="
          display: list-item;
          list-style-type: ${listStyle};
          counter-set: list-item ${this.counterCoord?.index ?? 0};
        "
        data-debug-counterCoord="${JSON.stringify(this.counterCoord).replace(/"/g,"'")}"
       >`
      + this.body.toHtml(env)
      + "</div>"
    );
  }

  children() {
    return [this.body];
  }

}

const Dropdown =
exports.Dropdown =
class Dropdown {

  constructor({ line, body, id }) {
    this.line = line;
    this.body = body;
    this.id = id;
  }

  toHtml(env) {
    return (
      `<div class="dropdown" id="${this.id}">`
      + '<div class="dropdown-line">'
      + this.line.toHtml(env)
      + '</div>'
      + '<div class="dropdown-body">'
      + this.body.toHtml(env)
      + '</div>'
      + '</div>'
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

  let result = '';
  result += '\n';
  result += strrepm(' ', lineNumberingWidth + 0) + '─────┬─────\n';
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
      result += '  ' + sigil + lineNo + clc(' │') + ' ' + wrp;
    });
  }
  result += strrepm(' ', lineNumberingWidth + 0) + '─────┼─────\n';
  for (const wrp of wrapText('Error: ' + err))
    result += strrepm(' ', lineNumberingWidth + 0) + '     │ ' + clc.yellow(wrp);
  result += strrepm(' ', lineNumberingWidth + 0) + '─────┴─────\n';

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




function sample_s(s, linec = 4) {
  return sample(s.text, s.i, linec);

  function sample(str, from = 0, linec = 5) {
    return ruled(str.toString().slice(from).split('\n').slice(0, linec).join('\n'));
  }

  function ruled(str, pref='>|') {
    const bar = '------';
    return [bar, ...str.toString().split('\n').map(l => pref + l.replace(/ /g, '⋅')), bar].join('\n');
  }
}
