const { squire } = require('../../squire.js');
const { Cats } = require('../../util.js');

const Trie =
exports.Trie =
class Trie {
  constructor(strings) {
    this.isElement = Symbol("isElement");

    this.trie = {};
    strings = new Set(strings);
    for (const str of strings) {
      let root = this.trie;
      for (const ch of str)
        root = (root[ch] = root[ch] || {});
      root[this.isElement] = true;
    }
  }

  longestPrefixOf(str, i0) {
    let result = null;
    let root = this.trie;
    let path = [];

    for (let i = i0; i < str.length; i++) {
      const ch = str[i];
      if (root[this.isElement]) result = path.join('');
      root = root[ch];
      path.push(ch);
      if (root === undefined) break;
    }
    if (root && root[this.isElement])
      result = path.join('');

    return result;
  }
}

// WANT: rename
// WANT: move into parse.js
// indexOf but on fail return str.length instead of -1
const indexOf =
exports.indexOf =
function indexOf(str, sub, from = 0) {
  let result = str.indexOf(sub, from);
  if (result === -1) result = str.length;
  return result;
}

const impossible =
exports.impossible =
function impossible(msg = '') {
  throw Error('uh oh... [' + msg.toString() + ']');
}


const htmlEscapes =
exports.htmlEscapes =
{
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
};

const escapeHtml =
exports.escapeHtml =
function escapeHtml(s) {
  return [...s].map(c => htmlEscapes[c] || c).join('');
}
