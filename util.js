const plib = require('path');
const child_process = require('child_process');
const crypto = require('crypto');

const { squire } = require('./squire.js');
const fss = require('./fss.js');


// WANT: I did a benchmark and it seems that Cats is slower
//       than native string concat (on FF, at least)
/* String builder */
exports.Cats =
class Cats {

  constructor(...parts) {
    this.parts = parts;
  }

  clone() {
    return new Cats(...this.parts);
  }

  add(...parts) {
    for (const part of parts)
      if (part !== '')
        this.parts.push(part);
  }

  toString() {
    return this.parts.map(part => part.toString()).join('');
  }

}


/*
Lazy assignment

  lazyAss(obj, k, () => exp)

is morally equivalent to

  obj[k] = exp

Except that 'exp' is computed only
when obj[k] is first accessed.
*/
exports.lazyAss =
function lazyAss(obj, key, lz) {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get() {
      const val = lz();
      Object.defineProperty(obj, key, { value: val });
      return val;
    }
  });
}


/* App-wide standard hashing */
exports.hash =
function hash(...keys) {
  let hash = crypto.createHash('md5');
  for (const key of keys)
    hash.update(key.toString())
  return hash.digest('hex');
}


exports.iife =
function iife(f) {
  return f();
}
