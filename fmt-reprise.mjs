import * as plib from 'path';
import * as child_process from 'child_process';
import fs from 'fs';
import katex from 'katex';

import { lazyAss, StringBuilder, cache, withTempDir } from './util.mjs';

export default function * reprise(pwd, graph) {

  const ls = fs.readdirSync(plib.resolve(pwd, 'notes'))
  for (const fname of ls) {
    const floc = plib.resolve(pwd, 'notes', fname);
    if (floc.endsWith('.z')) {
      const source = fs.readFileSync(floc).toString();
      if (source.trim().split('\n')[0] === 'format=reprise')
        yield mkNote(floc, source, graph);
    }
  }

}


const t = Symbol('fmt-reprise.t');

function mkNote(floc, source, graph) {

  const note = {};

  note.source = source;

  note.cacheKeys = [floc, source];

  note.id = plib.basename(floc, '.z');

  Object.defineProperty(note, t, { enumerable: false, value: {} });

  // Initial computations
  lazyAss(note[t], 'meta', () => {

    console.log(`Initializing [${note.id}]`);

    const meta = {};
    meta.defines = new Set();

    let i = 0;

    // Skip format=reprise line
    i = indexOf(note.source, "\n", i) + 1;

    // Parse metainformation
    while (i < note.source.length) {
      if (note.source.startsWith('\n', i)) {
        i += 1;
        break;
      } else {
        const eol = indexOf(note.source, '\n', i);
        const line = note.source.slice(i, eol);
        if (!line.includes(': ')) throw Error(`Malformed meta line: "${line}"`);
        i = eol + 1;

        const [key, val] = line.split(': ');
        switch (key) {
          case 'defines':
            meta.defines = new Set(val.split(', '));
            break;

          default:
            throw Error(`Unknown meta key "${key}"`);
        }
      }
    }

    meta.continueIndex = i;

    return meta;

  });

  lazyAss(note, 'defines', () => note[t].meta.defines);

  // Most computations
  lazyAss(note[t], 'comp', () => {

    console.log(`Rendering [${note.id}]`);

    const jmatcher = new JargonMatcherJargonMatcher(graph.jargonSet, note.defines);

    const comp = {};
    comp.html = new StringBuilder();
    comp.references = new Set();

    let i = note[t].meta.continueIndex;
    let inCode = false;  // in \c[] ?
    let gensym = 0;
    let isInitial = true;
      // ^ True on all chars from the start of a line up to (and including) the first non-whitespace
    let buffer = null;
    const stack = [];

    let currentIndent = 0;

    // Debug output
    const debug = false;

    parsing:
    while (i <= note.source.length) {

      if (debug) console.log('{{{' + note.source.slice(i, i + 35) + '}}}');

      const out = buffer || comp.html;

      // Up isInitial
      isInitial = note.source[i - 1] === '\n' || isInitial && note.source[i - 1] === ' ';

      // Up currentIndent
      if (note.source[i - 1] === '\n') {
        currentIndent = 0;
      } else if (note.source[i - 1] === ' ') {
        currentIndent++;
      }

      // Escape a character
      if (note.source.startsWith('~', i)) {
        if (debug) console.log('->> escape');
        out.add(note.source[i + 1]);
        i += 2;
        continue;
      }

      // React to stack
      if (stack.length > 0) {
        const item = stack[stack.length - 1];
        switch (item.marker.type) {
          case 'token':
            if (note.source.startsWith(item.marker.token, i)) {
              i += item.marker.token.length;
              stack.pop();
              item.action();
              continue;
            }
            break;

          case 'dedent':
            if (note.source[i - 1] === '\n') {

              if (note.source.startsWith(strRep(' ', item.marker.size), i)) {
                i += item.marker.size; // skip indent
                continue;
              }

              else {
                // Terminate only if next indent is too small
                let ind = 0;
                for (let j = i; j <= note.source.length; j++) {
                  if (note.source[j] === '\n') ind = 0;
                  else if (note.source[j] === ' ') ind++;
                  else {
                    if (ind < item.marker.size) {
                      stack.pop();
                      item.action();
                      continue parsing;
                    } else break;
                  }
                }
              }

            }
            break;

          default:
            throw Error(`Unknown stack marker type "${item.marker.type}"`);
        }
      }

      // Buffering
      if (buffer !== null) {
        if (debug) console.log('->> buffer');
        out.add(note.source[i]);
        i += 1;
        continue;
      }

      // Em dash
      if (note.source.startsWith('--', i)) {
        if (debug) console.log('->> emdash');
        out.add('&#8212;');
        i += 2;
        continue;
      }

      if (!inCode && ['"', "'"].includes(note.source[i])) {
        const quots = {
          'single-lone': "'",
          'single-open': '‘',
          'single-close': '’',
          'double-lone': '"',
          'double-open': '“',
          'double-close': '”',
        };

        const quot = note.source[i];
        const parity = { '"': 'double', "'": 'single' }[quot];

        const notSpace = c => (!!c && !/\s/.test(c));
        const before = notSpace(note.source[i - 1]);
        const after = notSpace(note.source[i + 1]);
        const position = {
          'true, true': 'close',
          'true, false': 'close',
          'false, true': 'open',
          'false, false': 'lone',
        }[before + ', ' + after];

        const outquot = quots[parity + '-' + position];
        out.add(outquot);
        i++;
      }

      // Bullet marks
      if (isInitial && note.source.startsWith('- ', i)) {
        if (debug) console.log('->> bullet');
        out.add('<span style="margin-right:0.75ch">&bull;</span>');
        i += 2;
        continue;
      }

      // Wider indents
      if (isInitial && note.source[i] === ' ') {
        if (debug) console.log('->> indent');
        out.add('<span style="display:inline-block;width:1ch;white-space:pre;"></span>');
        i++;
        continue;
      }

      // Implicit references
      const r = jmatcher.findMeAMatch(note.source, i);
      if (r !== null) {
        if (debug) console.log('->> jargon:', r[0]);
        const [jarg, stepAmt] = r;
        const refNotes = graph.jargonToDefiningNoteSet[jarg];
        let href;
        if (refNotes && refNotes.size > 0) {
          const note = [...refNotes][0]
          href = note.href;  // hmm
          comp.references.add(note.id);
        } else {
          console.warn(`warn: bad jargon ${jarg}`);
          href = '#';
        }
        out.add(`<a href="${href}">${note.source.slice(i, i + stepAmt)}</a>`);
        i += stepAmt;
        continue;
      }

      // Inline LaTeX
      if (note.source.startsWith('$', i)) {
        if (debug) console.log('->> inline latex');
        const j = note.source.indexOf('$', i + 1);
        if (j === -1) throw Error("Unclosed inline LaTeX");
        const latex = note.source.slice(i + 1, j);
        out.add(katex.renderToString(latex, { displayMode: false }));
        i = j + 1;
        continue;
      }

      // Backslash commands
      if (note.source.startsWith('\\', i)) {
        if (debug) console.log('->> backslash');

        const i0 = i;

        const pairs = {
          '[': ']',
          '(': ')',
          '<': '>',
          '{': '}',
        };

        const openers = [...Object.keys(pairs), ...':'];

        let openerIdx = i;
        {
          while (!openers.includes(note.source[openerIdx])) {
            openerIdx++;
            if (openerIdx >= note.source.length) throw Error("Unopened backslash");
          }
        }

        const opener = note.source[openerIdx];

        let name, flags;
        {
          const command = note.source.slice(i + 1, openerIdx);
          const sepIdx = indexOf(command, " ");
          name = command.slice(0, sepIdx);
          flags = command.slice(sepIdx + 1);
        }

        i = openerIdx + opener.length;

        switch (name) {
          case 'i':
          case 'b':
          case 'u':
          case 'c':
            const tag = {
              i: 'i',
              b: 'b',
              u: 'u',
              c: 'code',
            }[name];
            out.add(`<${tag}>`);
            if (tag === 'code') inCode = true;
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => {
                out.add(`</${tag}>`);
                if (tag === 'code') inCode = false;
              },
            });
            break;

          // Title
          case 'title':
            out.add('<span style="font-size: 18px; color: #c06; margin-bottom: 1em; display: inline-block;">');
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => out.add('</span>'),
            });
            break;

          // Section header
          case 'sec':
            out.add('<span class="section-header">');
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => out.add('</span>'),
            });
            break;

          // Explicit reference
          case 'ref':
            const noteId = flags.trim();
            out.add(`<a href="${graph.notesById[noteId].href}">`);
            comp.references.add(noteId);
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => out.add('</a>'),
            });
            break;

          // Annotation reference
          case 'aref':
            const refToName = flags.trim() ? flags.trim() : ('' + (++gensym));
            out.add(`<span class="annotation-reference" data-ref-to="${refToName}">`);
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => out.add('</span>'),
            });
            break;

          // Annotation definition
          case 'adef':
            const defName = flags.trim() ? flags.trim() : ('' + gensym);
            out.add(`<span class="annotation-definition hidden" data-name="${defName}">`);
            stack.push({
              marker: { type: 'dedent', size: currentIndent + 2 },
              action: () => out.add('</span>'),
            });

            // On \cmd:<NEWLINE>, skip the blank line
            if (opener === ':') {
              let i2 = i;
              while (note.source[i2] === ' ') i2++;
              if (note.source[i2] === '\n') i = i2 + 1;
            }

            break;

          case 'tikz':
          case 'tex':
          case 'katex':
            buffer = new StringBuilder();
            stack.push({
              marker: { type: 'dedent', size: currentIndent + 2 },
              action: () => {
                let tex = buffer.build();
                buffer = null;

                if (name === 'katex') {
                  out.add(katex.renderToString(tex, { displayMode: true }));
                } else {
                  if (name === 'tikz')
                    tex = String.raw`
                      \begin{tikzpicture}
                      ${tex}
                      \end{tikzpicture}
                    `;
                  tex = String.raw`
                    \documentclass{standalone}
                    \usepackage{tikz}
                    \usepackage{lmodern}
                    \usepackage[T1]{fontenc}
                    \begin{document}
                    ${tex}
                    \end{document}
                  `;
                  out.add('<center>' + renderTeX(tex) + '</center>');
                }
              },
            });
            break;

          default:
            const ctx = note.source.slice(i0, indexOf(note.source, '\n', i0));
            throw Error(`Bad backslash-command "${name}" around: ${ctx}`);
        }

        continue;
      }

      else {
        if (debug) console.log('->> default');
        out.add(note.source[i]);
        i++;
        continue;
      }

    }

    return comp;

  });

  lazyAss(note, 'references', () => note[t].comp.references);

  lazyAss(note, 'html', () => {
    let html;
    html = note[t].comp.html.build()

    html += '\n\n\n';
    html += '<hr />';
    html += 'Referenced by:\n';

    for (const refId of note.referencedBy) {
      const ref = graph.notesById[refId];
      html += `  &bull; <a href="${ref.href}">${ref.id}</a>\n`;
    }

    html = String.raw`<!DOCTYPE HTML>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">

<style>

  body { margin: 0; }

  #the-div {
    font-family: 'Merriweather', serif;
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

<div id="the-div">${html}</div>
    `;

    // Annotation implementation
    html += `
<style>
.annotation-reference,
.annotation-reference::before,
.annotation-reference::after
{
  color: #c06;
  cursor: pointer;
  opacity: 0.6;
}
.annotation-reference::before { content: '['; }
.annotation-reference::after  { content: ']'; }

.annotation-reference:hover,
.annotation-reference.active
{
  opacity: 1;
}

.annotation-reference.active {
  font-weight: bold;
}

.annotation-definition {
  display: block;
  padding: .5em 1em;
  margin-top: 1em;
  margin-bottom: 2em;
  background-color: rgba(0, 0, 0, 0.02);
  border: 1px solid #c06;
  border-radius: 3px;
}
.annotation-definition.hidden {
  display: none;
}



</style>

<script>
document.addEventListener('DOMContentLoaded', () => {

  document.querySelectorAll('.annotation-reference').forEach($ref => {
    $ref.addEventListener('click', () => {
      const on = $ref.classList.contains('active');

      if (on) $ref.classList.remove('active');
      else $ref.classList.add('active');

      document.querySelectorAll('.annotation-definition').forEach($def => {
        if ($def.dataset.name === $ref.dataset.refTo) {
          if (on) $def.classList.add('hidden');
          else $def.classList.remove('hidden');
        }
      });
    });
  });

  // Don't make \def cause an extra newline
  if (false)
  document.querySelectorAll('.annotation-definition').forEach($def => {
    const t = $def.nextSibling;
    if (t.textContent.startsWith('\\n')) t.textContent = t.textContent.slice(1);
  });

});
</script>
    `;

    return html;
  });

  return note;

}


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

    this.jargsOfNormLengthLeq = {};

    {
      const m = this.jargsOfNormLengthLeq;
      for (let l = 1; l <= this.M; l++)
        m[l] = [];
      for (const [jarg, njarg] of this.jargs)
        for (let l = 1; l <= njarg.length; l++)
          m[l].push([jarg, njarg]);
    }

  }

  findMeAMatch(str, idx0) {
    if (this.isSignif(str[idx0 - 1]) || !this.isSignif(str[idx0])) return null;
    for (let idxf = idx0 + this.M; idxf >= idx0 + 1; idxf--) {
      if (this.isSignif(str[idxf]) || !this.isSignif(str[idxf - 1])) continue;
      for (const [jarg, njarg] of this.jargsOfNormLengthLeq[idxf - idx0]) {
        if (this.normalize(str.slice(idx0, idxf)) === njarg) {
          if (this.exclude.has(jarg)) return null;
          return [jarg, idxf - idx0];
        }
      }
    }
    return null;
  }
}


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

function strRep(c, n) {
  let r = '';
  for (let i = 0; i < n; i++)
    r += c;
  return r;
}
