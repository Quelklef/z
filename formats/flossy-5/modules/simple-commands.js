
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
