const plib = require('path');
const child_process = require('child_process');

const { quire } = require('./quire.js');
const fss = quire('./fss.js');


/*

Souped-up string builder.

cats = new Cats()
cats.add(s1, s2)  // add strings
str = cats.toString()  // build

cats = Cats.of(a, b, c)
  // start with some strings
  // a,b,c can be anything supporting .toString()

cats = Cats.on(s)  // enables the following...
cats.addFromSource(i)
  // is equivalent to cats.add(s[i]), except that
  //   cats.addFromSource(i); cats.addFromSource(i + 1)
  // is more efficient than
  //   cats.add(s[i]); cats.add(s[i + 1])

The name 'Cats' stands for 'concatenations', coming
from the fact that instances are internally
represented by an array of items to concatenate.

*/
exports.Cats =
class Cats {

  constructor() {
    this.parts = [];
    this.source = null;
    this.pending = null;
  }

  static of(...parts) {
    const cats = new Cats();
    cats.add(...parts);
    return cats;
  }

  static on(source) {
    const cats = new Cats();
    cats.source = source;
    return cats;
  }

  clone() {
    const c = new Cats();
    c.source = this.source;
    c.parts = [...this.parts];
    if (this.pending)
      c.pending = [...this.pending];
    return c;
  }

  add(...parts) {
    this._resolve();
    for (const part of parts) {
      const str = part.toString();
      if (str) this.parts.push(str);
    }
  }

  _resolve() {
    if (this.pending) {
      const [i, j] = this.pending;
      this.parts.push(this.source.slice(i, j));
      this.pending = null;
    }
  }

  addFromSource(i) {
    if (!this.source)
      throw Error("Cannot addFromSource on Cats with no source")

    if (this.pending && this.pending[1] + 1 === i) {
      this.pending[1]++;
    } else {
      this._resolve();
      this.pending = [i, i + 1];
    }
  }

  toString() {
    this._resolve();
    const result = this.parts.map(c => c).join('');
    this.parts = [result];
    return result;
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
