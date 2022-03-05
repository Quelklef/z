import * as plib from 'path';
import * as child_process from 'child_process';
import fs from 'fs';
import katex from 'katex';

import { lazyAss, cache, withTempDir } from './util.mjs';

export default function * (pwd, graph) {

  const ls = fs.readdirSync(plib.resolve(pwd, 'notes'))
  for (const fname of ls) {
    const floc = plib.resolve(pwd, 'notes', fname);
    if (floc.endsWith('.z')) {
      const source = fs.readFileSync(floc).toString();
      if (source.trim().split('\n')[0].trim() === 'format=proper')
        yield mkNote(floc, source, graph);
    }
  }

}


function mkNote(floc, source, graph) {

  const note = {};

  const scriptSrc = fs.readFileSync('./fmt-proper.mjs').toString();
  note.cacheKeys = [floc, source, scriptSrc];

  note.id = plib.basename(floc, '.z');

  // note[t] holds transient (non-cached) data
  const t = Symbol('fmt-proper.t');
  Object.defineProperty(note, t, { enumerable: false, value: {} });

  lazyAss(note[t], 'preparsed', () => {
    console.log(`Preparsing [${note.id}]`);
    return parse(source, false);
  });

  lazyAss(note, 'defines', () => note[t].preparsed.defines);

  lazyAss(note[t], 'parsed', () => {
    console.log(`Parsing [${note.id}]`);
    return parse(source, true, graph);
  });

  lazyAss(note, 'references', () => note[t].parsed.defines);

  lazyAss(note, 'html', () => note[t].parsed.html);

  return note;
}


/*

Quick prelude on parsing

Parsers are expected to have the signature
  r = parser(...args, s)

That is, they take some arguments and the current state s, and perform some
parsing, mutating the state s, and producing a result r.

For performance reasons, the returned state s1 will usually be the *same object*
as the passed-in state s; mutation is allowed.

If you want backtracking or lookahead, pass in s.clone().

Parsers fail by throwing.

*/


function parse(text, resolveJargon, graph) {

  // Initial parser state
  let s = {

    // Source text
    text,

    // Index in text
    i: 0,

    // Set of terms this note defines
    defines: new Set(),

    // Set of notes this note references, as their IDs
    references: new Set(),

    // Should jargon be resolved?
    resolveJargon,

    // Parent graph object
    graph,

    // Global symbol state
    // Use s.gensym++ to generate a new symbol
    gensym: 0,

    // annotation-specific state
    annotNameQueue: [],

    clone() {
      const c = { ...this };
      c.defines = new Set(c.defines);
      c.references = new Set(c.references);
      c.annotNameQueue = [...c.annotNameQueue];
      return c;
    },

  };

  // Skip format header and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  if (s.text[s.i] === '\n') s.i++;

  const done = s => s.i >= s.text.length;
  const html = p_main(s, done);

  return {
    defines: s.defines,
    references: s.references,
    html: withHtmlTemplate('' + html),
  };

}

function p_main(s, done) {

  done = done || (_ => false);

  const parsers = [
    p_sigils,
    p_quotes,
    p_katex,
    p_indented,
    p_command,
  ]

  const html = Cats.on(s.text);

  if (done(s)) return '';

  parsing:
  while (true) {

    // Try each parser
    for (const parser of parsers) {
      const i0 = s.i;
      const h = parser(s);
      if (h) html.add(h);
      if (s.i !== i0)
        continue parsing;
    }

    // All parsers tried

    // Break out to caller
    if (done(s))
      return html;

    // Out of text but not yet done()
    if (s.i >= s.text.length)
      throw mkError(s, "Unexpected EOF!");

    // Default case: advance by one character
    html.addFromSource(s.i);
    s.i++;
  }

}


// Sigils: static replacements
function p_sigils(s) {

  const mapping = {
    '--': '&mdash;',

    // Sanitization
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
  };

  for (const [key, val] of Object.entries(mapping)) {
    if (s.text.startsWith(key, s.i)) {
      s.i += key.length;
      return val;
    }
  }

  return '';

}


// Fancy quote marks
function p_quotes(s) {
  if (!`'"`.includes(s.text[s.i])) return '';

  const nonblank = c => !(c || '').match(/\s/);
  const quot = s.text[s.i];
  const before = nonblank(s.text[s.i - 1]);
  const after = nonblank(s.text[s.i + 1]);

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


// Handle indented blocks and lists
function p_indented(s) {
  if (![undefined, '\n'].includes(s.text[s.i - 1])) return '';

  // Calculate line column
  let i = s.i;
  while (s.text[i] === ' ') i++;
  let column = i - s.i;

  const bulleted = s.text.startsWith('- ', s.i);
  if (bulleted)
    column += 2;

  // If line empty or not indented, bail
  if (!bulleted)
    if (column === 0 || ['\n', undefined].includes(s.text[i]) && !bulleted)
      return '';

  // Else, parse as indented block
  const body = indented(p_main, column, bulleted, s);
  return Cats.of(`<div style="margin-left: ${column}ch; display: ${bulleted ? 'list-item' : 'block'}">`, body, '</div>');
}


function p_katex(s) {
  if (s.text[s.i] !== '$') return '';

  s.i++;
  const done = s => (s.text.startsWith('$', s.i) || s.i >= s.text.length);
  const body = p_verbatim(s, done);
  s.i++;

  return katex.renderToString('' + body, { displayMode: false });
}


function indented(parser, column, bulleted, s) {

  // Gather indented lines
  const lines = [];
  let start = s.i;
  while (start < s.text.length) {
    const end = indexOf(s.text, '\n', start);
    const line = s.text.slice(start, end + 1);

    if (
      line.slice(0, column).trim() === ''
        // ^ Accept indented lines and blank lines
      || lines.length === 0 && bulleted && line.startsWith('- ')
        // ^ Or a leading bulleted line
    ) {
      lines.push(line);
      start = end + 1;
    } else {
      break;
    }
  }

  // Remove trailing whitespace lines
  while (
    lines.length > 0
    && lines[lines.length - 1].trim() === ''
  )
    lines.pop(lines.length - 1);

  // Build block of unindented code
  const block = lines.map(line => line.slice(column)).join('');

  // Invoke (TODO: this whole deal feels wrong. and it will fuck up error index numbers)
  const srec = {
    ...s.clone(),
    text: block,
    i: 0,
  };
  const done = s => s.i >= s.text.length;
  const r = parser(srec, done);
  Object.assign(s, {
    ...srec.clone(),
    text: s.text,
    i: s.i + lines.map(line => line.length).reduce((a, b) => a + b, 0),
  });
  return r;

}


// Execute a backslash command
function p_command(s) {
  if (s.text[s.i] !== '\\') return '';

  const sx = s.clone();
  s.i++;

  chompSpace(s);

  const name = parseWord(s).toString();

  if (name === '')
    throw mkError(sx, "Expected command name to follow backslash!");

  const command = commands[name];
  if (!command)
    throw mkError(sx, `No command named '${name}'!`);

  return command(s);
}


const commands = {

  // Title
  title(s) {
    const [body, _] = enclosed(p_main, s);
    return Cats.of('<div style="border-bottom: 1px solid #C06">', body, '</div>');
  },

  // Section header
  sec(s) {
    const [body, _] = enclosed(p_main, s);
    return Cats.of('<div style="border-bottom: 1px dotted #C06">', body, '</div>');
  },

  // KaTeX
  katex(s) {
    const [body, kind] = enclosed(p_verbatim, s);
    const displayMode = { block: true, inline: false }[kind];
    const rendered = katex.renderToString('' + body, { displayMode });
    return rendered;
  },

  // Italic
  i(s) {
    const [body, _] = enclosed(p_main, s);
    return Cats.of('<i>', body, '</i>');
  },

  // Bold
  b(s) {
    const [body, _] = enclosed(p_main, s);
    return Cats.of('<b>', body, '</b>');
  },

  // Underline
  u(s) {
    const [body, _] = enclosed(p_main, s);
    return Cats.of('<u>', body, '</u>');
  },

  // <code>
  c(s) {
    const [body, kind] = enclosed(p_main, s);
    return Cats.of(`<code style="display: ${kind}">`, body, '</code>');
  },

  // Annotation reference
  aref(s) {
    chompSpace(s);

    let name = parseWord(s).toString();
    if (!name) {
      name = '' + (s.gensym++);
      s.annotNameQueue.push(name);
    }

    chompSpace(s);

    const [body, _] = enclosed(p_main, s);

    return Cats.of(`<span class="annotation-reference" data-refers-to="${name}">`, body, '</span>');
  },

  // Annotation definition
  adef(s) {
    const sx = s.clone();

    chompSpace(s);

    let name = parseWord(s).toString();
    if (!name && s.annotNameQueue.length > 0) {
      name = s.annotNameQueue[0];
      s.annotNameQueue.splice(0, 1);
    }
    if (!name) {
      throw mkError(sx, "Unpaired \\adef!");
    }

    const [body, _] = enclosed(p_main, s);

    return Cats.of(`<div class="annotation-definition" data-name="${name}">`, body, '</div>');
  },

  // TeX, TikZ
  tikz(s) { return commands.tex(s, true); },
  tex(s, tikz = false) {
    let tex, kind;
    [tex, kind] = enclosed(p_verbatim, s);

    if (tikz) {
      tex = String.raw`
\begin{tikzpicture}
${tex}
\end{tikzpicture}
`;
    }

    tex = String.raw`
\documentclass{standalone}
\usepackage{tikz}
\usepackage{lmodern}
\usepackage[T1]{fontenc}
\begin{document}
${tex}
\end{document}
`;

    let html = renderTeX(tex);
    if (kind === 'block') html = Cats.of('<div style="display: block; text-align: center;">', html, '</div>');
    return html;
  },

};


function chompSpace(s) {
  while (s.text[s.i] === ' ') s.i++;
  return s;
}

function parseWord(s) {
  const word = Cats.on(s.text);
  while (/\w/.test(s.text[s.i])) {
    word.addFromSource(s.i);
    s.i++;
  }
  return word;
}


// TODO: probably this should be decoupled into
//       block(), inline() and enclosed()
function enclosed(parser, s) {
  const open = s.text[s.i];

  // \cmd:
  if (open === ':') {

    s.i++;

    const eol = indexOf(s.text, '\n', s.i);

    // \cmd: <stuff>
    if (s.text.slice(s.i + 1, eol).trim() !== '') {
      if (s.text[s.i] === ' ') s.i++;
      const done = s => ['\n', undefined].includes(s.text[s.i]);
      const r = parser(s, done);
      s.i++;  // skip newline
      return [r, 'block'];

    // \cmd:\n <stuff>
    } else {
      s.i = eol + 1;
      let i = s.i;
      while (s.text[i] === ' ') i++;
      let column = i - s.i;
      const r = indented(parser, column, false, s);
      return [r, 'block'];
    }


  // \cmd[], cmd{}, etc
  } else {

    const pairs = {
      '(': ')',
      '[': ']',
      '<': '>',
      '{': '}',
    }
    const close = pairs[open];
    if (!close)
      throw mkError(s, "Expected opening character!");
    s.i++;

    const done = s => s.text.startsWith(close, s.i);
    const r = parser(s, done)

    s.i += close.length;
    return [r, 'inline'];

  }
}


function p_verbatim(s, done) {

  done = done || (_ => false);

  const result = Cats.on(s.text);

  if (done(s)) return '';
  result.addFromSource(s.i);

  while (true) {

    s.i++;

    if (done(s))
      return result;

    if (s.i > s.text.length)
      throw mkError(s, "Unexpected EOF!");

    if (s.i !== s.text.length)
      result.addFromSource(s.i);

  }

}


function mkError(s, err) {
  return Error(err + ' Around: ' + s.text.slice(s.i, s.i + 25));
}


/*

Souped-up string builder

cats = new Cats()
cats.add(s)  // add a string
str = cats.toString()  // build

cats = Cats.of(a, b, c)
  // start with some strings
  // a,b,c can be anything supporting .toString()

cats = Cats.on(s)  // enables the following...
cats.addFromSource(i)
  // is equivalent to cats.add(s[i]), except that
  //   cats.addFromSource(i); cats.addFromSource(i + 1)
  // is faster than
  //   cats.add(s[i]); cats.add(s[i + 1])

*/
class Cats {

  constructor() {
    this.parts = [];
    this.source = null;
    this.pending = null;
  }

  static of(...parts) {
    const cats = new Cats();
    cats.parts = parts;
    return cats;
  }

  static on(source) {
    const cats = new Cats();
    cats.source = source;
    return cats;
  }

  clone() {
    const c = new Cats();
    c.source = this.source;
    c.parts = [...this.parts];
    if (this.pending)
      c.pending = [...this.pending];
  }

  add(...ss) {
    this._resolve();
    for (const s of ss)
      if (s)
        this.parts.push(s);
  }

  _resolve() {
    if (this.pending) {
      const [i, j] = this.pending;
      this.parts.push(this.source.slice(i, j));
      this.pending = null;
    }
  }

  addFromSource(i) {
    if (!this.source)
      throw Error("Cannot addFromSource on Cats with no source")

    if (this.pending && this.pending[1] + 1 === i) {
      this.pending[1]++;
    } else {
      this._resolve();
      this.pending = [i, i + 1];
    }
  }

  toString() {
    this._resolve();
    return this.parts.map(c => c.toString()).join('');
  }

}


function withHtmlTemplate(html) {
  return String.raw`

<!DOCTYPE HTML>
<html>
  <head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
  </head>
<body>

<style>

body {
  margin: 0;
  font-size: 0;
}

main {
  white-space: pre-wrap;
  font-size: 14px;
  font-family: 'Merriweather', serif;
}

code {
  border: 1px solid rgb(200, 200, 200);
  padding: 0px 2px;
  background-color: rgb(240, 240, 240);
  border-radius: 2px;
}

</style>

${annotationsImplementation}

<main>${html}</main>

</body>
</html>

`;
}

const annotationsImplementation = String.raw`

<style>

.annotation-reference:before { content: '['; }
.annotation-reference:after { content: ']'; }

.annotation-reference:before,
.annotation-reference:after,
.annotation-reference
{
  color: #C06;
  cursor: pointer;
}

.annotation-reference.active:before,
.annotation-reference.active:after,
.annotation-reference.active
{
  font-weight: bold;
}

.annotation-definition {
  background: rgba(200, 200, 200, 0.2);
  padding: .5em 1em;
  margin: .5em 0;
  border: 1px solid #C06;
  border-radius: 3px;
}

.annotation-definition:not(.revealed) {
  display: none;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  const $defs = {};
  for (const $def of document.querySelectorAll('.annotation-definition')) {
    $defs[$def.dataset.name] = $def;
  }

  for (const $ref of document.querySelectorAll('.annotation-reference')) {
    $ref.addEventListener('click', () => {
      const name = $ref.dataset.refersTo;
      const $def = $defs[name];

      if (!$def) {
        console.warn('Unable to find annotation definition with name', name);
        return;
      }

      if ($def.classList.contains('revealed')) {
        $def.classList.remove('revealed');
        $ref.classList.remove('active');
      } else {
        $def.classList.add('revealed');
        $ref.classList.add('active');
      }
    });
  }

});

</script>

`;


// indexOf but on fail return str.length instead of -1
function indexOf(str, sub, from = 0) {
  let result = str.indexOf(sub, from);
  if (result === -1) result = str.length;
  return result;
}

export function renderTeX(tex) {
  return cache.at([renderTeX, tex], () => {
    return withTempDir(tmp => {

      console.log(`Rendering LaTeX [${tex.length}]`);

      fs.writeFileSync(plib.resolve(tmp, 'it.tex'), tex);

      const cmd = String.raw`
        cd ${tmp} \
        && latex it.tex 1>&2 \
        && dvisvgm it.dvi \
        && { cat it-1.svg | tail -n+3; }
      `;

      let result;
      try {
        result = child_process.execSync(cmd).toString();
      } catch (err) {
        console.log(err.stderr.toString());  // meh
        throw 'tikz render failed; see above!';
      }

      console.log(`Rendering LaTeX [done] [${tex.length}]`);
      return result;

    });
  });
}

function ruled(s, pref='>|') {
  const bar = '------';
  return [bar, ...s.toString().split('\n').map(l => pref + l.replace(/ /g, '.')), bar].join('\n');
}
