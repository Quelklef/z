const { squire } = require('../../../squire.js');
const Rep = require('../rep.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../../util.js');
const { p_block, p_toplevel_markup, p_inline, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = require('../parsing.js');
// WANT: import audit on all format modules


exports.stateInit = ({ graph, note, doImplicitReferences }) => ({
  doImplicitReferences,
  jargonMatcher: doImplicitReferences && new JargonMatcherJargonMatcher(graph.jargonSet, note.defines),
});


exports.commands = {};

// Jargon
exports.commands.jarg = function(s) {

  let forms = new Set();
  while (true) {
    p_spaces(s);
    if (!s.text.startsWith('<', s.i)) break;
    const jargs = p_jargon(s);
    forms = new Set([...forms, ...jargs]);
  }

  // TODO: more reucurrence happening here!
  const doImplicitReferences = s.doImplicitReferences;
  const srec = { ...s.clone(), doImplicitReferences: false };
  const body = p_inline(srec, p_toplevel_markup);
  Object.assign(s, { ...srec, doImplicitReferences });

  // WANT: move module-specific Rep types into the respective modules
  return new Jargon({ forms, body });
}

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

  return new Implicit({ fromJargon: jarg, toNote, body });
}

function p_jargon(s) {

  if (!s.text.startsWith('<', s.i))
    throw mkError(s.text, s.i, "Expected '<'");
  s.i++;

  const parts = [['']];
  while (true) {
    if (s.text.startsWith('>', s.i)) {
      s.i++;
      break;
    }
    parts.push(p_jargonAux(s));
  }

  let result = [''];
  for (const part of parts)
    result = result.flatMap(j => part.map(p => j + p));
  return result;

}

function p_jargonAux(s) {

  // Disjunctive combinator -- (this|that)
  if (s.text.startsWith('(', s.i)) {
    s.i++;
    const choices = [];
    while (true) {
      const choice = p_jargonAux(s);
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
    return p_jargonAux(s).flatMap(suff => choices.flat().map(pre => pre + suff));
  }

  // Quoted syntax -- "word with some spaces"
  else if (s.text.startsWith('"', s.i)) {
    const word = new Cats();
    s.i++;
    loop: while (true) {
      switch (s.text[s.i]) {
        case "\\":
          word.add(s.text[s.i + 1]);
          s.i += 2;
          break;

        case "\"":
          s.i ++;
          break loop;

        default:
          word.add(s.text[s.i]);
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
    return p_jargonAux(s).map(j => char + j);
  }

}

exports.parsers = [ p_implicitReference ];


exports.prelude = String.raw`

<style>

/* Styling for references to other notes */
.reference, .reference:visited {
  color: inherit;
}
.reference {
  text-decoration: none;
}
.reference.implicit:not(:hover) {
  border-bottom: 1.5px solid rgba(var(--color-dynamic-rgb), .15);
}
.reference:not(.invalid):hover {
  border: none;
  background-color: rgba(var(--color-dynamic-rgb), .25);
}
.reference.explicit:not(:hover) {
  border-bottom: 2px solid rgba(var(--color-dynamic-rgb), .75);
}
.reference.invalid {
  color: red;
  cursor: not-allowed;
}

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



// WANT: dedup me as well
const htmlEscapes = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
};
function escapeHtml(s) {
  return [...s].map(c => htmlEscapes[c] || c).join('');
}

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



const Jargon =
exports.Jargon =
class Jargon extends Rep.Rep {

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
class Implicit extends Rep.Rep {

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