const plib = require('path');
const child_process = require('child_process');

const { quire } = require('./quire.js');
const fss = quire('./fss.js');


/*

String builder.

cats = new Cats()
cats.add(s1, s2)  // add strings
str = cats.toString()  // build

cats = Cats.of(a, b, c)
  // start with some strings
  // a,b,c can be anything supporting .toString()

The name 'Cats' stands for 'concatenations', coming
from the fact that instances are internally
represented by an array of items to concatenate.

*/
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


// Lazy assignment
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
