const { squire } = require('../../../squire.js');
const repm = squire('../repm.js');
const p = squire('../parse.js');
const { Cats } = squire('../../../util.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = squire('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';

exports.nonlocalStateKeys = [ 'markCounter', 'markMap' ];
exports.stateInit = {
  markCounter: 1,
  markMap: {},
};


exports.commands.mdef = function(s) {
  p.p_spaces(s);
  const name = p_angleString(s);
  p.p_backtracking(s, s => p.p_take(s, ';'));
  const index = (s.markCounter++);
  s.markMap[name] = index;
  return new repm.Seq(
    `<span class="mark-def" id="mark-${index}">`,
    '(✸' + index + ')',
    `</span>`,
  );
}

exports.commands.mref = function(s) {
  p.p_spaces(s);
  const name = p_angleString(s);
  p.p_backtracking(s, s => p.p_take(s, ';'));
  const index = s.markMap[name];
  return new repm.Seq(
    `<a href="#mark-${index}">`,
    '(✸' + index + ')',
    `</span>`,
  );
}

function p_angleString(s) {
  p.p_take(s, '<');
  const from = s.i;
  while (s.text[s.i] !== '>')
    s.i++;
  const result = s.text.slice(from, s.i);
  s.i++;
  return result;
}

