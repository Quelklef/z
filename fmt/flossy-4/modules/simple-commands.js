const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';

// Italic, bold, underline, strikethrough
for (const tag of 'ibus') {
  exports.commands[tag] = function(s) {
    return new repm.Seq(`<${tag}>`, p.p_inline(s, p.p_toplevel_markup), `</${tag}>`);
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
  p.p_spaces(s)
  p.p_take(s, '<');
  const href = p.p_takeTo(s, '>');
  p.p_take(s, '>');
  p.p_spaces(s)

  const body = p.local(s, s => {
    // Nested <a> tags are forbidden in HTML
    s.doImplicitReferences = false;
    return p.p_inline(s, p.p_toplevel_markup);
  });

  return new repm.Seq(`<a href="${href}" class="ext-reference" target="_blank">`, body, "</a>");
}
