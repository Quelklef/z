const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../util.js');
const fss = squire('../../fss.js');

const Rep = squire('./rep.js');
const { Trie, indexOf, impossible, cloneIterator } = squire('./util.js');
// WANT: switch from p_ prefix to p. module
const { p_block, p_inline, p_enclosed, p_toplevel, p_toplevel_markup, p_toplevel_verbatim, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('./parsing.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();

function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  env = env.descend();
  env.log.prefixes.push('note=' + noteId.toString());

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

    const referencedBy = [...note.referencedBy].map(id => graph.notesById[id]);
    rep.traverse(node => {
      if (node instanceof Rep.ReferencedBy)
        node.setReferencedBy(referencedBy);
    });

    env.parent.log.info('rendering', note.id);
    return rep.toHtml(env);
  });

  return note;
}


let baseExtraParsers = [];

function parse({ text, note, graph, env, doImplicitReferences }) {

  // WANT: state should be tracked per-module

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
    extraParsers: [
      p_sigils,
      p_quotes,
      p_katex,
      p_indent,
      p_command,
      p_escapes,
      ...baseExtraParsers,
    ],

    finalParsers: [
    ],

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
      c.finalParsers = [...c.finalParsers];
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

  rep.add(new Rep.ReferencedBy());

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






const modules = [
  require('./modules/annotations.js'),
  require('./modules/mermaid.js'),
  require('./modules/given.js'),
  require('./modules/jargon.js'),
  require('./modules/table.js'),
];

let prelude = new Cats();
for (const module of modules) {
  Object.assign(commands, module.commands);
  baseExtraParsers = [...baseExtraParsers, ...(module.parsers ?? [])];
  prelude.add(module.prelude ?? '');
}
prelude = prelude.toString();



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

prelude,

expandableListsImplementation,

`

<main>`, html, `</main>

</body>
</html>

`);
}




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
