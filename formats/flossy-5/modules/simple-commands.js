

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

/*

\fence:
  \fence-sec [Proposition] A = B

  \fence-sec [Proof] blah blah blah

*/
exports.commands.fence = function(s) {
  p.p_whitespace(s);
  const body = p.p_block(s, p.p_toplevel_markup);
  return (
    repm.h('div')
      .a('class', 'fence')
      .c(body)
  );
}
exports.commands['fence-sec'] = function(s) {
  p.p_whitespace(s);
  const word = p.p_inline(s, p.p_toplevel_markup);
  return (
    repm.h('span')
      .a('class', 'fence-sec')
      .c(word)
  );
}

exports.prelude = String.raw`
<style>

.fence {
  margin-left: 1ch;
  padding: 1ch;
  padding-right: 0;
}
.fence-sec {
  font-weight: bold;
  margin-right: 1ch;
}
.fence-sec::after {
  content: '.';
}

.fence {
  position: relative;
}
.fence::before {
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
