const hljs = require('highlight.js');

const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';

// -------------------------------------------------------------------------- //
// \title and \sec
// -------------------------------------------------------------------------- //

// Title
exports.commands.title = function(s) {
  return repm.mkSeq('<div class="title">', p.p_block(s, p.p_toplevel_markup), '</div>');
}

// Section header
exports.commands.sec = function(s) {
  return repm.mkSeq('<div class="section-header">', p.p_block(s, p.p_toplevel_markup), '</div>');
}

exports.prelude += String.raw`
<style>

.title {
  font-weight: bold;
  color: var(--color-static);
  font-size: 18px;
  margin-bottom: 1em;
}

.section-header {
  font-weight: bold;
  color: var(--color-static);
  border-bottom: 1px dotted var(--color-static);
}

hr {
  border: none;
  border-bottom: 1px dashed rgb(200, 200, 200);
}

</style>
`;
