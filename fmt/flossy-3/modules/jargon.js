// const { squire } = require('../../../squire.js');
const Rep = require('../rep.js');
const { p_block, p_toplevel_markup, p_inline, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = require('../parsing.js');


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
  return new Rep.Jargon({ forms, body });
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

  return new Rep.Implicit({ fromJargon: jarg, toNote, body });
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
