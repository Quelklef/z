const plib = require('path');
const child_process = require('child_process');

const clc = require('cli-color');
const hljs = require('highlight.js');
const libKatex = require('katex');

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
    env.parent.log.info('parsing for definitions', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: false,
    });
  });

  lazyAss(note, 'defines', () => {
    const rep = note[t].phase1;
    const defines = new Set();
    rep.traverse(node => {
      if (node instanceof Rep_Jargon) {
        for (const form of node.forms) {
          defines.add(form);
        }
      }
    });
    return defines;
  });

  lazyAss(note[t], 'phase2', () => {
    env.parent.log.info('parsing again!', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
    });
  });

  lazyAss(note, 'references', () => {
    const rep = note[t].phase2;
    const references = new Set();
    rep.traverse(node => {
      if (node instanceof Rep_Implicit) {
        references.add(node.toNote.id);
      } else if (node instanceof Rep_Explicit) {
        if (!!node.toNote)
          references.add(node.toNote.id);
      }
    });
    return references;
  });

  lazyAss(note, 'html', () => {
    const rep = note[t].phase2;

    const referencedBy = [...note.referencedBy].map(id => graph.notesById[id]);
    rep.traverse(node => {
      if (node instanceof Rep_ReferencedBy)
        node.setReferencedBy(referencedBy);
    });

    return rep.toHtml(env);
  });

  return note;
}




class Rep {

  // .toHtml : () -> string | Cats
  // .children : () -> Iterable<Rep>

  *tree() {
    for (const elem of this.children()) {
      if (typeof elem === 'string' || elem instanceof Cats) {
        yield elem;
      } else {
        yield elem;
        yield* elem.tree();
      }
    }
  }

  traverse(func) {
    for (const node of this.tree()) {
      func(node);
    }
  }

}


// TODO: instead of giving Rep_Seq .on and .of, etc, just have it accept a Cats ...?
class Rep_Seq extends Rep {

  constructor(...parts) {
    super();

    this.parts = parts;

    this.source = null;
    this.pending = null;
  }

  _resolve() {
    if (this.pending) {
      const [i, j] = this.pending;
      this.parts.push(this.source.slice(i, j));
      this.pending = null;
    }
  }

  static on(source) {
    const seq = new Rep_Seq();
    seq.source = source;
    return seq;
  }

  static of(...parts) {
    return new Rep_Seq(...parts);
  }

  add(...parts) {
    this._resolve();
    for (const part of parts)
      if (part !== '')
        this.parts.push(part);
  }

  addFromSource(i) {
    if (this.pending && this.pending[1] === i) {
      this.pending[1]++;
    } else {
      this._resolve();
      this.pending = [i, i + 1];
    }
  }

  // == //

  toHtml(env) {
    this._resolve();
    const html = new Cats();
    for (const part of this.parts) {
      if (typeof part === 'string') {
        html.add(part);
      } else if (part instanceof Cats) {
        html.add(part.toString());
      } else {
        html.add(part.toHtml(env));
      }
    }
    return html.toString();
  }

  children() {
    this._resolve();
    return this.parts;
  }

}


class Rep_Indented extends Rep {

  constructor({ indent, bulleted, body }) {
    super();
    this.indent = indent;
    this.bulleted = bulleted;
    this.body = body;
  }

  toHtml(env) {
    return Cats.of(
      '<div style="',
      `margin-left: ${this.indent}ch;`,
      'display: ' + (this.bulleted ? 'list-item' : 'block'),
      '">',
      this.body.toHtml(env),
      '</div>',
    );
  }

  children() {
    return [this.body];
  }

}


class Rep_Katex extends Rep {

  constructor({ katex, displayMode, sourceText, sourceRange }) {
    super();
    this.katex = katex;
    this.displayMode = displayMode;
    this.sourceText = sourceText;
    this.sourceRange = sourceRange;
  }

  toHtml(env) {
    return env.cache.at('katex', [this.katex, this.displayMode], () => {
      try {
        return libKatex.renderToString(this.katex, { displayMode: this.displayMode });
      } catch (e) {
        let text = e.toString();
        text = text.split('\n')[0];
        throw mkError(this.sourceText, this.sourceRange, text);
      }
    });
  }

  children() {
    return [];
  }

}


class Rep_Tex extends Rep {

  constructor({ tex, isTikz, isBlock }) {
    super();
    this.tex = tex;
    this.isTikz = isTikz;
    this.isBlock = isBlock;
  }

  toHtml(env) {
    let tex = this.tex;
    if (this.isTikz) {
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

    let html = env.cache.at('tex', [tex], () => {
      return fss.withTempDir(tmp => {

        env.log.info(`Rendering LaTeX [${tex.length}]`);

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
          env.log.info(err.stderr.toString());  // meh
          throw 'LaTeX render failed; see above!';  // TODO
        }

        env.log.info(`Rendering LaTeX [done] [${tex.length}]`);
        return result;

      });
    });

    if (this.isBlock)
      html = Cats.of('<div class="tikz">', html, '</div>');

    return html;
  }

  children() {
    return [];
  }

}


class Rep_Code extends Rep {

  constructor({ language, body, isBlock }) {
    super();
    this.language = language;
    this.body = body;
    this.isBlock = isBlock;
  }

  toHtml() {
    const highlighted =
      this.language !== null
          ? hljs.highlight(this.body, { language: this.language })
      : this.language === null && !this.isBlock
          ? hljs.highlight(this.body, { language: 'plaintext' })
      : this.language === null && this.isBlock
          ? hljs.highlightAuto(this.body)
      : impossible();

    return Cats.of(`<code class="${this.isBlock ? 'block' : 'inline'}">`, highlighted.value, '</code>');
  }

  children() {
    return [];
  }

}


class Rep_Jargon extends Rep {

  constructor({ forms, body }) {
    super();
    this.forms = forms;
    this.body = body;
  }

  toHtml(env) {
    return Cats.of(`<span class="jargon" data-forms="${[...this.forms].join(';')}">`, this.body.toHtml(env), '</span>');
  }

  children() {
    return [this.body];
  }

}


class Rep_Implicit extends Rep {

  constructor({ fromJargon, toNote, body }) {
    super();
    this.fromJargon = fromJargon;
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) {
      console.warn(`Bad jargon '${jarg}'!`);
    }
    const href = this.toNote?.href ?? '#';
    return Cats.of(`<a href="${href}" class="reference implicit ${!!this.toNote ? '' : 'invalid'}">`, this.body, '</a>');
  }

  children() {
    return [this.body];
  }

}


class Rep_Explicit extends Rep {

  constructor({ toNoteId, toNote, body }) {
    super();
    this.toNoteId = toNoteId,
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) env.log.warn(`Reference to nonexistent note '${this.toNoteId}'`);
    if (this.toNote)
      return Cats.of(`<a href="${this.toNote.href}" class="reference explicit">`, this.body.toHtml(), '</a>');
    else
      return Cats.of(`<a class="reference explicit invalid">`, this.body.toHtml(), '</a>');
  }

  children() {
    return [this.body];
  }
}


// Hacky but allows us to do rendering in 2 passes instead of 3
class Rep_ReferencedBy extends Rep {

  constructor() {
    super();
    this.referencedBy = null;
  }

  setReferencedBy(refBy) {
    this.referencedBy = refBy;
  }

  toHtml() {
    if (!this.referencedBy) return '';
    const html = new Cats();
    html.add('<br /><br />');
    html.add('<hr />');
    html.add('<p>Referenced by:</p>');
    html.add('<ul>');
    for (let refBy of this.referencedBy) {
      html.add(`<li><a href="${refBy.href}" class="reference">${refBy.id}</a></li>`);
    }
    html.add('</ul>');
    return html;
  }

  children() {
    return [];
  }

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

    // TODO: should the gensym/prefix/annotation/etc interpreting be moved
    //       into the semrep?

    clone() {
      const c = { ...this };
      c.indents = [...c.indents];
      c.annotNameQueue = [...c.annotNameQueue];
      c.katexPrefix = c.katexPrefix.clone();
      c.texPrefix = c.texPrefix.clone();
      return c;
    },

  };

  // Skip format header and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  if (s.text[s.i] === '\n') s.i++;

  const rep = new Rep_Seq();

  const done = s => s.i >= s.text.length;
  rep.add(p_toplevel_markup(s, done));

  rep.add(new Rep_ReferencedBy());

  return template(rep);

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
          p_implicitReference,
          p_escapes,
        ]
  );

  const result = Rep_Seq.on(s.text);

  if (done(s)) return result;

  parsing:
  while (true) {

    const [blockOver, advanceBy] = checkIndent(s);
    if (blockOver) break parsing;
    else s.i += advanceBy;

    const samp = sample_s(s);

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
    result.addFromSource(s.i);
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

    '<-->': '&xharr;',
    '-->': '&xrarr;',
    '<--': '&xlarr;',
    '<==>': '&xhArr;',
    '==>': '&xrArr;',
    '<==': '&xlArr;',

    '<->': '&harr;',
    '->': '&rarr;',
    '<-': '&larr;',
    '<=>': '&hArr;',
    '=>': '&rArr;',
    '<=': '&lArr;',

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
  const body = p_toplevel_markup(s);
  s.indents.pop();

  return new Rep_Indented({ indent: dIndent, bulleted, body });
}


function p_katex(s) {
  if (s.text[s.i] !== '$') return '';

  const xi0 = s.i;
  s.i++;
  const done = s => (s.text.startsWith('$', s.i) || s.i >= s.text.length);
  const body = p_toplevel_verbatim(s, done);
  consume(s, '$');
  const xif = s.i;

  return new Rep_Katex({
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

  chompSpace(s);

  const name = parseWord(s);

  const command = commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}


const commands = {

  // Title
  title(s) {
    return Rep_Seq.of('<div class="title">', p_block(s, p_toplevel_markup), '</div>');
  },

  // Section header
  sec(s) {
    return Rep_Seq.of('<div class="section-header">', p_block(s, p_toplevel_markup), '</div>');
  },

  // Italic
  i(s) {
    return Rep_Seq.of('<i>', p_inline(s, p_toplevel_markup), '</i>');
  },

  // Bold
  b(s) {
    return Rep_Seq.of('<b>', p_inline(s, p_toplevel_markup), '</b>');
  },

  // Underline
  u(s) {
    return Rep_Seq.of('<u>', p_inline(s, p_toplevel_markup), '</u>');
  },

  // Code
  c(s) { return commands.code(s); },
  code(s) {
    chompSpace(s);
    let language = /\w/.test(s.text[s.i]) ? parseWord(s).toString() : null;
    chompSpace(s);
    let [body, kind] = p_enclosed(s, p_toplevel_verbatim);
    return new Rep_Code({ language, body, isBlock: kind === 'block' });
  },

  // Comment (REMark)
  rem(s) {
    chompSpace(s);
    const [comment, _] = p_enclosed(s, p_toplevel_verbatim);
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

    return Rep_Seq.of(`<span class="annotation-reference" id="${s.gensym()}" data-refers-to="${name}">`, p_inline(s, p_toplevel_markup), '</span>');
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
        throw mkError(sx.text, sx.i, "Unpaired \\adef");
      name = s.annotNameQueue[0];
      s.annotNameQueue.splice(0, 1);
    }

    return Rep_Seq.of(`<div class="annotation-definition" data-name="${name}">`, p_block(s, p_toplevel_markup), '</div>');
  },

  // Explicit note reference
  ref(s) {
    const sx = s.clone();

    chompSpace(s);

    const toNoteId = backtracking(s, parseWord);
    if (!toNoteId) throw mkError(sx.text, sx.i, "Missing note ID");
    chompSpace(s);

    const sr = s.clone();
    sr.doImplicitReferences = false;
    const body = p_inline(sr, p_toplevel_markup);
    Object.assign(s, { ...sr, doImplicitReferences: s.doImplicitReferences });
      // ^ TODO: Technically, this is bugged!
      //         If a callee also sets doImplicitReferences=false, this will wrongly overwrite that.

    const toNote = s.graph.notesById[toNoteId];
    return new Rep_Explicit({ toNoteId, toNote, body });
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

    const doImplicitReferences = s.doImplicitReferences;
    const srec = { ...s.clone(), doImplicitReferences: false };
      // ^ Nested <a> tags are forbidden in HTML
    const body = p_inline(srec, p_toplevel_markup);
    Object.assign(s, { ...srec, doImplicitReferences });

    return Rep_Seq.of(`<a href="${href}" class="ext-reference" target="_blank">`, body, "</a>");
  },

  // KaTeX
  katex(s) {
    chompSpace(s);

    const append = s.text.startsWith('pre', s.i);
    if (append) {
      consume(s, 'pre');
      chompSpace(s);
    }

    const xi0 = s.i;
    const [body, kind] = p_enclosed(s, p_toplevel_verbatim);
    const xif = s.i;

    if (append) {
      s.katexPrefix.add(body);
      return '';
    }

    const displayMode = { block: true, inline: false }[kind];
    return new Rep_Katex({
      katex: s.katexPrefix + '' + body,
      displayMode,
      sourceText: s.text,
      sourceRange: [xi0, xif],
    });
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
    [tex, kind] = p_enclosed(s, p_toplevel_verbatim);

    if (append) {
      s.texPrefix.add(tex);
      return '';
    }

    tex = s.texPrefix + tex;
    return new Rep_Tex({ tex, isTikz: tikz, isBlock: kind === 'block' });
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

    // TODO: more reucurrence happening here!
    const doImplicitReferences = s.doImplicitReferences;
    const srec = { ...s.clone(), doImplicitReferences: false };
    const body = p_inline(srec, p_toplevel_markup);
    Object.assign(s, { ...srec, doImplicitReferences });

    return new Rep_Jargon({ forms, body });
  },


  // Experimenal execute command
  x(s) {
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
  },


  // tables
  table(s) {

    const xi0 = s.i;

    chompBlank(s);
    const opts = {};
    while (true) {
      const sb = s.clone();
      chompBlank(sb);
      if (!/[\w-]/.test(sb.text[sb.i])) break;
      Object.assign(s, sb);

      const key = parseWord(s);
      consume(s, '=');
      const val = parseWord(s);
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
      const ok = backtracking(s, s => {
        chompBlank(s);
        return consume(s, '|');
      });
      if (!ok) break;

      const row = [];
      while (true) {
        const cell = backtracking(s, s => {
          chompBlank(s);
          return p_inline(s, p_toplevel_markup);
        });
        if (cell === null) break;
        row.push(cell);
      }
      rows.push(row);
    }

    if (rows.length === 0)
      throw mkError(s.text, [xi0, s.i], "Empty table")

    let result = new Rep_Seq();
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
      result = new Rep_Seq('<center>', result, '</center>');

    return result;

  },

};


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

  return new Rep_Implicit({ fromJargon: jarg, toNote, body });
}


function parseJargon(s) {

  if (!s.text.startsWith('<', s.i))
    throw mkError(s.text, s.i, "Expected '<'");
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
        throw mkError(s.text, s.i, "Expected pipe");
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
}

function chompBlank(s) {
  while (/\s/.test(s.text[s.i])) s.i++;
}

function consume(s, str) {
  if (!s.text.startsWith(str, s.i))
    throw mkError(s.text, [s.i, s.i + str.length], `Expected '${str}'`);
  s.i += str.length;
  return str;
}

function parseWord(s) {
  const xi0 = s.i;
  let word = Cats.on(s.text);
  while (/[\w-]/.test(s.text[s.i])) {
    word.addFromSource(s.i);
    s.i++;
  }
  word = word.toString();
  if (!word)
    throw mkError(s.text, xi0, "Expected word");
  return word;
}

function backtracking(s, parser) {
  const sc = s.clone();
  let result;
  try {
    result = parser(sc);
  } catch (e) {
    return null;
  }
  Object.assign(s, sc);
  return result;
}


// Parse block or inline
function p_enclosed(s, p_toplevel) {
  if (s.text[s.i] === ':' || s.text.startsWith('==', s.i)) {
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
    const result = p_toplevel(srec, done);
    consume(srec, `==/${sentinel}==\n`);
    Object.assign(s, { ...srec, indents: s.indents });
    return result;
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
  consume(s, close);

  return r;
}


// mkError(text, idx, err)
// mkError(text, [i0, iF], err)  --  range [inc, exc]
function mkError(text, loc, err) {

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
      wrp = wrp.slice(0, wrpHlI0) + clc.yellow(wrp.slice(wrpHlI0, wrpHlIF)) + wrp.slice(wrpHlIF);

      const lineNo = wrpI === 0 ? lineNumber : lineNumberBlank;
      result.add('  ' + sigil + lineNo + clc(' │') + ' ' + wrp);
    });
  }
  result.add(strRep(' ', lineNumberingWidth + 0) + '─────┼─────\n');
  for (const wrp of wrapText('Error: ' + err))
    result.add('       │ ' + clc.yellow(wrp));
  result.add(strRep(' ', lineNumberingWidth + 0) + '─────┴─────\n');

  return Error('\n' + result.toString());

  function toCoords(idx) {
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



function template(html) {
  return new Rep_Seq(String.raw`

<!DOCTYPE HTML>
<html>
  <head>
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

/* Styling for references to other notes */
.reference, .reference:visited {
  color: initial;
}
.reference {
  background-color: rgba(var(--color-dynamic-rgb), .1);
  text-decoration: none;
}
.reference:not(.invalid):hover {
  background-color: rgba(var(--color-dynamic-rgb), .2);
}
.reference.explicit {
  border-bottom: 1px solid var(--color-dynamic);
}
.reference.invalid {
  color: red;
  cursor: not-allowed;
}

</style>

`,

annotationsImplementation,

jargonImplementation,

`

<main>`, html, `</main>

</body>
</html>

`);
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


// indexOf but on fail return str.length instead of -1
function indexOf(str, sub, from = 0) {
  let result = str.indexOf(sub, from);
  if (result === -1) result = str.length;
  return result;
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

function impossible() {
  throw Error('uh oh...');
}
