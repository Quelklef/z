const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { lazyAss, Cats, withTempDir, hash } = require('../../util.js');
const fss = require('../../fss.js');

const Rep = require('./rep.js');
const { Trie, indexOf, impossible, cloneIterator } = require('./util.js');
const { p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = require('./parsing.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();

function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  const note = {};

  note.source = source;
  note.source += '\n';  // allows parsers to assume lines end with \n

  note.hash = hash(floc, source, scriptSrc);

  note.id = noteId;

  // note[t] holds transient (non-cached) data
  const t = Symbol('fmt-proper.t');
  Object.defineProperty(note, t, { enumerable: false, value: {} });


  lazyAss(note[t], 'phase1', () => {
    env.parent.log.info('parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: false,
    });
  });

  lazyAss(note, 'starred', () => {
    return note[t].phase1.meta?.starred === true;
  });

  lazyAss(note, 'defines', () => {
    const rep = note[t].phase1.rep;
    const defines = new Set();
    rep.traverse(node => {
      if (node instanceof Rep.Jargon) {
        for (const form of node.forms) {
          defines.add(form);
        }
      }
    });
    return defines;
  });

  lazyAss(note[t], 'phase2', () => {
    env.parent.log.info('parsing (again)', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
    });
  });

  lazyAss(note, 'references', () => {
    const rep = note[t].phase2.rep;
    const references = new Set();
    rep.traverse(node => {
      if (node instanceof Rep.Implicit) {
        references.add(node.toNote.id);
      } else if (node instanceof Rep.Explicit) {
        if (!!node.toNote)
          references.add(node.toNote.id);
      }
    });
    return references;
  });

  lazyAss(note, 'html', () => {
    const rep = note[t].phase2.rep;
    env.parent.log.info('rendering', note.id);
    return rep.toHtml(env);
  });

  return note;
}


function parse({ text, note, graph, env, doImplicitReferences }) {

  // Initial parser state
  let s = {

    // Environmental references
    graph, note, env,

    // Note metadata (initialized below)
    meta: null,

    // Source text
    text,

    // Index in text
    i: 0,

    // Indentation stack
    indents: [],

    doImplicitReferences,
    jargonMatcher: doImplicitReferences && new JargonMatcherJargonMatcher(graph.jargonSet, note.defines),

    // Symbol generation
    cursyms: {},
    gensym(namespace = '') {
      if (!(namespace in this.cursyms)) this.cursyms[namespace] = 0;
      return 'gensym-' + (namespace ? (namespace + '-') : '') + (this.cursyms[namespace]++);
    },

    // Extra parsers
    extraParsers: [],

    // annotation-related state
    annotNameQueue: [],
    annotNameStack: (function * () { for (let i = 1;; i++) yield ('' + i); })(),

    // tex-related state
    katexPrefix: new Cats(),
    texPrefix: new Cats(),

    clone() {
      const c = { ...this };
      c.indents = [...c.indents];
      c.extraParsers = [...c.extraParsers];
      c.annotNameQueue = [...c.annotNameQueue];
      c.annotNameStack = cloneIterator(c.annotNameStack);
      c.katexPrefix = c.katexPrefix.clone();
      c.texPrefix = c.texPrefix.clone();
      return c;
    },

  };

  // Parse format header, metadata, and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  const meta = p_noteMetadata(s);
  if (meta) s.env.log.info('metadata is', meta);
  if (s.text[s.i] === '\n') s.i++;

  const rep = new Rep.Seq();

  const done = s => s.i >= s.text.length;
  rep.add(p_toplevel_markup(s, done));

  return { rep: template(rep), meta };

}


function p_noteMetadata(s) {
  const prefix = 'meta:';

  if (!s.text.startsWith(prefix, s.i))
    return null;

  s.i += prefix.length;
  p_spaces(s);

  const expr = p_dhallExpr(s, { takeToEol: true });
  return evalDhall(expr, s.env);
}

// Scan a single Dhall expression
// Because Dhall uses whitespace to juxtapose, it's not possible to
// know whan an expression has ended.
// If your expressions are being cut off, wrap them in parens.
function p_dhallExpr(s, { takeToEol }) {

  let delims = [];

  const i0 = s.i;

  parsing:
  while (true) {

    if (s.i >= s.text.length)
      break parsing;

    const topDelim = delims[delims.length - 1]
    switch (topDelim) {

      // Expression
      case undefined:
      case '${':
      case '(':
      case '[':
      case '{':
      {

        const pairs = {
          "''": null,
          '"': null,
          "{-": null,
          "(": ")",
          "[": "]",
          "{": "}",
        };

        for (const [opener, closer] of Object.entries(pairs)) {
          if (s.text.startsWith(opener, s.i)) {
            s.i += opener.length;
            delims.push(opener);
            continue parsing;
          }
          if (closer && s.text.startsWith(closer, s.i)) {
            if (pairs[topDelim] !== closer)
              throw mkError(s.text, [i0, s.i], `Unpaired '${closer}'`);
            s.i += closer.length;
            delims.pop();
            continue parsing;
          }
        }

        s.i++;

      }
      break;

      // String
      case '"':
      case "''":
      {
        if (s.text.startsWith('\\', s.i)) {
          s.i += 2;
        }
        else if (s.text.startsWith(topDelim, s.i)) {
          s.i += topDelim.length;
          delims.pop();
        }
        else if (s.text.startsWith('${', s.i)) {
          s.i += 2;
          delims.push('${');
        }
        else {
          s.i++;
        }
      }
      break;

      // Line comment
      case '--':
      {
        if (s.text.startsWith('\n', s.i))
          delims.pop();
        s.i++;
      }
      break;

      // Block comment
      case '{-':
      {
        if (s.text.startsWith('{-', s.i)) {
          s.i += 2;
          delims.push('{-');
        }
        else if (s.text.startsWith('-}', s.i)) {
          s.i += 2;
          delims.pop();
        }
        else {
          s.i++;
        }
      }
      break;

      default:
        impossible(topDelim);

    }

    if (delims.length === 0)
      break parsing;

  }

  if (takeToEol)
    s.i = indexOf(s.text, '\n', s.i);

  return s.text.slice(i0, s.i);

}

function evalDhall(expr, env) {
  return env.cache.at('note-parts', ['dhall', expr], () => {
    return fss.withTempDir(tmp => {

      env.log.info(`Evaluating Dhall [${expr.length}]`);

      fss.write(plib.resolve(tmp, 'it.dhall'), expr);

      const cmd = String.raw`
        cd ${tmp} \
        && dhall-to-json --file it.dhall --compact
      `;

      let result;
      try {
        result = child_process.execSync(cmd).toString();
      } catch (err) {
        env.log.error(err.stderr.toString());  // meh
        throw 'Dhall eval failed; see above!';  // TODO
      }

      result = JSON.parse(result);
      env.log.info(`Evaluating Dhall [done] [${expr.length}]`);
      return result;

    });
  });
}


// Top-level parser: verbatim
// Produces string
function p_toplevel_verbatim(s, done = (_ => false)) {
  return (
    p_toplevel_impl(s, { done, verbatim: true })
    .toHtml()  // TODO: naughty
  );
}

// Top-level parser: markup
// Produces a seq rep
function p_toplevel_markup(s, done = (_ => false)) {
  return p_toplevel_impl(s, { done, verbatim: false });
}

// Combination parser for both top-level parsers because
// they share indentation-related logic
function p_toplevel_impl(s, { done, verbatim }) {
  const parsers = (
    verbatim
      ? []
      : [
          p_sigils,
          p_quotes,
          p_katex,
          p_indent,
          p_command,
          ...s.extraParsers,
          p_implicitReference,
          p_escapes,
        ]
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


const sigilMapping = {
  '---\n': '<hr />',
  '***\n': '<hr />',

  '<->': '&harr;',
  '->': '&rarr;',
  '<-': '&larr;',
  '<=>': '&hArr;',
  '=>': '&rArr;',
  '<=': '&lArr;',
  '<-->': '&xharr;',
  '-->': '&xrarr;',
  '<--': '&xlarr;',
  '<==>': '&xhArr;',
  '==>': '&xrArr;',
  '<==': '&xlArr;',

  '--': '&mdash;',

  '{sec}': '§',
  '{para}': '¶',
};

const sigilTrie = new Trie(Object.keys(sigilMapping));

// Sigils: static replacements
function p_sigils(s) {
  const sigil = sigilTrie.longestPrefixOf(s.text, s.i);
  if (!sigil) return '';
  s.i += sigil.length;
  return sigilMapping[sigil];
}


const htmlEscapes = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
};

function p_escapes(s) {
  const c = s.text[s.i];
  if (c in htmlEscapes) {
    s.i++;
    return htmlEscapes[c];
  } else {
    return '';
  }
}

function escapeHtml(s) {
  return [...s].map(c => htmlEscapes[c] || c).join('');
}


// Fancy quote marks
function p_quotes(s) {
  if (!`'"`.includes(s.text[s.i])) return '';

  const isletter = c => !!(c || '').match(/[a-zA-Z]/);
  const quot = s.text[s.i];
  const before = isletter(s.text[s.i - 1]);
  const after = isletter(s.text[s.i + 1]);

  const mapping = {
    [`true ' true`]: `’`,
    [`true " true`]: `”`,
    [`true ' false`]: `’`,
    [`true " false`]: `”`,
    [`false ' true`]: `‘`,
    [`false " true`]: `“`,
    [`false ' false`]: `'`,
    [`false " false`]: `"`,
  };

  const fancy = mapping[before + ' ' + quot + ' ' + after];
  s.i++;
  return fancy;
}


// Lists and indented blocks
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

    return new Rep.Indented({
      indent: dIndent,
      body: new Rep.Expand({ line, body, id: s.gensym('expand') }),
    });

  } else {

    s.indents.push(newIndent);
    body = p_toplevel_markup(s);
    s.indents.pop();
    if (style)
      body = new Rep.Bulleted({
        body,
        isNumbered: style === '#',
      });
    return new Rep.Indented({ indent: dIndent, body });

  }
}


function p_katex(s) {
  if (s.text[s.i] !== '$') return '';

  const xi0 = s.i;
  s.i++;
  const done = s => (s.text.startsWith('$', s.i) || s.i >= s.text.length);
  const body = p_toplevel_verbatim(s, done);
  p_take(s, '$');
  const xif = s.i;

  return new Rep.Katex({
    katex: s.katexPrefix + '' + body,
    displayMode: false,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}



// Execute a backslash command
function p_command(s) {
  const xi0 = s.i;
  if (s.text[s.i] !== '\\') return '';
  s.i++;

  p_spaces(s);

  const name = p_word(s);

  const command = commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}


const commands = {};

// Title
commands.title = function(s) {
  return new Rep.Seq('<div class="title">', p_block(s, p_toplevel_markup), '</div>');
}

// Section header
commands.sec = function(s) {
  return new Rep.Seq('<div class="section-header">', p_block(s, p_toplevel_markup), '</div>');
}

// Italic, bold, underline, strikethrough
for (const tag of 'ibus')
  commands[tag] = function(s) {
    return new Rep.Seq(`<${tag}>`, p_inline(s, p_toplevel_markup), `</${tag}>`);
  }

// Code
commands.c = function(s) { return commands.code(s); }
commands.code = function(s) {
  p_spaces(s);
  let language = /\w/.test(s.text[s.i]) ? p_word(s).toString() : null;
  p_spaces(s);
  let [body, kind] = p_enclosed(s, p_toplevel_verbatim);
  return new Rep.Code({ language, body, isBlock: kind === 'block' });
}

// Comment (REMark)
commands.rem = function(s) {
  p_spaces(s);
  const [comment, _] = p_enclosed(s, p_toplevel_verbatim);
  return '';
}

// Annotation reference
commands.aref = function(s) {
  p_spaces(s);

  let name;
  if (!";[{(<:".includes(s.text[s.i])) {
    name = p_word(s).toString();
  } else {
    name = s.gensym('annot');
    s.annotNameQueue.push(name);
  }

  p_spaces(s);

  let body;
  let isSuper;
  if (s.text[s.i] === ';') {
    const { value, done } = s.annotNameStack.next();
    if (done)
      throw mkError(s.text, [s.i, s.i + 1], 'Out of footnote symbols!');
    s.i++;
    body = value;
    isSuper = true;
  } else {
    body = p_inline(s, p_toplevel_markup)
    isSuper = false;
  }

  const isSuperClass = isSuper ? 'super' : '';
  return new Rep.Seq(
    `<span class="annotation-reference ${isSuperClass}" id="${s.gensym('annot-id')}" data-refers-to="${name}">`,
    body,
    '</span>'
  );
}

// Annotation definition
commands.adef = function(s) {
  const sx = s.clone();

  p_spaces(s);

  let name;
  if (!"[{(<:=".includes(s.text[s.i])) {
    name = p_word(s);
    p_spaces(s);
  } else {
    if (s.annotNameQueue.length === 0)
      throw mkError(sx.text, sx.i, "Unpaired \\adef");
    name = s.annotNameQueue[0];
    s.annotNameQueue.splice(0, 1);
  }

  return new Rep.Seq(`<div class="annotation-definition" data-name="${name}">`, p_block(s, p_toplevel_markup), '</div>');
}

// Explicit note reference
commands.ref = function(s) {
  const sx = s.clone();

  p_spaces(s);

  const toNoteId = p_backtracking(s, p_word);
  if (!toNoteId) throw mkError(sx.text, sx.i, "Missing note ID");
  p_spaces(s);

  const sr = s.clone();
  sr.doImplicitReferences = false;
  const body = p_inline(sr, p_toplevel_markup);
  Object.assign(s, { ...sr, doImplicitReferences: s.doImplicitReferences });
    // ^ TODO: Technically, this is bugged! (B*)
    //         If a callee also sets doImplicitReferences=false, this will wrongly overwrite that.

  const toNote = s.graph.notesById[toNoteId];
  return new Rep.Explicit({ toNoteId, toNote, body });
}

// Local evaluator modification
commands.scope = function(s) {
  p_spaces(s);
  const expr = p_dhallExpr(s, { takeToEol: false });
  const json = evalDhall(expr, s.env);

  const srec = s.clone();

  if ('infer-references' in json)
    srec.doImplicitReferences = !!json['infer-references'];

  const [r, _] = p_enclosed(srec, p_toplevel_markup);

  Object.assign(s, { ...srec, doImplicitReferences: s.doImplicitReferences });
    // ^ TODO: bugged; see (B*)

  return r;
}

// External (hyper-)reference
commands.href = function(s) {
  p_spaces(s)
  p_take(s, '<');
  const href = p_takeTo(s, '>');
  p_take(s, '>');
  p_spaces(s)

  const doImplicitReferences = s.doImplicitReferences;
  const srec = { ...s.clone(), doImplicitReferences: false };
    // ^ Nested <a> tags are forbidden in HTML
  const body = p_inline(srec, p_toplevel_markup);
  Object.assign(s, { ...srec, doImplicitReferences });

  return new Rep.Seq(`<a href="${href}" class="ext-reference" target="_blank">`, body, "</a>");
}

// KaTeX
commands.katex = function(s) {
  p_spaces(s);

  const append = s.text.startsWith('pre', s.i);
  if (append) {
    p_take(s, 'pre');
    p_spaces(s);
  }

  const xi0 = s.i;
  const [body, kind] = p_enclosed(s, p_toplevel_verbatim);
  const xif = s.i;

  if (append) {
    s.katexPrefix.add(body);
    return '';
  }

  const displayMode = { block: true, inline: false }[kind];
  return new Rep.Katex({
    katex: s.katexPrefix + '' + body,
    displayMode,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}

commands['katex-prelude'] = function(s) {
  p_spaces(s);
  p_take(s, ';\n');
  s.katexPrefix.add(String.raw`
    % shorthands
    \newcommand{\cl}[1]{ \mathcal{#1} }
    \newcommand{\sc}[1]{ \mathscr{#1} }
    \newcommand{\bb}[1]{ \mathbb{#1} }
    \newcommand{\fk}[1]{ \mathfrak{#1} }
    \renewcommand{\bf}[1]{ \mathbf{#1} }
    \renewcommand{\tt}[1]{ \texttt{#1} }

    \newcommand{\floor}[1]{ { \lfloor {#1} \rfloor } }
    \newcommand{\ol}[1]{ \overline{#1} }
    \newcommand{\t}[1]{ \text{#1} }

    % "magnitude"
    \newcommand{\mag}[1]{ { \lvert {#1} \rvert } }

    % cardinality
    \newcommand{\card}{ \t{card} }

    % disjoint untion
    \newcommand{\dcup}{ \sqcup }

    % represents an anonymous parameter
    % eg. $f(\apar)$ usually denotes the function $x \mapsto f(x)$
    \newcommand{\apar}{ {-} }

    % tuples
    \newcommand{\tup}[1]{ \langle {#1} \rangle }

    \newcommand{\iffText}{{ \hspace{20pt}\t{iff}\hspace{20pt} }}

    \newcommand{\pre}[1]{{ \small ${'`'}{#1} }}
  `);
  return new Rep.Seq('');
}

// TeX, TikZ
commands.tikz = function(s) {
  p_spaces(s);

  let append = s.text.startsWith('pre', s.i);
  if (append) {
    p_take(s, 'pre');
    p_spaces(s);
  }

  let tex, kind;
  [tex, kind] = p_enclosed(s, p_toplevel_verbatim);

  if (append) {
    s.texPrefix.add(tex);
    return '';
  }

  tex = s.texPrefix + tex;
  return new Rep.Tex({ tex, isTikz: true, isBlock: kind === 'block' });
}

commands['tikz-gen'] = function(s) {
  p_spaces(s);

  const script = p_block(s, p_toplevel_verbatim);

  let tex = eval(`
    (function() {
      const gen = (function * () {
        ${script}
      })();
      let result = '';
      for (const part of gen)
        result += part + '\\n';
      return result;
    })();
  `);
  console.log(tex);
  tex = s.texPrefix + tex;

  return new Rep.Tex({ tex, isTikz: true, isBlock: true });
}


// Jargon
commands.jarg = function(s) {

  let forms = new Set();
  while (true) {
    p_spaces(s);
    if (!s.text.startsWith('<', s.i)) break;
    const jargs = p_jargon(s);
    forms = new Set([...forms, ...jargs]);
  }

  // TODO: more reucurrence happening here!
  const doImplicitReferences = s.doImplicitReferences;
  const srec = { ...s.clone(), doImplicitReferences: false };
  const body = p_inline(srec, p_toplevel_markup);
  Object.assign(s, { ...srec, doImplicitReferences });

  return new Rep.Jargon({ forms, body });
}


// Experimenal execute command
commands.x = function(s) {
  s.env.log.warn(`use of \\x`);

  const [body, kind] = p_enclosed(s, p_toplevel_verbatim);

  const code =
    kind === 'inline'
      ? body.toString()
    : kind === 'block'
      ? `(function(){\n${body}\n})()`
    : null;

  // Set up eval() environment
  // TODO: both this codeblock and p_indent do some wack recursion shit that should be reified
  const parse = str => {
    const srec = s.clone();
    srec.text = str;
    srec.i = 0;
    const result = p_toplevel_markup(srec, s => s.i >= s.text.length);
    Object.assign(s, {
        ...srec,
        text: s.text,
        i: s.i,
    });
    return result;
  };

  return eval(code) || '';
}


// tables
commands.table = function(s) {

  const xi0 = s.i;

  p_whitespace(s);
  const opts = {};
  while (true) {
    const sb = s.clone();
    p_whitespace(sb);
    if (!/[\w-]/.test(sb.text[sb.i])) break;
    Object.assign(s, sb);

    const key = p_word(s);
    p_take(s, '=');
    const val = p_word(s);
    opts[key] = val;
  }

  let doHorizontalHeaders = false;
  let doVerticalHeaders = false;
  let doCentering = false;
  for (const [key, val] of Object.entries(opts)) {
    switch (key) {
      case 'headers':
        if (!'h v both no'.split(' ').includes(val))
          throw mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'headers'`);
        doHorizontalHeaders = 'h both'.split(' ').includes(val);
        doVerticalHeaders   = 'v both'.split(' ').includes(val);
        break;

      case 'center':
        doCentering = { 'yes': true, 'no': false }[val];
        if (doCentering === undefined)
          throw mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'center'`);
        break;

      default:
        throw mkError(s.text, [xi0, s.i], `Unknown table option '${key}'`);
    }
  }

  const rows = [];
  while (true) {
    const ok = p_backtracking(s, s => {
      p_whitespace(s);
      return p_take(s, '|');
    });
    if (!ok) break;

    const row = [];
    while (true) {
      const cell = p_backtracking(s, s => {
        p_whitespace(s);
        const [body, kind] = p_enclosed(s, p_toplevel_markup);
        return body;
      });
      if (cell === null) break;
      row.push(cell);
    }
    rows.push(row);
  }

  p_backtracking(s, s => {
    p_spaces(s);
    p_take(s, '\n');
  });

  if (rows.length === 0)
    throw mkError(s.text, [xi0, s.i], "Empty table")

  let result = new Rep.Seq();
  const classes = [].concat(doHorizontalHeaders ? ['headers-horiz'] : [], doVerticalHeaders ? ['headers-vert'] : []);
  result.add(`<table class="${classes.join(' ')}">`);
  rows.forEach((row, rowI) => {
    result.add('<tr>');
    row.forEach((cell, cellI) => {
      const isHeader = doHorizontalHeaders && rowI === 0 || doVerticalHeaders && cellI === 0;
      const tag = isHeader ? 'th' : 'td';
      result.add(`<${tag}>`, cell, `</${tag}>`);
    });
    result.add('</tr>');
  });
  result.add('</table>');

  if (doCentering)
    result = new Rep.Seq('<center>', result, '</center>');

  return result;

}


// Expanding bullets
commands.fold = function(s) {
  p_spaces(s);
  const [line, _] = p_enclosed(s, p_toplevel_markup);
  p_spaces(s);
  const body = p_block(s, p_toplevel_markup);
  return new Rep.Indented({ indent: 2, body: new Rep.Expand({ line, body, id: s.gensym('expand') }) });
}

commands['unsafe-raw-html'] = function(s) {
  s.env.log.warn(`use of \\unsafe-raw-html`);
  p_spaces(s);
  const [html, _] = p_enclosed(s, p_toplevel_verbatim);
  return new Rep.Seq(html);
}

commands.quote = function(s) {
  p_spaces(s);
  const [body, _] = p_enclosed(s, p_toplevel_markup);
  return new Rep.Seq('<blockquote>', body, '</blockquote>');
}

// MermaidJS support
commands.mermaid = function(s) {
  p_spaces(s);
  const [body, _] = p_enclosed(s, p_toplevel_verbatim);

  // Unfortunately, mermaid does not seem to offer an API for rendering
  // a chart outwide of a browser environment.
  // So instead we have to defer rendering to the client.

  const divId = s.gensym('mermaid');
  return new Rep.Seq(String.raw`
    <div id="${divId}">${escapeHtml(body)}</div>
    <script> window.renderMermaid('${divId}'); </script>
  `);
}

commands.Given = function(s) {

  const parseLines = (s, sentinel) => {
    s.GivenIndex ??= 1;
    s.Given_lineIdentToNumber ??= {};

    const lines = [];
    while (true) {
      p_whitespace(s);
      if (p_backtracking(s, s => p_take(s, sentinel))) break;

      let ident = p_backtracking(s, s => {
        const ident = p_word(s);
        p_take(s, ':');
        return ident;
      });
      ident ??= lines.length + '';

      p_whitespace(s);

      const isNb = p_backtracking(s, s => {
        p_take(s, 'nb');
        p_whitespace(s);
        return true;
      });

      // !!!! very fucking big hack
      const isBlock = s.text.slice(s.i, s.i + 10).includes('\\Given');

      const [body, _] = p_enclosed(s, p_toplevel_markup);
      p_whitespace(s);
      const by = p_backtracking(s, s => {
        p_take(s, 'by');
        p_whitespace(s);
        const parseRef = s => {
          if (!s.text.startsWith('@', s.i)) return '';
          p_take(s, '@');
          let toNum;
          if (s.text.startsWith('@', s.i)) {
            p_take(s, '@');
            toNum = s.GivenIndex - 1 + '';
          } else {
            const ident = p_word(s);
            toNum = s.Given_lineIdentToNumber[ident];
          }
          return new Rep.Seq(
            `<span class="given-by-ref" data-to="${toNum}">`,
            toNum + '',
            `</span>`,
          );
        };
        const sp = { ...s, extraParsers: [...s.extraParsers, parseRef] };
        const [by, _] = p_enclosed(sp, p_toplevel_markup);
        Object.assign(s, { ...sp, extraParsers: s.extraParsers });
        return by;
      });
      const number = s.GivenIndex;
      s.Given_lineIdentToNumber[ident] = number;
      const line = [number, ident, body, by, isNb, isBlock];
      lines.push(line);
      s.GivenIndex++;
    }
    return lines;
  };

  const given = parseLines(s, 'Then');
  const then = parseLines(s, ';');

  const renderLine = ([number, name, body, by, isNb, isBlock]) => (
    new Rep.Seq(
      `<span class="given-line" data-name="${number}">`,
        ...(!isBlock ? [
          `<span class="given-line-number ${isNb ? 'nb' : ''}">`,
          number + '',
          '</span>',
        ] : []),
        '<span class="given-line-body">',
        body,
        '</span>',
        '<span class="given-line-by">',
        (by ?? ''),
        '</span>',
      '</span>',
    )
  );

  return new Rep.Seq(
    '<div class="given">',
    ...given.map(renderLine),
    '<span class="given-rule"></span>',
    ...then.map(renderLine),
    '</div>'
  );
}


// Jargon-lead implicit references
function p_implicitReference(s) {
  if (!s.doImplicitReferences) return '';

  const r = s.jargonMatcher.findMeAMatch(s.text, s.i);
  if (r === null) return '';

  const [jarg, stepAmt] = r;
  const defNotes = s.graph.jargonToDefiningNoteSet[jarg];

  const toNote = (
    defNotes && defNotes.size > 0
      ? [...defNotes][0] // TODO
      : null
  );

  const body = escapeHtml(s.text.slice(s.i, s.i + stepAmt));
  s.i += stepAmt;

  return new Rep.Implicit({ fromJargon: jarg, toNote, body });
}


function p_jargon(s) {

  if (!s.text.startsWith('<', s.i))
    throw mkError(s.text, s.i, "Expected '<'");
  s.i++;

  const parts = [['']];
  while (true) {
    if (s.text.startsWith('>', s.i)) {
      s.i++;
      break;
    }
    parts.push(p_jargonAux(s));
  }

  let result = [''];
  for (const part of parts)
    result = result.flatMap(j => part.map(p => j + p));
  return result;

}

function p_jargonAux(s) {

  // Disjunctive combinator -- (this|that)
  if (s.text.startsWith('(', s.i)) {
    s.i++;
    const choices = [];
    while (true) {
      const choice = p_jargonAux(s);
      choices.push(choice);
      if (s.text.startsWith(')', s.i)) {
        s.i++;
        break;
      } else if (s.text.startsWith('|', s.i)) {
        s.i++;
      } else {
        throw mkError(s.text, s.i, "Expected pipe");
      }
    }
    return p_jargonAux(s).flatMap(suff => choices.flat().map(pre => pre + suff));
  }

  // Quoted syntax -- "word with some spaces"
  else if (s.text.startsWith('"', s.i)) {
    const word = new Cats();
    s.i++;
    loop: while (true) {
      switch (s.text[s.i]) {
        case "\\":
          word.add(s.text[s.i + 1]);
          s.i += 2;
          break;

        case "\"":
          s.i ++;
          break loop;

        default:
          word.add(s.text[s.i]);
          s.i++;
          break;
      }
    }
    return [word];
  }

  // Termination
  else if ('|)>'.includes(s.text[s.i])) {
    return [''];
  }

  // Plain syntax -- word
  else {
    const char = s.text[s.i];
    s.i++;
    return p_jargonAux(s).map(j => char + j);
  }

}

// Parse block or inline
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

    const srec = { ...s.clone(), indents: [] };
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



function template(html) {
  return new Rep.Seq(String.raw`

<!DOCTYPE HTML>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.4.0/styles/github.min.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
  </head>
<body>

<style>

:root {
  --color-static-rgb: 117, 19, 128;
  --color-static: rgb(var(--color-static-rgb));

  --color-dynamic-rgb: 204, 0, 102;
  --color-dynamic: rgb(var(--color-dynamic-rgb));
}

body {
  margin: 0;
  font-size: 0;
}

main {
  white-space: pre-wrap;
  font-size: 14px;
  font-family: 'Merriweather', serif;
  line-height: 1.5em;
}

.title {
  font-weight: bold;
  color: var(--color-static);
  font-size: 18px;
  margin-bottom: 1em;
}

.section-header {
  font-weight: bold;
  color: var(--color-static);
  border-bottom: 1px dotted var(--color-static);
}

code {
  border: 1px solid rgba(var(--color-static-rgb), .25);
  background-color: rgb(245, 245, 245);
  border-radius: 3px;
  white-space: pre-wrap;
}
code.inline {
  display: inline;
  padding: 0px 3px;
}
code.block {
  display: block;
  padding: .35em .5em;
}

hr {
  border: none;
  border-bottom: 1px dashed rgb(200, 200, 200);
}

.katex-display {
  margin: 0;
}

.tikz {
  text-align: center;
  display: block;
  max-width: 100%;
}
.tikz > svg {
  max-width: 100%;
}

a {
  color: var(--color-dynamic);
}

table {
  border-collapse: collapse;
  font-size: 1em;
}
table, tr, th, td {
  border: 1px solid var(--color-static);
}
th, td {
  padding: .3em .6em;
}
table.headers-horiz tr:first-child {
  border-bottom-width: 2px;
}
table.headers-vert td:first-child,
table.headers-vert th:first-child
{
  border-right-width: 2px;
}

blockquote {
  margin: 0;
  padding-left: 1em;
  border-left: 4px solid rgba(0, 0, 0, 0.1);
  position: relative;
}
blockquote::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 4px;
  width: 30px;
  height: 30px;
  opacity: 0.05;
  pointer-events: none;
  background-size: cover;
  background-position: center;
  background-image: url(data:image/png;base64,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);
}


@media print {
  .hide-on-print {
    display: none;
  }
}


/* Styling for references to other notes */
.reference, .reference:visited {
  color: inherit;
}
.reference {
  text-decoration: none;
}
.reference.implicit:not(:hover) {
  border-bottom: 1.5px solid rgba(var(--color-dynamic-rgb), .15);
}
.reference:not(.invalid):hover {
  border: none;
  background-color: rgba(var(--color-dynamic-rgb), .25);
}
.reference.explicit:not(:hover) {
  border-bottom: 2px solid rgba(var(--color-dynamic-rgb), .75);
}
.reference.invalid {
  color: red;
  cursor: not-allowed;
}

</style>


<script>

// <-> URL sync helpers
// Blunt, but it works
// TODO: better API

window.urlSynchronizedState = {};

function syncToUrl() {
  const url0 = new URL(window.location.href);
  url0.searchParams.set('state', JSON.stringify(window.urlSynchronizedState));
  window.history.pushState(null, '', url0.toString());
}

function syncFromUrl() {
  const url = new URL(window.location.href);
  const str = url.searchParams.get('state')
  window.urlSynchronizedState = JSON.parse(str) || {};
}

syncFromUrl();

</script>

`,

annotationsImplementation,

jargonImplementation,

expandableListsImplementation,

mermaidJsImplementation,

givenImplementation,

`

<main>`, html, `</main>

</body>
</html>

`);
}

const annotationsImplementation = String.raw`

<style>

* { box-sizing: border-box; }

.annotation-reference.super
{
  vertical-align: super;
  font-size: .9em;
  position: relative;
  padding: 0 1px;
}

/* Increase effective clickable area */
.annotation-reference.super:before {
  content: '';
  position: absolute;
  width: 25px;
  height: 25px;
  border-radius: 100%;
  left: calc(50% - 25px / 2);
  top: calc(50% - 25px / 2);
  /* background-color: rgba(var(--color-dynamic-rgb), .1); */
}

.annotation-reference:not(.super):before { content: '['; }
.annotation-reference:not(.super):after { content: ']'; }

.annotation-reference:before,
.annotation-reference:after,
.annotation-reference
{
  color: rgba(var(--color-dynamic-rgb), .65);
  cursor: pointer;
}

.annotation-reference:hover:before,
.annotation-reference:hover:after,
.annotation-reference:hover,
.annotation-reference.active:before,
.annotation-reference.active:after,
.annotation-reference.active
{
  color: var(--color-dynamic);
}

.annotation-reference.active:before,
.annotation-reference.active:after,
.annotation-reference.active
{
  font-weight: bold;
}

.annotation-definition {
  background: rgba(250, 250, 250);
  box-shadow: 0 0 8px -2px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(var(--color-static-rgb), .5);
  border-radius: 3px;

  padding: .5em 1em;
  margin: .5em 0;
}

.annotation-definition:not(.revealed) {
  display: none;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  // id set of expanded \aref nodes
  let expandedRefs = new Set(window.urlSynchronizedState.expandedRefs || []);

  function stateToDom() {
    for (const $ref of document.querySelectorAll('.annotation-reference')) {
      const isExpanded = expandedRefs.has($ref.id);

      const $def = document.querySelector('.annotation-definition[data-name="' + $ref.dataset.refersTo + '"]');
      if (!$def) {
        console.warn("Unable to find annotation definition with name: '" + name + "'", 'due to reference', $ref);
        return;
      }

      if (isExpanded) {
        $def.classList.add('revealed');
        $ref.classList.add('active');
      } else {
        $def.classList.remove('revealed');
        $ref.classList.remove('active');
      }
    }
  }

  stateToDom();

  for (const $ref of document.querySelectorAll('.annotation-reference')) {
    $ref.addEventListener('click', () => {
      const isExpanded = expandedRefs.has($ref.id);
      if (isExpanded) expandedRefs.delete($ref.id);
      else expandedRefs.add($ref.id);

      stateToDom();

      window.urlSynchronizedState.expandedRefs = [...expandedRefs];
      syncToUrl();
    });
  }

});

</script>

`;


const jargonImplementation = String.raw`

<style>

.jargon {
  text-decoration: underline;
  cursor: help;

  position: relative;
}

.jargon .jargon-tooltip {
  position: absolute;
  z-index: 10;
  display: inline-block;
  width: auto;
  top: calc(100% + 5px);
  left: 50%;
  transform: translate(-50%);
  display: none;

  background: rgba(250, 250, 250);
  box-shadow: 0 0 8px -2px rgba(0, 0, 0, 0.35);
  border: 1px solid var(--color-static);
  border-radius: 3px;

  text-align: center;
  font-size: 0.8em;
  padding: .5em 2em;
  line-height: 1.2em;
}
.jargon .jargon-tooltip p {
  margin: .5em 0;
  white-space: nowrap;
}
.jargon .jargon-tooltip hr {
  margin: .75em 0;
}

.jargon:hover {
  font-weight: bold;
}

.jargon:hover .jargon-tooltip {
  font-weight: normal;
  display: block;
}

</style>


<script>

document.addEventListener('DOMContentLoaded', () => {

  for (const $jarg of document.querySelectorAll('.jargon')) {
    $jarg.append(mkTooltip($jarg));
  }

  function mkTooltip($jarg) {
    const words = $jarg.dataset.forms.split(';');

    const $tt = document.createElement('div');
    $tt.classList.add('jargon-tooltip');

    const $p0 = document.createElement('p');
    $p0.innerHTML = 'Synonyms'
    $tt.append($p0);

    $tt.append(document.createElement('hr'));

    for (const word of words) {
      const $p = document.createElement('p');
      $p.innerText = word;
      $tt.append($p);
    }

    // Keep tooltip on-screen
    $jarg.addEventListener('mouseenter', () => {
      const margin = 10;

      const leftEdge = $jarg.offsetLeft + $jarg.offsetWidth / 2 - $tt.offsetWidth / 2;
      if (leftEdge < 10)
        $tt.style.marginLeft = -leftEdge + margin + 'px';

      const rightEdge = $jarg.offsetLeft + $jarg.offsetWidth / 2 + $tt.offsetWidth / 2;
      if (rightEdge > document.body.offsetWidth - margin)
        $tt.style.marginRight = -rightEdge + margin + 'px';
    });

    return $tt;
  }

});

</script>

`;


const expandableListsImplementation = String.raw`

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

const mermaidJsImplementation = String.raw`

<script>

window.renderMermaid = async function(eltId) {
  await loadMermaid();
  mermaid.mermaidAPI.initialize({ startOnLoad: false });
    // ^ Yes, we have to reload and reinitialize every time.
    //   No, I don't know why.

  await domContentLoaded;

  const $in = document.getElementById(eltId);
  const $out = document.createElement('div');
  $out.style.textAlign = 'center';
  $in.after($out);

  mermaid.mermaidAPI.render($in.id, $in.innerText, r => { $out.innerHTML = r; });
}

const domContentLoaded = new Promise(resolve =>
  document.addEventListener('DOMContentLoaded', () => resolve()));

async function loadMermaid() {
  const $script = document.createElement('script');
  $script.src = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
  await new Promise(resolve => {
    $script.onload = () => resolve();
    document.body.append($script);
  });
}

</script>

`;

const givenImplementation = String.raw`

<script>

document.addEventListener('DOMContentLoaded', () => {

  const $proofs = document.querySelectorAll('.given');

  for (const $proof of $proofs) {
    const state = new Set();

    const $lines = $proof.querySelectorAll('.given-line');
    const $refs = $proof.querySelectorAll('.given-by-ref');

    function rerender() {
      for (const $line of $lines) {
        const ident = $line.dataset.name;
        if (state.has(ident))
          $line.classList.add('highlight');
        else
          $line.classList.remove('highlight');
      }
    }

    for (const $ref of $refs) {
      const refTo = $ref.dataset.to;
      $ref.addEventListener('mouseover', () => {
        state.add(refTo);
        rerender();
      });
      $ref.addEventListener('mouseleave', () => {
        state.delete(refTo);
        rerender();
      });
    }
  }

});

</script>

<style>

.given {
  max-width: 80vw;

  display: flex;
  flex-direction: column;

  border: 4px solid rgb(0, 0, 0, 0.1);
  border-right: 0;
}

.given-rule {
  width: 100%;
  height: 0px;
  border-bottom: 1px dotted rgb(0, 0, 0, 0.5);
}

.given-line-number {
  margin-right: .3em;
  color: rgba(0, 0, 0, .35);
}
.given-line-number:after {
  content: ': ';
}

.given-line-number.nb {
  opacity: 0;
}

.given-line {
  display: flex;
  padding: .35em 0;
  padding-left: .65em;
}

.given-line.highlight {
  background-color: rgba(var(--color-dynamic-rgb), 0.1);
}

.given-line-body {
  flex: 1;
}

.given-by-ref:before { content: '['; }
.given-by-ref:after { content: ']'; }

.given-by-ref,
.given-by-ref:before,
.given-by-ref:after
{
  color: var(--color-dynamic);
  cursor: pointer;
}

.given-by-ref:hover,
.given-by-ref:hover:before,
.given-by-ref:hover:after
{
  background: black;
  color: white;
}

</style>

`;


class JargonMatcherJargonMatcher {
  constructor(jargs, exclude) {
    const signifChars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    this.isSignif = c => signifChars.has(c);
    this.normalize = s => [...s.toLowerCase()].filter(c => this.isSignif(c) || '$])>'.includes(c)).join('');
      // ^ n.b. we assume that length(norm(s)) <= length(s)

    this.jargs = (
      [...jargs]
      .sort((a, b) => b.length - a.length)
      .map(j => [j, this.normalize(j)])
    );
    this.exclude = new Set([...exclude]);
    this.M = Math.max(...this.jargs.map(([_, nj]) => nj.length));

    this.jargsOfNormLengthEq = {};

    {
      for (let l = 1; l <= this.M; l++)
        this.jargsOfNormLengthEq[l] = [];
      for (const [jarg, njarg] of this.jargs)
        this.jargsOfNormLengthEq[njarg.length].push([jarg, njarg]);
    }

  }

  findMeAMatch(str, idx0) {
    if (this.isSignif(str[idx0 - 1]) || !this.isSignif(str[idx0])) return null;
    for (let idxf = idx0 + this.M; idxf >= idx0 + 1; idxf--) {
      if (this.isSignif(str[idxf]) || !this.isSignif(str[idxf - 1])) continue;
      const normed = this.normalize(str.slice(idx0, idxf));
      for (const [jarg, njarg] of this.jargsOfNormLengthEq[normed.length]) {
        if (normed === njarg) {
          if (this.exclude.has(jarg)) return null;
          return [jarg, idxf - idx0];
        }
      }
    }
    return null;
  }
}


function ruled(str, pref='>|') {
  const bar = '------';
  return [bar, ...str.toString().split('\n').map(l => pref + l.replace(/ /g, '⋅')), bar].join('\n');
}

function sample(str, from = 0, linec = 5) {
  return ruled(str.toString().slice(from).split('\n').slice(0, linec).join('\n'));
}

function sample_s(s, linec = 4) {
  return sample(s.text, s.i, linec);
}
