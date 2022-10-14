
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

// Clone a sufficiently-simple object
const clone =
exports.clone =
function clone(val) {
  if (val === null || typeof val !== 'object')
    return val;

  if (Array.isArray(val))
    return [...val].map(clone);

  if (val instanceof Set)
    return new Set([...val].map(clone));

  if (Object.getPrototypeOf(val) !== Object.prototype)
    throw `Refusing to clone non-plain object of type '${Object.getPrototypeOf(val).constructor.name}'`;

  const res = {};
  for (const k in val)
    res[k] = clone(val[k]);
  return res;
}


// Shallow-clone an iterator
// Recommendation: don't use this
const cloneIterator =
exports.cloneIterator =
function cloneIterator(iter) {

  const next = iter.next.bind(iter);

  const queue = [];
  const idxs = { left: 0, right: 0 };

  function lrNext(lr) {

    if (queue.length <= idxs[lr]) {
      const { value, done } = next();
      if (done)
        return { value: null, done: true };
      queue.push(value);
    }

    const value = queue[idxs[lr]];
    idxs[lr]++;

    if (idxs.left > 0 && idxs.right > 0) {
      queue.splice(0, 1);
      idxs.left--;
      idxs.right--;
    }

    return { value, done: false };
  }

  const left = iter;
  left.next = () => lrNext('left');

  const right = {};
  right.next = () => lrNext('right');

  return right;

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
