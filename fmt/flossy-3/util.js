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

// Knows how to clone a blessed set of types
// Assumes that functions are pure and not monkeypatched!
const clone =
exports.clone =
function clone(val) {

  // Assumes we're not monkeypatching functions
  if (typeof val === 'function' || val instanceof Function)
    return val;

  if (val === null || typeof val !== 'object')
    return val;

  if (val instanceof Array)
    return [...val].map(clone);

  if (val instanceof Set)
    return new Set([...val].map(clone));

  // idk why "val instanceof Cats" doesnt work
  if (val.constructor.name === 'Cats')
    return val.clone();

  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype) {
    throw Error(`Refusing to clone non-plain value of type '${proto.constructor.name}'!`);
  }

  const res = {};
  for (const k in val)
    res[k] = clone(val[k]);
  return res;

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
