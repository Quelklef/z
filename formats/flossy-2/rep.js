const plib = require('path');
const child_process = require('child_process');

const hljs = require('highlight.js');
const libKatex = require('katex');


const { Cats, withTempDir } = require('../../util.js');
const fss = require('../../fss.js');

const { mkError } = require('./parsing.js');

const Rep =
exports.Rep =
class Rep {

  // Expected methods:
  // .toHtml : () -> string | Cats
  // .children : () -> Iterable<Rep>

  // Derived methods:

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


const Seq =
exports.Seq =
class Seq extends Rep {

  constructor(...parts) {
    super();
    this.parts = parts;
  }

  add(...parts) {
    for (const part of parts)
      if (part !== '')
        this.parts.push(part);
  }

  // == //

  toHtml(env) {
    return (
      this.parts
      .map(part => part.toHtml ? part.toHtml(env) : part.toString())
      .join('')
    );
  }

  children() {
    return this.parts;
  }

}


const Indented =
exports.Indented =
class Indented extends Rep {

  constructor({ indent, body }) {
    super();
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
class Bulleted extends Rep {

  constructor({ body, isNumbered, id }) {
    super()
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
class Expand extends Rep {

  constructor({ line, body, id }) {
    super()
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


const Katex =
exports.Katex =
class Katex extends Rep {

  constructor({ katex, displayMode, sourceText, sourceRange }) {
    super();
    this.katex = katex;
    this.displayMode = displayMode;
    this.sourceText = sourceText;
    this.sourceRange = sourceRange;
  }

  toHtml(env) {
    return env.cache.at('note-parts', ['katex', this.katex, this.displayMode], () => {
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


const Tex =
exports.Tex =
class Tex extends Rep {

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

    let html = env.cache.at('note-parts', ['tex', tex], () => {
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
          env.log.error(err.stderr.toString());  // meh
          throw 'LaTeX render failed; see above!';  // TODO
        }

        env.log.info(`Rendering LaTeX [done] [${tex.length}]`);
        return result;

      });
    });

    if (this.isBlock)
      html = new Cats('<div class="tikz">', html, '</div>');

    return html;
  }

  children() {
    return [];
  }

}


const Code =
exports.Code =
class Code extends Rep {

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

    return new Cats(`<code class="${this.isBlock ? 'block' : 'inline'}">`, highlighted.value, '</code>');
  }

  children() {
    return [];
  }

}


const Jargon =
exports.Jargon =
class Jargon extends Rep {

  constructor({ forms, body }) {
    super();
    this.forms = forms;
    this.body = body;
  }

  toHtml(env) {
    return new Cats(`<span class="jargon" data-forms="${[...this.forms].join(';')}">`, this.body.toHtml(env), '</span>');
  }

  children() {
    return [this.body];
  }

}


const Implicit =
exports.Implicit =
class Implicit extends Rep {

  constructor({ fromJargon, toNote, body }) {
    super();
    this.fromJargon = fromJargon;
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) {
      env.log.warn(`Bad jargon '${jarg}'!`);
    }
    const href = this.toNote?.href ?? '#';
    return new Cats(`<a href="${href}" class="reference implicit ${!!this.toNote ? '' : 'invalid'}">`, this.body, '</a>');
  }

  children() {
    return [this.body];
  }

}


const Explicit =
exports.Explicit =
class Explicit extends Rep {

  constructor({ toNoteId, toNote, body }) {
    super();
    this.toNoteId = toNoteId,
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) env.log.error(`Reference to nonexistent note '${this.toNoteId}'`);
    if (this.toNote)
      return new Cats(`<a href="${this.toNote.href}" class="reference explicit">`, this.body.toHtml(env), '</a>');
    else
      return new Cats(`<a class="reference explicit invalid">`, this.body.toHtml(env), '</a>');
  }

  children() {
    return [this.body];
  }
}

