const libKatex = require('katex');
const child_process = require('child_process');
const plib = require('path');

const { squire } = require('../../../squire.js');
const repm = squire('../repm.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../../util.js');
const fss = squire('../../../fss.js');
const p = squire('../parse.js');

const backtick = '`';
const baseKatexPrelude = String.raw`
  % shorthands
  \newcommand{\cl}[1]{ \mathcal{#1} }
  \newcommand{\sc}[1]{ \mathscr{#1} }
  \newcommand{\bb}[1]{ \mathbb{#1} }
  \newcommand{\fk}[1]{ \mathfrak{#1} }
  \renewcommand{\bf}[1]{ \mathbf{#1} }
  \renewcommand{\sf}[1]{ \mathsf{#1} }

  \newcommand{\floor}[1]{ { \lfloor {#1} \rfloor } }
  \newcommand{\ceil}[1]{ { \lceil {#1} \rceil } }
  \newcommand{\ol}[1]{ \overline{#1} }
  \newcommand{\t}[1]{ \text{#1} }

  % magnitude etc
  \newcommand{\norm}[1]{ { \lvert {#1} \rvert } }

  % cardinality
  \newcommand{\card}{ \t{cd} }

  % disjoint untion
  \newcommand{\dcup}{ \sqcup }

  % represents an anonymous parameter
  % eg. $f(\apar)$ usually denotes the function $x \mapsto f(x)$
  \newcommand{\apar}{ {-} }

  % tuples
  \newcommand{\tup}[1]{ \langle {#1} \rangle }

  % reverse-order composition
  %\newcommand{\then}{ \operatorname{\ ;\ }  }
  \newcommand{\then}{ {\scriptsize\ \rhd\ }  }

  \newcommand{\pre}[1]{{ \small ${backtick}{#1} }}

  \newcommand{\injects}{ \hookrightarrow }
  \newcommand{\surjects}{ \twoheadrightarrow }

  % category names
  \newcommand{\cat}[1]{{ \bf{#1} }}
`;

exports.commands = {};
exports.parsers = [];
exports.stateInit = {
  // tex-related state
  katexPrefix: new Cats(baseKatexPrelude),
  texPrefix: new Cats(),
};

exports.parsers.push(p_katex);
function p_katex(s) {
  if (s.text[s.i] !== '$') return '';

  const xi0 = s.i;
  s.i++;
  const body = p.local(s, s => {
    s.sentinel = s => (s.text.startsWith('$', s.i) || s.i >= s.text.length);
    return p.p_toplevel_verbatim(s);
  });
  p.p_take(s, '$');
  const xif = s.i;

  return new Katex({
    katex: s.katexPrefix + '' + body,
    displayMode: false,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}

// KaTeX
exports.commands.katex = function(s) {
  p.p_spaces(s);

  const append = s.text.startsWith('pre', s.i);
  if (append) {
    p.p_take(s, 'pre');
    p.p_spaces(s);
  }

  const align = !!p.p_backtracking(s, s => {
    p.p_take(s, 'align');
    p.p_spaces(s);
    return true;
  });

  const gather = !!p.p_backtracking(s, s => {
    p.p_take(s, 'gather');
    p.p_spaces(s);
    return true;
  });

  const xi0 = s.i;
  let [katex, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
  const xif = s.i;

  if (append) {
    s.katexPrefix.add(katex);
    return '';
  }

  if (align)
    katex = `\\begin{align*} ${katex} \\end{align*}`;
  if (gather)
    katex = `\\begin{gather*} ${katex} \\end{gather*}`;
  katex = s.katexPrefix + '' + katex;

  const displayMode = { block: true, inline: false }[kind];
  return new Katex({
    katex,
    displayMode,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}

// TeX, TikZ
exports.commands.tikz = function(s) {
  p.p_spaces(s);

  const append = s.text.startsWith('pre', s.i);
  if (append) {
    p.p_take(s, 'pre');
    p.p_spaces(s);
  }

  let tex, kind;
  [tex, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);

  if (append) {
    s.texPrefix.add(tex);
    return '';
  }

  return new Tex({
    tex,
    isTikz: true,
    prefix: s.texPrefix,
    isBlock: kind === 'block'
  });
}

exports.commands['tikz-gen'] = function(s) {
  p.p_spaces(s);

  const script = p.p_block(s, p.p_toplevel_verbatim);

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

  return new Tex({ tex, isTikz: true, isBlock: true });
}


exports.prelude = String.raw`

<style>
.katex-display {
  margin: 0 !important;
}

/* Distinguish inline math from text
   Helps in cases where $\text{word}$ is used */
.katex { background: rgba(0, 0, 0, 0.035);  /* effective, but ugly */ }
.katex-display > .katex { background: none; }

.tikz {
  text-align: center;
  display: block;
  max-width: 100%;
}

.tikz > svg {
  max-width: 100%;
}
</style>

`;

const Katex =
exports.Katex =
class Katex {

  constructor({ katex, displayMode, sourceText, sourceRange }) {
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
        throw p.mkError(this.sourceText, this.sourceRange, text);
      }
    });
  }

  children() {
    return [];
  }

}


const Tex =
exports.Tex =
class Tex {

  constructor({ prefix, tex, isTikz, isBlock }) {
    this.prefix = prefix;
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

${this.prefix}

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

exports.prelude += String.raw`

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">

`;
