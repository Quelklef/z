const { squire } = require('../../../squire.js');
const p = squire('../parse.js');
const { Cats } = squire('../../../util.js');

exports.commands = {};
exports.parsers = [];

// WANT: unclear how much of this should go into 'format.js'
//       and how much belongs in a format module

// Expanding bullets
exports.commands.fold = function(s) {
  p.p_spaces(s);
  const [line, _] = p.p_enclosed(s, p.p_toplevel_markup);
  p.p_spaces(s);
  const body = p.p_block(s, p.p_toplevel_markup);
  return new Indented({ indent: 2, body: new Expand({ line, body, id: s.gensym('expand') }) });
}

// Lists and indented blocks
exports.parsers.push(p_indent);
function p_indent(s) {
  const curIndent = s.indents[s.indents.length - 1] || 0;
  const isStartOfLine = (
    [undefined, '\n'].includes(s.text[s.i - curIndent - 1])
    && s.text.slice(s.i - curIndent - 1, s.i).trim() === ''
  )
  if (!isStartOfLine) return '';

  // Calculate line column
  let i = s.i;
  while (s.text[i] === ' ') i++;
  let dIndent = i - s.i;

  s.i += dIndent;

  // Find bullet
  let style = null;
  {
    if (p.p_backtracking(s, s => p.p_take(s, '- '))) {
      style = '-';
    }
    else if (p.p_backtracking(s, s => p.p_take(s, '> '))) {
      style = '>';
    }
    else if (p.p_backtracking(s, s => p.p_take(s, '# '))) {
      style = '#';
    }
  }

  if (style)
    dIndent += 2;

  // If line not further indented, bail
  if (dIndent <= 0)
    return '';

  const newIndent = curIndent + dIndent;

  if (style === '>') {

    const line = p.p_toplevel_markup(s, s => s.text.startsWith('\n', s.i));
    p.p_take(s, '\n');

    s.indents.push(newIndent);
    const body = p.p_toplevel_markup(s);
    s.indents.pop();

    return new Indented({
      indent: dIndent,
      body: new Expand({ line, body, id: p.gensym(s, 'expand') }),
    });

  } else {

    s.indents.push(newIndent);
    body = p.p_toplevel_markup(s);
    s.indents.pop();
    if (style)
      body = new Bulleted({
        body,
        isNumbered: style === '#',
      });
    return new Indented({ indent: dIndent, body });

  }
}

exports.prelude = String.raw`

<style>

.expand > .expand-line {
  display: list-item;
  list-style-type: disclosure-closed;
  cursor: pointer;
}
.expand > .expand-line:hover {
  background-color: rgba(var(--color-dynamic-rgb), .05);
}
.expand > .expand-line::marker {
  color: var(--color-dynamic);
}
.expand > .expand-body {
  border-top: 1px dashed rgba(var(--color-static-rgb), 0.3);
  margin-top: .5em;
  padding-top: .5em;
  margin-bottom: .5em;
  padding-bottom: .5em;
  position: relative;
}
.expand > .expand-body::before {
  content: '';
  display: inline-block;
  position: absolute;
  background-color: var(--color-dynamic);
  width: 1px;
  left: -1.5ch;  /* TODO: baked */
  top: 0;
  height: 100%;
}
.expand:not(.open) > .expand-body {
  display: none;
}
.expand.open > .expand-line {
  list-style-type: disclosure-open;
}

</style>

<script>

document.addEventListener('DOMContentLoaded', () => {

  const openExpands = new Set(urlSynchronizedState.openExpands || []);

  for (const $exp of document.querySelectorAll('.expand')) {
    const $line = $exp.querySelector('.expand-line');
    const $body = $exp.querySelector('.expand-body');

    let isExpanded = openExpands.has($exp.id);;

    function rerender() {
      if (isExpanded)
        $exp.classList.add('open');
      else
        $exp.classList.remove('open');
    }

    rerender();

    $line.addEventListener('click', () => {
      isExpanded = !isExpanded;
      rerender();

      if (isExpanded)
        openExpands.add($exp.id);
      else
        openExpands.delete($exp.id);
      urlSynchronizedState.openExpands = [...openExpands];
      syncToUrl();
    });
  }

});

</script>

`;

const Indented =
exports.Indented =
class Indented {

  constructor({ indent, body }) {
    this.indent = indent;
    this.body = body;
  }

  toHtml(env) {
    return new Cats(`<div style="margin-left: ${this.indent}ch">`, this.body.toHtml(env), '</div>');
  }

  children() {
    return [this.body];
  }

}


const Bulleted =
exports.Bulleted =
class Bulleted {

  constructor({ body, isNumbered, id }) {
    this.body = body;
    this.isNumbered = isNumbered;
  }

  toHtml(env) {
    // TODO: numbers are wrong (make counter inc by parent, I think?)
    return new Cats(
      `<div style="display: list-item; list-style-type: ${this.isNumbered ? 'decimal' : 'disc'}">`,
      this.body.toHtml(env),
      "</div>",
    );
  }

  children() {
    return [this.body];
  }

}

const Expand =
exports.Expand =
class Expand {

  constructor({ line, body, id }) {
    this.line = line;
    this.body = body;
    this.id = id;
  }

  toHtml(env) {
    return new Cats(
      `<div class="expand" id="${this.id}">`,
      '<div class="expand-line">',
      this.line.toHtml(env),
      '</div>',
      '<div class="expand-body">',
      this.body.toHtml(env),
      '</div>',
      '</div>',
    );
  }

  children() {
    return [this.body, this.line];
  }

}
