/*

Legacy format, only exists for compatibility reasons.

*/

const plib = require('path');
const child_process = require('child_process');

const katex = require('katex');

const { quire } = require('../quire.js');
const { lazyAss, Cats } = quire('../util.js');
const fss = quire('../fss.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();

// Symbol for transient data on note
const t = Symbol('fmt-legacy.t');

function mkNote(floc, source, graph, env) {

  const note = {};

  note.floc = floc;

  // Is it a Roam Research export?
  note.isRoam = /\/[0-9]{20}r.z$/.test(note.floc);

  note.source = source;

  note.defines = extract(note.source, '[:', ':]');

  note.id = plib.basename(note.floc, '.z');

  env = env.descend();
  env.log.prefixes.push(note.id.toString());

  note.cacheKeys = [floc, source, scriptSrc];

  // lazy attrs:
  //  .references (need graph.jargonSet)
  //  .html (need note.popularity)

  Object.defineProperty(note, t, { enumerable: false, value: {} });

  lazyAss(note[t], 'initialHtmlAndReferenceSet', () => {

    env.parent.log.info(`rendering`, note.id);

    let jtrie;
    jtrie = setMinus(graph.jargonSet, note.defines)
    jtrie = new Set([...jtrie].map(j_norm));
    jtrie = new Trie(jtrie);

    const referenceSet = new Set();

    let i = 0;
    const html = new Cats();

    // Skip format header and optional newline
    i += 'format=compat-1\n'.length;
    if (note.source[i] === '\n') i++;

    loop:
    while (i < note.source.length) {

      // latex
      {
        const literalDelims = [
          ['$$', '$$'],  // inline latex
          ['$[', ']$'],  // block latex
        ];
        for (const elem of literalDelims) {
          const [open, close] = elem;
          let content;
          [i, content] = chompDelimited(note.source, i, open, close);
          if (content !== null) {
            const displayMode = { '$$': false, '$[': true }[open];
            html.add(katex.renderToString(content, { displayMode }));
            continue loop;
          }
        }
      }

      // Definitions
      defn:
      if (note.source.startsWith('[:', i)) {
        const j = note.source.indexOf(':]', i + 2);
        if (j === -1) break defn;
        html.add(note.source.slice(i, j + 2));
        i = j + 2;
        continue loop;
      }

      roam_span:
      if (note.source.startsWith('__', i) || note.source.startsWith('**', i)) {
        const delim = note.source.slice(i, i + 2);
        let end = note.source.indexOf(delim, i + 2);
        if (end === -1) end = note.source.length;
        const content = note.source.slice(i + 2, end);
        const tag = { '__': 'i', '**': 'b' }[delim];
        html.add(`<${tag}>${content}</${tag}>`);
        i = end + 2;
      }

      roam_code_block:
      if (note.source.startsWith('```', i)) {
        let end = note.source.indexOf('```', i + 3);
        if (end === -1) end = note.source.length;
        const content = note.source.slice(i + 3, end);
        html.add(`<div style="white-space:pre;background:rgba(0,0,0,0.05);padding:1em;">${content}</div>`);
        i = end + 3;
      }

      roam_code_inline:
      if (note.source.startsWith('`', i)) {
        let end = note.source.indexOf('`', i + 1);
        if (end === -1) end = note.source.length;
        const content = note.source.slice(i + 1, end);
        html.add(`<span style="white-space:pre;background:rgba(0,0,0,0.05);">${content}</span>`);
        i = end + 1;
      }

      bullet:
      if ('-*'.includes(note.source[i])) {
        for (let j = i - 1; j >= 0; j--) {
          if (note.source[j] === '\n') break;
          if (note.source[j] !== ' ') break bullet;
        }
        html.add('&bull;');
        i++;
      }

      span:
      if (note.source.startsWith('\\', i) && !note.source.startsWith('\\\\', i)) {
        const pairs = {
          '[': ']',
          '(': ')',
          '<': '>',
          '{': '}',
          '$': '$',
          '::': ';;',
        };

        let j = i, open, close;
        done: while (!open) {
          for (const elem of Object.entries(pairs)) {
            const [left, right] = elem;
            if (note.source.startsWith(left, j)) {
              [open, close] = [left, right];
              break done;
            }
          }
          j++;
        }

        const tag = note.source.slice(i + '\\'.length, j);

        const k = note.source.indexOf(close, j + open.length);
        if (k === -1) break span;
        const content = note.source.slice(j + open.length, k);

        html.add(
            tag === 'i' ? `<i>${content}</i>`
          : tag === 'b' ? `<b>${content}</b>`
          : tag === 'c' ? `<code style="background: rgba(0, 0, 0, 0.1)">${content}</code>`
          : tag === 'z' ? renderTeX(content)
          : tag === 'Z' ? '<center>' + renderTeX(content) + '</center>'
          : `<span>${content}</span>`
        );

        i = k + close.length;
      }

      // [[explicit reference]]
      if (note.source.startsWith('[[', i)) {
        const j = note.source.indexOf(']]', i);
        const refToWord = note.source.slice(i + 2, j);
        const refToNote = [...(graph.jargonToDefiningNoteSet[refToWord] || [])][0];
        if (refToNote) {
          html.add(`<a href="${refToNote.href}">${refToWord}</a>`);
          referenceSet.add(refToNote.id);
        } else {
          html.add(`<a style="color:red">${refToWord}</a>`);
        }
        i = j + 2;
        continue loop;
      }

      // Implicit reference
      // TODO:
      //   This has a bug where if two jargs A,B match the current text,
      //   and A is shorter than B, and A does not end on a word boundary
      //   but B does, then we will fail to add a link to B.
      implicit: {
        if (/\w/.test(note.source[i - 1])) break implicit;
        const jarg = jtrie.longestPrefixOf(j_norm(note.source.slice(i)));
        if (!jarg || /\w/.test(note.source[i + jarg.length])) break implicit;
        const word = note.source.slice(i, i + jarg.length);
        const refToNote = [...(graph.jargonToDefiningNoteSet[jarg] || [])][0];
        if (refToNote) {
          referenceSet.add(refToNote.id);
          html.add(`<a href="${refToNote.href}">${word}</a>`);
        } else {
          html.add(`<a style="color:red">${word}</a>`);
        }
        i += word.length;
        continue loop;
      }

      // Default case
      html.add(note.source[i]);
      i++;
      continue loop;

    }

    return [html, referenceSet];

  });

  lazyAss(note, 'references', () => {
    return note[t].initialHtmlAndReferenceSet[1];
  });

  lazyAss(note, 'html', () => {
    let html;
    html = note[t].initialHtmlAndReferenceSet[0];
    html = html.toString();
    html = `

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">

<style>
  body { margin: 0; }

  body {
    font-family: monospace;
    font-size: 14px;
    line-height: 1.5em;
    white-space: pre-wrap;
  }

  .section-header {
    color: #c06;
    border-bottom: 1px dotted #c06;
    display: inline-block;
    width: 100%;
  }

  #the-div .katex-display {
    margin: 0;
    /* By defualt has top- and bottom-margins, which is typically a good
       thing, but would be inconsistent with how we otherwise do rendering,
       wherein no margins are added. */
  }


  // v Inherited from global styling

  body {
    padding: 4vh 50px;
    max-width: 800px;
    margin: 0 auto;

    font-size: 14px;
    font-family: monospace;
    line-height: 1.5em;
  }

  a {
    text-decoration: none;
    color: black;
    background-color: hsla(330, 75%, 85%, .25);
  }
  a:hover {
    background-color: hsla(330, 75%, 70%, .50);
  }

  hr {
    border: none;
    border-bottom: 1px dashed lightgrey;
  }

  code {
    background-color: rgba(0, 0, 0, 0.05);
    padding: 1px 4px;
    border: 1px solid rgb(200, 200, 200);
    border-radius: 3px;
  }
</style>

${html}






<u>Referenced by:</u>
<ul style="line-height: 1.2em">${
  [...note.referencedBy]
    .map(id => graph.notesById[id])
    .sort((a, b) => b.popularity - a.popularity)
    .map(n => '<li><a href="' + n.href + '">' + n.id + '</a></li>')
    .join('')
}</ul>`;
    return html;
  });

  return note;

}


function extract(text, open, close) {
  const result = new Set();
  let i = 0, j = 0;
  while (true) {
    i = text.indexOf(open, j);
    if (i === -1) break;
    j = text.indexOf(close, i);
    if (j === -1) break;
    result.add(text.slice(i + open.length, j));
    j += close.length;
  }
  return result;
}

function setMinus(a, b) {
  const r = new Set();
  for (const ae of a)
    if (!b.has(ae))
      r.add(ae);
  return r;
}

function j_norm(s) {
  return s.toLowerCase();
}

function chompDelimited(text, i, open, close) {
  if (!text.startsWith(open, i)) return [i, null];
  const j = text.indexOf(close, i + open.length);
  if (j === -1) return [i, null];
  const content = text.slice(i + open.length, j);
  return [j + close.length, content];
}


function renderTeX(source, env) {
  return cache.at('tex', [renderTeX, source], () => {
    return fss.withTempDir(tmp => {

      env.log.info(`Rendering LaTeX [${source.length}]`);

      const tex = String.raw`
        \documentclass{standalone}
        \usepackage{tikz}
        \usepackage{lmodern}
        \usepackage[T1]{fontenc}
        \begin{document}

        ${source}

        \end{document}
      `;
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
        throw 'tikz render failed; see above!';
      }

      env.log.info(`Rendering LaTeX [done] [${source.length}]`);
      return result;

    });
  });
}

class Trie {
  constructor(strings) {
    this.isElement = Symbol("isElement");

    this.trie = {};
    strings = new Set(strings);
    for (const str of strings) {
      let root = this.trie;
      for (const ch of str)
        root = (root[ch] = root[ch] || {});
      root[this.isElement] = true;
    }
  }

  longestPrefixOf(string) {
    let result = null;
    let root = this.trie;
    let path = '';

    for (const ch of string) {
      if (root[this.isElement]) result = path;
      root = root[ch];
      path += ch;
      if (root === undefined) break;
    }
    if (root && root[this.isElement]) result = path;

    return result;
  }
}
