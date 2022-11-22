const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


exports.commands['unsafe-raw-html'] = function(s) {
  s.quasi.env.env.log.warn(`use of \\unsafe-raw-html`);
  p.p_spaces(s);
  const [html, _] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return new repm.Seq(html);
}

exports.commands['unsafe-exec'] =
function unsafe_exec(s) {
  s.quasi.env.env.log.warn(`use of \\unsafe-exec`);

  p.p_whitespace(s);
  const [body, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);

  const code =
    kind === 'inline'
      ? body.toString()
    : kind === 'block'
      ? `(function(){\n${body}\n})()`
    : null;

  // Set up eval() environment
  const parse = str => {
    return p.local(s, s => {
      s.text = str;
      const i0 = s.i;
      s.i = 0;
      s.sentinel = s => s.i >= s.text.length;
      const r = p.p_toplevel_markup(s);
      s.i = i0;
      return r;
    });
  };

  return eval(code) || '';
}
