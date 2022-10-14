const { squire } = require('../../../squire.js');
const Rep = squire('../rep.js');
const { p_block, p_toplevel_markup, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('../parsing.js');

exports.stateInit = () => ({
  annotNameQueue: [],
  annotNameStack: (function * () { for (let i = 1;; i++) yield ('' + i); })(),
});

exports.commands = {};

// Annotation reference
exports.commands.aref = function(s) {
  p_spaces(s);

  let name;
  if (!";[{(<:".includes(s.text[s.i])) {
    name = p_word(s).toString();
  } else {
    name = s.gensym('annot');
    s.annotNameQueue.push(name);
  }

  p_spaces(s);

  let body;
  let isSuper;
  if (s.text[s.i] === ';') {
    const { value, done } = s.annotNameStack.next();
    if (done)
      throw mkError(s.text, [s.i, s.i + 1], 'Out of footnote symbols!');
    s.i++;
    body = value;
    isSuper = true;
  } else {
    body = p_inline(s, p_toplevel_markup)
    isSuper = false;
  }

  const isSuperClass = isSuper ? 'super' : '';
  return new Rep.Seq(
    `<span class="annotation-reference ${isSuperClass}" id="${s.gensym('annot-id')}" data-refers-to="${name}">`,
    body,
    '</span>'
  );
}

// Annotation definition
exports.commands.adef = function(s) {
  const sx = s.clone();

  p_spaces(s);

  let name;
  if (!"[{(<:=".includes(s.text[s.i])) {
    name = p_word(s);
    p_spaces(s);
  } else {
    if (s.annotNameQueue.length === 0)
      throw mkError(sx.text, sx.i, "Unpaired \\adef");
    name = s.annotNameQueue[0];
    s.annotNameQueue.splice(0, 1);
  }

  return new Rep.Seq(`<div class="annotation-definition" data-name="${name}">`, p_block(s, p_toplevel_markup), '</div>');
}

exports.prelude = String.raw`

<style>

* { box-sizing: border-box; }

.annotation-reference.super
{
  vertical-align: super;
  font-size: .9em;
  position: relative;
  padding: 0 1px;
}

/* Increase effective clickable area */
.annotation-reference.super:before {
  content: '';
  position: absolute;
  width: 25px;
  height: 25px;
  border-radius: 100%;
  left: calc(50% - 25px / 2);
  top: calc(50% - 25px / 2);
  /* background-color: rgba(var(--color-dynamic-rgb), .1); */
}

.annotation-reference:not(.super):before { content: '['; }
.annotation-reference:not(.super):after { content: ']'; }

.annotation-reference:before,
.annotation-reference:after,
.annotation-reference
{
  color: rgba(var(--color-dynamic-rgb), .65);
  cursor: pointer;
}

.annotation-reference:hover:before,
.annotation-reference:hover:after,
.annotation-reference:hover,
.annotation-reference.active:before,
.annotation-reference.active:after,
.annotation-reference.active
{
  color: var(--color-dynamic);
}

.annotation-reference.active:before,
.annotation-reference.active:after,
.annotation-reference.active
{
  font-weight: bold;
}

.annotation-definition {
  background: rgba(250, 250, 250);
  box-shadow: 0 0 8px -2px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(var(--color-static-rgb), .5);
  border-radius: 3px;

  padding: .5em 1em;
  margin: .5em 0;
}

.annotation-definition:not(.revealed) {
  display: none;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  // id set of expanded \aref nodes
  let expandedRefs = new Set(window.urlSynchronizedState.expandedRefs || []);

  function stateToDom() {
    for (const $ref of document.querySelectorAll('.annotation-reference')) {
      const isExpanded = expandedRefs.has($ref.id);

      const $def = document.querySelector('.annotation-definition[data-name="' + $ref.dataset.refersTo + '"]');
      if (!$def) {
        console.warn("Unable to find annotation definition with name: '" + name + "'", 'due to reference', $ref);
        return;
      }

      if (isExpanded) {
        $def.classList.add('revealed');
        $ref.classList.add('active');
      } else {
        $def.classList.remove('revealed');
        $ref.classList.remove('active');
      }
    }
  }

  stateToDom();

  for (const $ref of document.querySelectorAll('.annotation-reference')) {
    $ref.addEventListener('click', () => {
      const isExpanded = expandedRefs.has($ref.id);
      if (isExpanded) expandedRefs.delete($ref.id);
      else expandedRefs.add($ref.id);

      stateToDom();

      window.urlSynchronizedState.expandedRefs = [...expandedRefs];
      syncToUrl();
    });
  }

});

</script>

`;