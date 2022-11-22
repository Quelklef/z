const libKatex = require('katex');
const child_process = require('child_process');
const plib = require('path');

const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

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
exports.prelude = '';
exports.stateInit = {
  // tex-related state
  katexPrefix: baseKatexPrelude,
  texPrefix: '',
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

  return mkKatex({
    katex: s.katexPrefix + '' + body,
    displayMode: false,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}

// KaTeX
exports.commands.katex = function(s) {

  const params = ppar.p_kvParams(s, {
    pre: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
    align: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
    gather: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
  });

  const xi0 = s.i;
  let [katex, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
  const xif = s.i;

  if (params.pre) {
    s.katexPrefix = s.katexPrefix + katex;
    return '';
  }

  if (params.align) {
    katex = `\\begin{align*} ${katex} \\end{align*}`;
  }

  if (params.gather) {
    katex = `\\begin{gather*} ${katex} \\end{gather*}`;
  }

  katex = s.katexPrefix + '' + katex;

  const displayMode = { block: true, inline: false }[kind];
  return mkKatex({
    katex,
    displayMode,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });
}

// TikZ
exports.commands.tikz = function(s) {

  const params = ppar.p_kvParams(s, {
    pre: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
  });

  let tex, kind;
  [tex, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);

  if (params.pre) {
    s.texPrefix = s.texPrefix.toString() + tex;
    return '';
  }

  return mkTikZ({
    tex,
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

  return mkTikZ({ tex, isBlock: true });
}


exports.prelude += String.raw`

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css" />

<style>

.katex-display {
  margin: 0 !important;
}

/* Distinguish inline math from text
   Helps in cases where $\text{word}$ is used */
.katex { background: rgba(0, 0, 0, 0.035);  /* effective, but ugly */ }
.katex-display > .katex { background: none; }

</style>

`;

function mkKatex({ katex, displayMode, sourceText, sourceRange }) {

  return { children: [], toHtml } ;

  function toHtml(aff) {
    try {
      return libKatex.renderToString(katex, { displayMode });
    } catch (exc) {
      let errMsg = exc.toString().split('\n')[0];
      throw p.mkError(sourceText, sourceRange, errMsg);
    }
  }

}


function mkTikZ({ prefix, tex, isBlock }) {

  return { children: [], toHtml };

  function toHtml(aff) {

    tex = String.raw`
      \documentclass[dvisvgm]{standalone}

      \usepackage{amsmath}
      \usepackage{amssymb}
      \usepackage{tikz}
      \usepackage{lmodern}

      \def\pgfsysdriver{pgfsys-tex4ht.def}

      \usepackage[T1]{fontenc}

      \begin{document}

      ${prefix}

      \begin{tikzpicture}
      ${tex}
      \end{tikzpicture}

      \end{document}
    `;

    let html = aff.cache.at('note-parts', ['tex', tex], () =>
      aff.fss.withTempDir(tmp => {

        aff.log.info(`Rendering LaTeX`);

        aff.fss.write(plib.resolve(tmp, 'it.tex'), tex);

        // NOTE: the --no-merge option to dvisvgm prevents Firefox from
        // choking on the resultant SVG.  (2022-11-21)
        const cmd = String.raw`
          cd ${tmp} \
          && latex it.tex 1>&2 \
          && dvisvgm it.dvi --no-merge \
          && { cat *.svg | tail -n+3; }
        `;

        let result;
        try {
          result = child_process.execSync(cmd).toString();
        } catch (exc) {
          const errMsg = exc.toString();
          aff.log.error(errMsg.toString());  // meh
          throw 'LaTeX render failed; see above!';  // TODO
        }

        return result;

      })
    );

    if (isBlock)
      html = '<div class="tikz">' + html + '</div>';

    return html;

  }

}

exports.prelude += String.raw`

<style>

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
