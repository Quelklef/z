import * as plib from 'path';
import * as child_process from 'child_process';
import fs from 'fs';
import katex from 'katex';

import { lazyAss, StringBuilder, cache, withTempDir } from './util.mjs';

export default function * legacy(pwd, graph) {

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

function mkNote(floc, source, graph) {

  const note = graph.newNote();

  note.source = source;

  note.id = plib.basename(floc, '.z');

  // Initial computations
  lazyAss(note.t, 'meta', () => {

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

  lazyAss(note, 'defines', () => note.t.meta.defines);

  // Most computations
  lazyAss(note.t, 'comp', () => {

    console.log(`Rendering [${note.id}]`);

    const jmatcher = new JargonMatcher(graph.jargonSet, note.defines);

    const comp = {};
    comp.html = new StringBuilder();
    comp.references = new Set();

    let i = note.t.meta.continueIndex;
    let isInitial = true;
      // ^ True on all chars from the start of a line up to (and including) the first non-whitespace
    let buffer = null;
    const stack = [];

    // Debug output
    const debug = false;

    while (i <= note.source.length) {

      if (debug) console.log('{{{' + note.source.slice(i, i + 35) + '}}}');

      const out = buffer || comp.html;

      // Up isInitial
      isInitial = note.source[i - 1] === '\n' || isInitial && note.source[i - 1] === ' ';

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
            break

          case 'dedent':
            if (note.source[i - 1] === '\n' && !' \n'.includes(note.source[i + 1])) {
              stack.pop();
              item.action();
              continue;
            }
            break

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

      // Bullet marks
      if (isInitial && note.source.startsWith('- ', i)) {
        if (debug) console.log('->> bullet');
        out.add('&bull; ');
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
          href = [...refNotes][0].href;  // hmm
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
            stack.push({
              marker: { type: 'token', token: pairs[opener] },
              action: () => out.add(`</${tag}>`),
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

          case 'tikz':
          case 'tex':
          case 'katex':
            buffer = new StringBuilder();
            stack.push({
              marker: { type: 'dedent' },
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
            throw Error(`Bad backslash-command "${name}"`);
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

  lazyAss(note, 'references', () => note.t.comp.references);

  lazyAss(note, 'html', () => {
    let html;
    html = note.t.comp.html.build()

    html += '\n\n\n';
    html += '<hr />';
    html += 'Referenced by:\n';

    for (const refId of note.referencedBy) {
      const ref = graph.notesById[refId];
      html += `  &bull; <a href="${ref.href}">${ref.id}</a>\n`;
    }

    html = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Merriweather&display=swap');

  #the-div {
    font-family: 'Merriweather', serif;
    font-size: 14px;
  }

  .section-header {
    color: #c06;
    border-bottom: 1px dotted #c06;
    display: inline-block;
    width: 100%;
  }
</style>
<div id="the-div">${html}</div>
    `;

    return html;
  });

  return note;

}

class JargonMatcher {
  constructor(jargs, exclude) {
    this.jargs = [...jargs].sort((a, b) => b.length - a.length);
    this.exclude = new Set([...exclude]);
    this.M = Math.max(...this.jargs.map(j => j.length));

    const anum_chars = new Set('abcdefghijklmnopqrstuvwxyz0123456789');
    this.is_anum = c => anum_chars.has(c);
  }
  normEq(s1, s2) {
    const norm = s => [...s.toLowerCase()].filter(this.is_anum).join('');
    return norm(s1) === norm(s2);
  }

  findMeAMatch(str, idx0) {
    if (this.is_anum(str[idx0 - 1]) || !this.is_anum(str[idx0])) return null;
    for (let idxf = idx0 + this.M; idxf >= idx0 + 1; idxf--) {
      if (this.is_anum(str[idxf]) || !this.is_anum(str[idxf - 1])) continue;
      for (const jarg of this.jargs) {
        if (this.normEq(str.slice(idx0, idxf), jarg)) {
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
