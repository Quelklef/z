
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


exports.commands.quote = function(s) {
  p.p_spaces(s);
  const [body, _] = p.p_enclosed(s, p.p_toplevel_markup);
  return repm.mkSeq('<blockquote>', body, '</blockquote>');
}

exports.prelude += String.raw`
<style>

blockquote {
  margin: 0;
  padding-left: 1em;
  border-left: 4px solid rgba(0, 0, 0, 0.1);
  position: relative;
}
blockquote::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 4px;
  width: 30px;
  height: 30px;
  opacity: 0.05;
  pointer-events: none;
  background-size: cover;
  background-position: center;
  background-image: url(data:image/png;base64,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);
}

</style>
`;
