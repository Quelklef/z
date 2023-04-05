

const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';

// Italic, bold, underline, strikethrough
for (const tag of 'ibus') {
  exports.commands[tag] = function(s) {
    return repm.mkSeq(`<${tag}>`, p.p_inline(s, p.p_toplevel_markup), `</${tag}>`);
  }
}

// Comment (REMark)
exports.commands.rem = function(s) {
  p.p_spaces(s);
  const [comment, _] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return '';
}

// External (hyper-)reference
exports.commands.href = function(s) {
  const params = ppar.p_kvParams(s, {
    uri: ppar.p_arg_string,
  });

  const body = p.local(s, s => {
    // Nested <a> tags are forbidden in HTML
    s.doImplicitReferences = false;
    return p.p_inline(s, p.p_toplevel_markup);
  });

  return (
    repm.h('a')
      .a('href', params.uri)
      .a('target', '_blank')
      .a('class', 'ext-reference')
      .c(body)
  );
}

// generic "block of text with title"
exports.commands.block = function(s) {
  p.p_whitespace(s);
  const title = p.p_inline(s, p.p_toplevel_markup);
  p.p_whitespace(s);
  const body = p.p_block(s, p.p_toplevel_markup);
  return (
    repm.h('div')
      .a('class', 'generic-block')
      .c(repm.h('span')
          .a('class', 'generic-block-title')
          .c(title))
      .c(repm.h('span')
          .a('class', 'generic-block-body')
          .c(body))
  );
};

exports.prelude = String.raw`
<style>

.generic-block {
  margin-left: 1ch;
  padding: 1ch;
  padding-right: 0;
}
.generic-block-title:not(:empty) {
  font-weight: bold;
  margin-right: 1.5ch;
}
.generic-block-title:not(:empty)::after {
  content: '.';
}

.generic-block {
  position: relative;
}
.generic-block::before {
  --generic-block-width: 3ch;
  --generic-block-horizontal-padding: .75ch;
  --generic-block-vertical-padding: .25ch;

  content: '';
  position: absolute;

  width: var(--generic-block-width);
  height: calc(100% + 2 * var(--generic-block-vertical-padding));

  right: calc(100% - var(--generic-block-width) + var(--generic-block-horizontal-padding));
  bottom: calc(-1 * var(--generic-block-vertical-padding));

  border: 1px solid grey;
  border-right: none;
}

</style>
`;
