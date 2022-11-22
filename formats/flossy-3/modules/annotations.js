
const repm = require('../repm.js');
const p = require('../parse.js');

exports.commands = {};
exports.nonlocalStateKeys = [ 'adefNameQueue', 'adefNameIndex' ];
exports.stateInit = {
  adefNameQueue: [],
  adefNameIndex: 1,
};

// Annotation reference
exports.commands.aref = function(s) {
  p.p_spaces(s);

  let adefName;
  adefName = p.p_backtracking(s, p.p_word);
  if (!adefName) {
    adefName = p.gensym(s, 'adef');
    s.adefNameQueue.push(adefName);
  }

  p.p_spaces(s);

  let body;
  if (s.text[s.i] === ';') {
    const value = (s.adefNameIndex++);
    s.i++;
    body = value;
  } else {
    body = p.p_inline(s, p.p_toplevel_markup)
  }

  const arefName = p.gensym(s, 'aref');
  return new repm.Seq(
    `<span class="annotation-reference" data-name="${arefName}" data-refers-to="${adefName}">`,
    body,
    '</span>'
  );
}

// Annotation definition
exports.commands.adef = function(s) {
  p.p_spaces(s);
  let name;
  name = p.p_backtracking(s, p.p_word);
  if (!name) {
    if (s.adefNameQueue.length === 0)
      throw p.mkError(s.text, s.i, "Unpaired \\adef");
    name = s.adefNameQueue[0];
    s.adefNameQueue.splice(0, 1);
  }

  return new repm.Seq(
    `<div class="annotation-definition" data-name="${name}">`,
    p.p_block(s, p.p_toplevel_markup),
    '</div>',
  );
}

exports.prelude = String.raw`

<style>

.annotation-reference
{
  vertical-align: super;
  font-size: .9em;
  position: relative;
  padding: 0 1px;
  color: rgba(var(--color-dynamic-rgb), .65);
  cursor: pointer;
}

.annotation-reference:hover,
.annotation-reference.active
{
  color: var(--color-dynamic);
}

.annotation-reference.active {
  font-weight: bold;
}

/* Increase effective clickable area */
.annotation-reference:before {
  content: '';
  position: absolute;
  width: calc(100% + 1.5em);
  height: calc(100% + 0.5em);
  border-radius: 25%;
  left: calc(-1.5em / 2);
  top: calc(-0.5em / 2);
  /* background-color: rgba(var(--color-dynamic-rgb), .1); */
}

.annotation-definition {
  /* background: rgba(250, 250, 250); */
  /* box-shadow: 0 0 8px -2px rgba(0, 0, 0, 0.15); */
  border: 1px solid rgba(var(--color-static-rgb), .5);
  border-radius: 3px;
  padding: .5em 1em;
  margin: .5em 0;
}

/* lil triangle */
.annotation-definition {
  position: relative;
}
.annotation-definition:before {
  content: '';
  width: 0;
  height: 0;
  position: absolute;
  top: -10px;
  left: calc(var(--triangle-left) - 10px/2 - 2px);  /* var gets set by JS */
  border: 5px solid transparent;
  border-bottom-color: var(--color-static);
}

.annotation-definition:not(.revealed) {
  max-height: 0;
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: 0;
  /* nb. doing this instead of display:none fixes an
         issue regarding nested annotations */
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  // name set of expanded \aref nodes
  let expanded = new Set(window.urlSynchronizedState.expanded || []);

  function stateToDom() {
    const $refs = Array.from(document.querySelectorAll('.annotation-reference'));
    const $defs = Array.from(document.querySelectorAll('.annotation-definition'));
    for (const $ref of $refs) {
      const shouldExpand = expanded.has($ref.dataset.name);

      const $def = $defs.find($def => $def.dataset.name === $ref.dataset.refersTo);
      if (!$def) {
        console.warn("Unable to find annotation definition");
        return;
      }

      if (!shouldExpand) {
        $def.classList.remove('revealed');
      }
      else {
        let $eos = getEndOfSentence($ref)
        if (!$eos) {
          console.warn('Annotation getEndOfSentence fallback');
          $eos = $ref;
        }
        $eos.after($def);
        $def.classList.add('revealed');

        const left = (
          $ref.offsetLeft - $def.offsetLeft + $ref.offsetWidth / 2
        );
        $def.style.setProperty('--triangle-left', left + 'px');
      }
    }
  }

  stateToDom();

  for (const $ref of document.querySelectorAll('.annotation-reference')) {
    $ref.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();

      const isExpanded = expanded.has($ref.dataset.name);
      if (isExpanded) expanded.delete($ref.dataset.name);
      else expanded.add($ref.dataset.name);

      stateToDom();

      window.urlSynchronizedState.expanded = [...expanded];
      syncToUrl();
    });
  }


  function getEndOfSentence($node) {
    // Wow this is tricky to get right
    // BTW, it's extremeley effectful

    let $prev = $node;
    let prevY = getY($node);
    let nodeY;

    while (true) {
      $node = next($prev);
      if (!$node) return null;
      [$node, nodeY] = getY($node);
      if (nodeY > prevY + 15) return $prev;
      [$prev, prevY] = [$node, nodeY];
    }

    function next($targ) {
      if (!$targ) return null;
      return $targ.nextSibling ?? first(next($targ.parentNode));
    }
    function first($targ) {
      if (!$targ) return null;
      return first($targ.firstChild) ?? $targ;
    }

    function getY($targ) {
      if ($targ.nodeName === '#text') {
        const i = $targ.textContent.search(/\s/);
        if (i === 0) {
          $targ.splitText(1);
        } else if (i !== -1) {
          $targ.splitText(i);
        }
        const $span = document.createElement('span');
        $targ.before($span);
        $span.append($targ);
        $targ = $span
      }
      const y = $targ.getBoundingClientRect().top;
      return [$targ, y];
    }
  }

});

</script>

`;
