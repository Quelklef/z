
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


// -------------------------------------------------------------------------- //
// some simple stuff
// -------------------------------------------------------------------------- //

// nb. This has to come before p_sigils so that
//     precedence is right.
exports.parsers.push(p_hr);
function p_hr(s) {
  if (!p.isStartOfLine(s)) return '';
  const eol = indexOf(s.text, '\n', s.i);
  if (
    s.text.startsWith('---', s.i)
    && s.text.slice(s.i + 3, eol).trim() === ''
  ) {
    s.i = eol + 1;
    return '<hr />';
  }
  return '';
}

const sigilMapping = {
  '<->': '&harr;',
  '->': '&rarr;',
  '<-': '&larr;',
  '<=>': '&hArr;',
  '=>': '&rArr;',
  '<=': '&lArr;',
  '<-->': '&xharr;',
  '-->': '&xrarr;',
  '<--': '&xlarr;',
  '<==>': '&xhArr;',
  '==>': '&xrArr;',
  '<==': '&xlArr;',

  '--': '&mdash;',

  '{sec}': '§',
  '{para}': '¶',
};

const sigilTrie = new Trie(Object.keys(sigilMapping));

exports.parsers.push(p_sigils);
function p_sigils(s) {
  const sigil = sigilTrie.longestPrefixOf(s.text, s.i);
  if (!sigil) return '';
  s.i += sigil.length;
  return sigilMapping[sigil];
}


exports.parsers.push(p_escapes);
function p_escapes(s) {
  const c = s.text[s.i];
  if (c in htmlEscapes) {
    s.i++;
    return htmlEscapes[c];
  } else {
    return '';
  }
}

// Fancy quote marks
exports.parsers.push(p_quotes);
function p_quotes(s) {
  if (!`'"`.includes(s.text[s.i])) return '';

  const isletter = c => !!(c || '').match(/[a-zA-Z]/);
  const quot = s.text[s.i];
  const before = isletter(s.text[s.i - 1]);
  const after = isletter(s.text[s.i + 1]);

  const mapping = {
    [`true ' true`]: `’`,
    [`true " true`]: `”`,
    [`true ' false`]: `’`,
    [`true " false`]: `”`,
    [`false ' true`]: `‘`,
    [`false " true`]: `“`,
    [`false ' false`]: `'`,
    [`false " false`]: `"`,
  };

  const fancy = mapping[before + ' ' + quot + ' ' + after];
  s.i++;
  return fancy;
}

// Lines containing only a minus and whitespace are not emitted
exports.parsers.push(p_skipLine);
function p_skipLine(s) {
  const eol = indexOf(s.text, '\n', s.i);
  if (
    p.isStartOfLine(s)
    && s.text[s.i] === '-'
    && s.text.slice(s.i + 1, eol).trim() === ''
  ) {
    s.i = eol + 1;
  }
  return '';
}


