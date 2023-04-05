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

  % category names
  \newcommand{\cat}[1]{{ \sf{#1} }}

  % more shorthands
  \newcommand{\floor}[1]{ { \lfloor {#1} \rfloor } }
  \newcommand{\ceil}[1]{ { \lceil {#1} \rceil } }
  \newcommand{\ol}[1]{ \overline{#1} }
  \newcommand{\t}[1]{ \text{#1} }
  \newcommand{\norm}[1]{ { \lvert {#1} \rvert } }  % norm/magnitude
  \newcommand{\card}{ \t{cd} }  % cardinality
  \newcommand{\dcup}{ \sqcup }  % disjoint untion
  \newcommand{\tup}[1]{ \langle {#1} \rangle }  % tuples

  % turing machines
  \newcommand{\halts}{ {\downarrow} }
  \newcommand{\loops}{ {\uparrow} }

  % represents an anonymous parameter
  % eg. $f(\apar)$ usually denotes the function $x \mapsto f(x)$
  \newcommand{\apar}{ {-} }

  % reverse-order composition
  %\newcommand{\then}{ \operatorname{\ ;\ }  }
  \newcommand{\then}{ {\scriptsize\ \rhd\ }  }

  % Like f' represents "f after modification", \pre{f}
  % represents "f before modification"
  \newcommand{\pre}[1]{{ \small ${backtick}{#1} }}

  % hook arrows
  \newcommand{\injects}{ \hookrightarrow }
  \newcommand{\embeds}{ \hookrightarrow }
  \newcommand{\surjects}{ \twoheadrightarrow }
  \newcommand{\projects}{ \twoheadrightarrow }

  % good enough definition of yoneda
  \newcommand{\yo}{よ}

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

  // Parses a KaTeX expression surrounded in either @@ or $$
  // If surrounded by $$, interprets the text as plain KaTeX
  // If surrounded by @@, first performs some preprocessing.
  // This preprocessing does several things; for instance, it
  // surrounds with \text{} all contiguous
  // sequence of characters which are both not preceded by a backslash
  // and of length greater than one.
  // For instance, maps
  //   '$\frac{Gr}{A(b)}$' to renderKaTeX('\frac{Gr}{A(b)}')
  //   '@\frac{Gr}{A(b)}@' to renderKaTeX('\frac{\text{Gr}}{A(b)}')

  // FIXME
  //   edge-case: words with a space should be \text{}-ified
  //   edge-case: '\\ word' should not be \text{}-ified

  if (!'$@'.includes(s.text[s.i])) return '';
  const sigil = s.text[s.i];

  const xi0 = s.i;
  s.i++;
  const body = p.local(s, s => {
    s.sentinel = s => (s.text.startsWith(sigil, s.i) || s.i >= s.text.length);
    return p.p_toplevel_verbatim(s);
  });
  p.p_take(s, sigil);
  const xif = s.i;

  const katex = sigil === '@' ? shorthandProcessing(body) : body;

  return mkKatex({
    katex: s.katexPrefix + '' + katex,
    displayMode: false,
    sourceText: s.text,
    sourceRange: [xi0, xif],
  });

}


function shorthandProcessing(s) {
  return (
    s
    .replace(/(?<!\\\s*[a-zA-Z]*)([a-zA-Z]{2,})/g, '\\text{$1}')  // FIXME: \operatorname would be better but as of right now breaks
    .replace(/(?<!\\\s*[a-zA-Z]+\s*)\{\\text\{([a-zA-Z]{2,})\}\}/g, '$1')
    .replace(/([-0-9]{2,})/g, '{$1}')
  );
}

// KaTeX
exports.commands.katex = katexImpl(false);

// Like \katex but defaults to shorthand=true
exports.commands.shatex = katexImpl(true);

function katexImpl(shorthandOptDefault) {
  return function(s) {

    const params = ppar.p_kvParams(s, {

      // Prepend to prelude?
      pre: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),

      // Wrap in \begin{align} \end{align}?
      align: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),

      // Wrap in \begin{gather} \end{gather}?
      gather: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),

      // Should we perform shorthand preprocessing?
      shorthand: ppar.p_arg_optionally(ppar.p_arg_bool, { default: shorthandOptDefault }),

    });

    const xi0 = s.i;
    let [katex, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
    const xif = s.i;

    if (params.shorthand) {
      katex = shorthandProcessing(katex);
    }

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
}

// TikZ
exports.commands.tikz = function(s) {

    // FIXME: '\tikz pre=y' should probably become its
    //   own \tex-pre command, because the prefix is shared b/w a
    //   number of different commands.
    //   And '\katex pre=y' should be \katex-pre for consistency.

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
      for (const part of gen) {
        result += part + '\\n';
      }
      return result;
    })();
  `);

  return mkTikZ({ prefix: s.texPrefix, tex, isBlock: true });
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

.katex {
  font-size: 1.15em;
}
.katex-display .katex {
  font-size: 1.21em;
}

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
  return mkTeX({
    prefix, isBlock,
    packages: String.raw`
      \usepackage{tikz}
    `,
    tex: String.raw`
      \begin{tikzpicture}

      % Default stylings
      \begin{scope}[
        >=latex
      ]

      ${tex}

      \end{scope}

      \end{tikzpicture}
    `,
  });
}

function mkTeX({ packages, prefix, tex, isBlock }) {

  return { children: [], toHtml };

  function toHtml(aff) {

    tex = String.raw`
      \documentclass[dvisvgm]{standalone}

      \usepackage{amsmath}
      \usepackage{amssymb}
      \usepackage{lmodern}

      ${packages}

      \def\pgfsysdriver{pgfsys-tex4ht.def}

      \usepackage[T1]{fontenc}

      \begin{document}

      ${prefix}

      ${tex}

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


// Embed q.uiver <iframe> export
exports.commands['quiver-embed'] =
function (s) {

  const params = ppar.p_kvParams(s, {
    downscale_percent: ppar.p_arg_optionally(ppar.p_arg_integer, { default: 1 }),
  });

  const body = p.p_block(s, p.p_toplevel_verbatim);

  let code = body;  // raw html
  code = code.replace('\n', '');
  const height = +code.match(/height="(\d+)"/)[1];
  const newHeight = (100 - params.downscale_percent) * height / 100;
  code = code.replace(`height="${height}"`, `height="${newHeight}"`);

  return code;

}


exports.prelude += String.raw`

<style>
.quiver-embed {
  width: 100%;
  border: 1px dotted lightgrey !important;
  border-radius: 0 !important;
  align-self: center
}

.quiver-embed:not(:hover) .logo {
  display: none;
}
</style>

`;


// Embed q.uiver tikzcd export
exports.commands['quiver-tikz'] =
function(s) {

  const idx0 = s.i;
  const body = p.p_block(s, p.p_toplevel_verbatim);
  const idxF = s.i;

  const tikz = body;  // tikzcd code

  s.quasi.env.env.log.warn(`Use of \\quiver-tikz, which is kinda broken cuz result diagrams are weirdly-padded and not centered`);

  return mkTeX({
    isBlock: true,
    prefix: s.texPrefix,
    packages: String.raw`
      \usepackage{tikz}
      \usepackage{quiver}
      \usetikzlibrary{cd}
    `,
    tex: tikz,
  });

}


