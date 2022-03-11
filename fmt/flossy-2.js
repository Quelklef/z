const plib = require('path');
const child_process = require('child_process');

const hljs = require('highlight.js');
const katex = require('katex');

const { quire } = require('../quire.js');
const { lazyAss, Cats, withTempDir } = quire('../util.js');
const fss = quire('../fss.js');

exports.default =
function * (files, _, graph, env) {
  for (const floc of files) {
    const source = fss.read(floc);
    if (source.startsWith('format=flossy-2\n'))
      yield mkNote(floc, source, graph, env);
  }
}

const scriptSrc = fss.read(__filename).toString();

function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  env = env.descend();
  env.log.prefixes.push(noteId.toString());

  const note = {};

  note.source = source;
  note.source += '\n';  // allows parsers to assume lines end with \n

  note.cacheKeys = [floc, source, scriptSrc];

  note.id = noteId;

  // note[t] holds transient (non-cached) data
  const t = Symbol('fmt-proper.t');
  Object.defineProperty(note, t, { enumerable: false, value: {} });

  lazyAss(note[t], 'phase1', () => {
    env.parent.log.info('phase-1 parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: false,
    });
  });

  lazyAss(note, 'defines', () => {
    return note[t].phase1.defines;
  });

  lazyAss(note[t], 'phase2', () => {
    env.parent.log.info('phase-2 parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
    });
  });

  lazyAss(note, 'references', () => {
    return note[t].phase2.references;
  });

  lazyAss(note[t], 'phase3', () => {
    env.parent.log.info('phase-3 parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
    });
  });

  lazyAss(note, 'html', () => {
    return note[t].phase3.html.toString();
  });

  return note;
}


/*

Quick prelude on parsing

Parsers are expected to have the signature
  r = parser(s, ...args)

That is, they take some arguments and the current state s, and perform some
parsing, mutating the state s, and producing a result r.

If you want backtracking or lookahead, pass in s.clone().

Parsers fail by throwing.

*/


function parse({ text, note, graph, env, doImplicitReferences }) {

  // Initial parser state
  let s = {

    // Environmental references
    graph, note, env,

    // Source text
    text,

    // Index in text
    i: 0,

    // Indentation stack
    indents: [],

    // Set of terms this note defines
    defines: new Set(),

    // Set of notes this note references, as their IDs
    references: new Set(),

    doImplicitReferences,
    jargonMatcher: doImplicitReferences && new JargonMatcherJargonMatcher(graph.jargonSet, note.defines),

    // Symbol generation
    cursym: 0,
    gensym() {
      return 'gensym-' + (this.cursym++);
    },

    // annotation-related state
    annotNameQueue: [],

    // tex-related state
    katexPrefix: new Cats(),
    texPrefix: new Cats(),

    clone() {
      const c = { ...this };
      c.indents = [...c.indents];
      c.defines = new Set(c.defines);
      c.references = new Set(c.references);
      c.annotNameQueue = [...c.annotNameQueue];
      c.katexPrefix = c.katexPrefix.clone();
      c.texPrefix = c.texPrefix.clone();
      return c;
    },

  };

  // Skip format header and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  if (s.text[s.i] === '\n') s.i++;

  const html = new Cats();

  const done = s => s.i >= s.text.length;
  html.add(p_main(s, { done }));

  if (s.note.referencedBy) {
    html.add('<br /><br />');
    html.add('<hr />');
    html.add('<p>Referenced by:</p>');
    html.add('<ul>');
    for (let refBy of note.referencedBy) {
      refBy = graph.notesById[refBy];
      html.add(`<li><a href="${refBy.href}" class="reference">${refBy.id}</a></li>`);
    }
    html.add('</ul>');
  }

  return {
    defines: s.defines,
    references: s.references,
    html: withHtmlTemplate(html.toString()),
  };

}

function p_verbatim(s, args) {
  return p_main(s, { ...args, verbatim: true });
}

// Top-level parser
function p_main(s, args) {

  args ||= {};
  args.done ||= (_ => false);
  args.verbatim ||= false;

  const { done, verbatim } = args;

  const parsers = (
    verbatim
      ? []
      : [
          p_sigils,
          p_quotes,
          p_katex,
          p_indent,
          p_command,
          p_implicitReference,
          p_escapes,
        ]
  );

  const html = Cats.on(s.text);

  if (done(s)) return '';

  parsing:
  while (true) {

    const [blockOver, advanceBy] = checkIndent(s);
    if (blockOver) break parsing;
    else s.i += advanceBy;

    // Try each parser
    for (const parser of parsers) {
      const i0 = s.i;
      html.add(parser(s));
      if (s.i !== i0)
        continue parsing;
    }

    // All parsers tried
    // Break out to caller
    if (done(s))
      break parsing;

    // Out of text but not yet done()
    if (s.i >= s.text.length)
      throw mkError(s, "Unexpected EOF!");

    // Default case: advance by one character
    html.addFromSource(s.i);
    s.i++;
  }

  return html;

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
    if (line.trim() !== '')
      return line;
  }
  return null;
}


// Sigils: static replacements
function p_sigils(s) {

  const mapping = {
    '---\n': '<hr />',
    '***\n': '<hr />',

    '--': '&mdash;',
  };

  for (const [key, val] of Object.entries(mapping)) {
    if (s.text.startsWith(key, s.i)) {
      s.i += key.length;
      return val;
    }
  }

  return '';

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

  const bulleted = s.text.startsWith('- ', s.i);
  if (bulleted)
    dIndent += 2;

  // If line not further indented, bail
  if (dIndent <= 0)
    return '';

  const newIndent = curIndent + dIndent;
  // Parse as indented block
  s.i += newIndent - curIndent;
  s.indents.push(newIndent);
  const body = p_main(s);
  s.indents.pop();

  return Cats.of(
    '<div style="',
    `margin-left: ${dIndent}ch;`,
    `display: ${bulleted ? 'list-item' : 'block'}`,
    '">',
    body,
    '</div>'
  );
}


function p_katex(s) {
  if (s.text[s.i] !== '$') return '';

  s.i++;
  const sx = s.clone();
  const done = s => (s.text.startsWith('$', s.i) || s.i >= s.text.length);
  const body = p_verbatim(s, { done });
  s.i++;

  try {
    const full = s.katexPrefix + '' + body;
    return renderKaTeX(s, full, false)
  } catch (e) {
    let text = e.toString();
    text = text.split('\n')[0];
    throw mkError(sx, text);
  }
}



// Execute a backslash command
function p_command(s) {
  if (s.text[s.i] !== '\\') return '';

  const sx = s.clone();
  s.i++;

  chompSpace(s);

  const name = parseWord(s).toString();

  if (name === '')
    throw mkError(sx, "Expected command name");

  const command = commands[name];
  if (!command)
    throw mkError(sx, `No command '${name}'!`);

  return command(s);
}


const commands = {

  // Title
  title(s) {
    return Cats.of('<div style="color: #C06; font-size: 18px; margin-bottom: 1em">', p_block(s), '</div>');
  },

  // Section header
  sec(s) {
    return Cats.of('<div style="color: #C06; border-bottom: 1px dotted #C06">', p_block(s), '</div>');
  },

  // Italic
  i(s) {
    return Cats.of('<i>', p_inline(s), '</i>');
  },

  // Bold
  b(s) {
    return Cats.of('<b>', p_inline(s), '</b>');
  },

  // Underline
  u(s) {
    return Cats.of('<u>', p_inline(s), '</u>');
  },

  // Code
  c(s) { return commands.code(s); },
  code(s) {
    chompSpace(s);
    let language = /\w/.test(s.text[s.i]) ? parseWord(s).toString() : null;
    chompSpace(s);

    let [body, kind] = p_enclosed(s, { verbatim: true });
    body = body.toString();

    const highlighted =
      language !== null
          ? hljs.highlight(body, { language })
      : language === null && kind === 'inline'
          ? hljs.highlight(body, { language: 'plaintext' })
      : language === null && kind === 'block'
          ? hljs.highlightAuto(body)
      : null;

    return Cats.of(`<code class="${kind}">`, highlighted.value, '</code>');
  },

  // Comment (REMark)
  rem(s) {
    chompSpace(s);
    const [comment, _] = p_enclosed(s, { verbatim: true });
    return '';
  },

  // Annotation reference
  aref(s) {
    chompSpace(s);

    let name;
    if (!"[{(<:".includes(s.text[s.i])) {
      name = parseWord(s).toString();
    } else {
      name = s.gensym();
      s.annotNameQueue.push(name);
    }

    chompSpace(s);

    return Cats.of(`<span class="annotation-reference" id="${s.gensym()}" data-refers-to="${name}">`, p_inline(s), '</span>');
  },

  // Annotation definition
  adef(s) {
    const sx = s.clone();

    chompSpace(s);

    let name;
    if (!"[{(<:=".includes(s.text[s.i])) {
      name = parseWord(s);
      chompSpace(s);
    } else {
      if (s.annotNameQueue.length === 0)
        throw mkError(sx, "Unpaired \\adef");
      name = s.annotNameQueue[0];
      s.annotNameQueue.splice(0, 1);
    }

    return Cats.of(`<div class="annotation-definition" data-name="${name}">`, p_block(s), '</div>');
  },

  // Explicit note reference
  ref(s) {
    const sx = s.clone();

    chompSpace(s);

    const noteId = parseWord(s).toString();
    if (!noteId) throw mkError(sx, "Missing note ID");

    chompSpace(s);

    const ref = s.graph.notesById[noteId];
    if (!ref) s.env.log.warn(`Reference to nonexistent note '${noteId}'`);
    else s.references.add(ref.id);

    const sr = s.clone();
    sr.doImplicitReferences = false;
    const body = p_inline(sr);
    Object.assign(s, { ...sr, doImplicitReferences: s.doImplicitReferences });
      // ^ TODO: Technically, this is bugged!
      //         If a callee also sets doImplicitReferences=false, this will wrongly overwrite that.

    const href = ref ? ref.href : '';
    if (ref)
      return Cats.of(`<a href="${ref.href}" class="reference explicit">`, body, '</a>');
    else
      return Cats.of(`<a class="reference explicit invalid">`, body, '</a>');
  },

  // External (hyper-)reference
  href(s) {
    chompSpace(s)
    consume(s, '<');
    const href = Cats.on(s.text);
    while (s.i < s.text.length && s.text[s.i] !== '>') {
      href.addFromSource(s.i);
      s.i++;
    }
    consume(s, '>');
    chompSpace(s)

    const body = p_inline(s);
    return Cats.of(`<a href="${href}" class="ext-reference" target="_blank">`, body, "</a>");
  },

  // KaTeX
  katex(s) {
    chompSpace(s);

    let append = s.text.startsWith('pre', s.i);
    if (append) {
      consume(s, 'pre');
      chompSpace(s);
    }

    const [body, kind] = p_enclosed(s, { verbatim: true });

    if (append) {
      s.katexPrefix.add(body);
      return '';
    }

    const displayMode = { block: true, inline: false }[kind];
    const full = s.katexPrefix + '' + body;
    const rendered = renderKaTeX(s, full, displayMode);
    return rendered;
  },

  // TeX, TikZ
  tikz(s) { return commands.tex(s, true); },
  tex(s, tikz = false) {
    chompSpace(s);

    let append = s.text.startsWith('pre', s.i);
    if (append) {
      consume(s, 'pre');
      chompSpace(s);
    }

    let tex, kind;
    [tex, kind] = p_enclosed(s, { verbatim: true });

    if (append) {
      s.texPrefix.add(tex);
      return '';
    }

    tex = s.texPrefix + tex;

    if (tikz) {
      tex = String.raw`
\begin{tikzpicture}
${tex}
\end{tikzpicture}
`;
    }

    tex = String.raw`
\documentclass{standalone}

\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{tikz}
\usepackage{lmodern}

\usepackage[T1]{fontenc}

\begin{document}

${tex}

\end{document}
`;

    let html = renderTeX(tex, s);
    if (kind === 'block') html = Cats.of('<div style="display: block; text-align: center;">', html, '</div>');
    return html;
  },


  // Jargon
  jarg(s) {

    let forms = new Set();
    while (true) {
      chompSpace(s);
      if (!s.text.startsWith('<', s.i)) break;
      const jargs = parseJargon(s);
      forms = new Set([...forms, ...jargs]);
    }
    s.defines = new Set([...s.defines, ...forms]);

    // TODO: more reucurrence happening here!
    const doImplicitReferences = s.doImplicitReferences;
    const srec = { ...s.clone(), doImplicitReferences: false };
    const result = Cats.of(`<span class="jargon" data-forms="${[...forms].join(';')}">`, p_inline(srec), '</span>');
    Object.assign(s, { ...srec, doImplicitReferences });
    return result;
  },


  // Experimenal execute command
  x(s) {
    s.env.log.warn(`use of \\x`);

    const [body, kind] = p_enclosed(s, { verbatim: true });

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
      const result = p_main(srec, s => s.i >= s.text.length);
      Object.assign(s, {
          ...srec,
          text: s.text,
          i: s.i,
      });
      return result;
    };

    return eval(code) || '';
  },

};


// Jargon-lead implicit references
function p_implicitReference(s) {
  if (!s.doImplicitReferences) return '';
  const r = s.jargonMatcher.findMeAMatch(s.text, s.i);
  if (r === null) return '';

  const [jarg, stepAmt] = r;
  const defNotes = s.graph.jargonToDefiningNoteSet[jarg];

  let href;
  let isValid;
  if (defNotes && defNotes.size > 0) {
    isValid = true;
    const defNote = [...defNotes][0];  // TODO
    href = defNote.href;
    s.references.add(defNote.id);
  } else {
    isValid = false;
    console.warn(`Bad jargon '${jarg}' in note '${s.note.id}'!`);
    href = '#';
  }

  const body = escapeHtml(s.text.slice(s.i, s.i + stepAmt));
  s.i += stepAmt;
  return `<a href="${href}" class="reference implicit ${isValid ? '' : 'invalid'}">${body}</a>`;;
}


function parseJargon(s) {

  if (!s.text.startsWith('<', s.i))
    throw mkError(s, "Expected '<'");
  s.i++;

  const parts = [['']];
  while (true) {
    if (s.text.startsWith('>', s.i)) {
      s.i++;
      break;
    }
    parts.push(parseJargonAux(s));
  }

  let result = [''];
  for (const part of parts)
    result = result.flatMap(j => part.map(p => j + p));
  return result;

}

function parseJargonAux(s) {

  // Noun combinator -- N:noun
  if (s.text.startsWith('N:', s.i)) {
    s.env.log.warn('use of deprecated N: combinator in jargon');
    s.i += 2;
    return parseJargonAux(s).flatMap(j => {
      j = j.toString();
      if (j.endsWith('y'))
        return [j, j.slice(0, j.length - 1) + 'ies'];
      else if (j.endsWith('s'))
        return [j];
      else
        return [j, j + 's'];
    });
  }

  // Disjunctive combinator -- (this|that)
  if (s.text.startsWith('(', s.i)) {
    s.i++;
    const choices = [];
    while (true) {
      const choice = parseJargonAux(s);
      choices.push(choice);
      if (s.text.startsWith(')', s.i)) {
        s.i++;
        break;
      } else if (s.text.startsWith('|', s.i)) {
        s.i++;
      } else {
        throw mkError(s, "Expected pipe");
      }
    }
    return parseJargonAux(s).flatMap(suff => choices.flat().map(pre => pre + suff));
  }

  // Quoted syntax -- "word with some spaces"
  else if (s.text.startsWith('"', s.i)) {
    const word = Cats.on(s.text);
    s.i++;
    loop: while (true) {
      switch (s.text[s.i]) {
        case "\\":
          word.addFromSource(s.i + 1);
          s.i += 2;
          break;

        case "\"":
          s.i ++;
          break loop;

        default:
          word.addFromSource(s.i);
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
    return parseJargonAux(s).map(j => char + j);
  }

}

function chompSpace(s) {
  while (s.text[s.i] === ' ') s.i++;
  return s;
}

function consume(s, str) {
  if (!s.text.startsWith(str, s.i))
    throw mkError(s, `Expected '${str}'`);
  s.i += str.length;
}

function parseWord(s) {
  let word = Cats.on(s.text);
  while (/[\w-]/.test(s.text[s.i])) {
    word.addFromSource(s.i);
    s.i++;
  }
  word = word.toString();
  if (!word)
    throw mkError(s, "Expected word");
  return word;
}


// Parse block or inline
function p_enclosed(s, p_main_args) {
  if (s.text[s.i] === ':' || s.text.startsWith('==', s.i)) {
    const r = p_block(s, p_main_args);
    return [r, 'block'];
  } else {
    const r = p_inline(s, p_main_args);
    return [r, 'inline'];
  }
}

function p_block(s, p_main_args = {}) {

  if (s.text[s.i] === ':') {
    s.i++;

    const eol = indexOf(s.text, '\n', s.i);

    // \cmd: <stuff>
    if (s.text.slice(s.i + 1, eol).trim() !== '') {
      if (s.text[s.i] === ' ') s.i++;
      const done = s => ['\n', undefined].includes(s.text[s.i]);
      const r = p_main(s, { ...p_main_args, done });
      s.i++;  // skip newline
      return r;

    // \cmd:\n <stuff>
    } else {
      s.i = eol + 1;

      const nnel = getNextNonemptyLine(s.text, s.i);
      const nnelIndent = nnel.length - nnel.trimLeft().length;
      const currentIndent = s.indents[s.indents.length - 1] || 0;
      if (nnelIndent <= currentIndent)
        throw mkError(s, "Expected indent after colon");

      s.indents.push(nnelIndent);
      const result = p_main(s, { ...p_main_args });
      s.indents.pop();
      return result;
    }
  }

  else if (s.text.startsWith('==', s.i)) {
    consume(s, '==');

    let sentinel = Cats.on(s.text);
    while (!s.text.startsWith('==', s.i)) {
      sentinel.addFromSource(s.i);
      s.i++;
    }

    consume(s, '==');
    chompSpace(s);
    consume(s, '\n');

    const srec = { ...s.clone(), indents: [] };
    const done = s => s.text[s.i - 1] === '\n' && s.text.startsWith(`==/${sentinel}==\n`, s.i);
    const result = p_main(srec, { ...p_main_args, done });
    consume(srec, `==/${sentinel}==\n`);
    Object.assign(s, { ...srec, indents: s.indents });
    return result;
  }

  else {
    throw mkError(s, 'Expected colon or double-equals');
  }

}

function p_inline(s, p_main_args = {}) {
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
    throw mkError(s, "Expected group: [], (), {}, or <>");
  s.i++;

  const done = s => s.text.startsWith(close, s.i);
  const r = p_main(s, { ...p_main_args, done })
  consume(s, close);

  return r;
}


function mkError(s, err) {

  const linesAround = 2;
  let i0 = s.i, iF = s.i;
  for (let lines = 0; i0 >= 0            && lines <= linesAround; i0--) lines += s.text[i0 - 1] === '\n';
  for (let lines = 0; iF < s.text.length && lines <= linesAround; iF++) lines += s.text[iF + 1] === '\n';
  const block = s.text.slice(i0 + 1, iF);

  let lineno = s.text.slice(0, i0 + 1).split('\n').length + 1;

  const lines = block.split('\n');
  const linenoStrLen = (lineno + lines.length + '').length;

  const msg = new Cats();
  msg.add(' ─', strRep('─', linenoStrLen), '─┬─╴')
  msg.add('  Error! ', err, '\n');
  lines.forEach((line, lidx) => {
    const start = i0 + 1 + lines.slice(0, lidx).map(ln => (ln + '\n').length).reduce((a, b) => a + b, 0);
    const end = start + line.length;
    const isTheLine = start <= s.i && s.i <= end;
    const marker = isTheLine ? '▶' : ' ';

    const linenoStr = (lineno + '').padStart(linenoStrLen, ' ');

    msg.add(' ' + marker + ' ' + linenoStr + '│ ' + line + '\n');
    if (isTheLine) {
      const column = s.i % start;
      msg.add(strRep(' ', 1 + '▶'.length + 1 + linenoStrLen), '│ ', strRep(' ', column), '▲', '\n');
    }
    lineno++;
  });
  msg.add(' ─', strRep('─', linenoStrLen), '─┴─╴')

  return Error('\n' + msg.toString());


  function strRep(s, n) {
    let r = ''; while (n--) r += s; return r;
  }

}



function withHtmlTemplate(html) {
  return String.raw`

<!DOCTYPE HTML>
<html>
  <head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.4.0/styles/github.min.css">
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
  line-height: 1.5em;
}

code {
  border: 1px solid rgb(200, 200, 200);
  background-color: rgb(245, 245, 245);
  border-radius: 2px;
}
code.inline {
  display: inline;
  padding: 0px 2px;
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

/* Styling for references to other notes */
.reference {
  background-color: hsla(330, 75%, 85%, .25);
  text-decoration: none;
}
.reference:not(.invalid):hover {
  background-color: hsla(330, 75%, 70%, .50);
}
.reference, .reference:visited { color: initial; }
.reference.explicit {
  border-bottom: 1px solid #C06;
}
.reference.invalid {
  color: red;
  cursor: not-allowed;
}

</style>

${annotationsImplementation}

${jargonImplementation}

<main>${html}</main>

</body>
</html>

`;
}

const annotationsImplementation = String.raw`

<style>

* { box-sizing: border-box; }

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
  background: rgba(250, 250, 250);
  box-shadow: 0 0 8px -2px rgba(0, 0, 0, 0.15);
  border: 1px solid #C06;
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
  let expandedRefs = new Set();

  function urlToState() {
    const url = new URL(window.location.href);
    expandedRefs = new Set(url.searchParams.get('expanded-refs')?.split(';') || []);
  }

  function stateToUrl() {
    const url0 = new URL(window.location.href);
    url0.searchParams.set('expanded-refs', [...expandedRefs].join(';'));
    window.history.pushState(null, '', url0.toString());
  }

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

  for (const $ref of document.querySelectorAll('.annotation-reference')) {
    $ref.addEventListener('click', () => {
      const isExpanded = expandedRefs.has($ref.id);
      if (isExpanded) expandedRefs.delete($ref.id);
      else expandedRefs.add($ref.id);

      stateToDom();
      stateToUrl();
    });
  }

  urlToState();
  stateToDom();

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
  border: 1px solid #C06;
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


class JargonMatcherJargonMatcher {
  constructor(jargs, exclude) {
    const signifChars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    this.isSignif = c => signifChars.has(c);
    this.normalize = s => [...s.toLowerCase()].filter(c => this.isSignif(c) || c === '$').join('');
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


// indexOf but on fail return str.length instead of -1
function indexOf(str, sub, from = 0) {
  let result = str.indexOf(sub, from);
  if (result === -1) result = str.length;
  return result;
}

function renderTeX(tex, s) {
  return s.env.cache.at('tex', [renderTeX, tex], () => {
    return fss.withTempDir(tmp => {

      s.env.log.info(`Rendering LaTeX [${tex.length}]`);

      fss.write(plib.resolve(tmp, 'it.tex'), tex);

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
        s.env.log.info(err.stderr.toString());  // meh
        throw mkError(s, 'LaTeX render failed; see above!');
      }

      s.env.log.info(`Rendering LaTeX [done] [${tex.length}]`);
      return result;

    });
  });
}

function renderKaTeX(s, tex, displayMode) {
  return s.env.cache.at('katex', [renderKaTeX, tex, displayMode], () => {
    return katex.renderToString(tex, { displayMode });
  });
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
