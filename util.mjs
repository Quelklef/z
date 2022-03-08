import fs from 'fs';
import * as plib from 'path';
import * as child_process from 'child_process';


/*

Souped-up string builder

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

*/
export class Cats {

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


export function writeFile(loc, content) {
  fs.mkdirSync(plib.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, content);
}


export function * readdirRecursive(loc) {
  const ls = fs.readdirSync(loc, { withFileTypes: true });
  for (const elem of ls) {
    const eloc = plib.resolve(loc, elem.name);
    if (elem.isDirectory())
      yield * readdirRecursive(eloc)
    else
      yield eloc;
  }
}


export function withTempDir(fun) {
  let path = '/tmp/z-';
  for (let i = 0; i < 20; i++)
    path += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];

  fs.mkdirSync(path);
  try {
    return fun(path);
  } finally {
    fs.rmSync(path, { recursive: true });
  }
}

export function serialize(obj) {
  return JSON.stringify(toJson(obj));

  function toJson(obj) {
    if (obj === null || ['number', 'string', 'null', 'boolean'].includes(typeof obj))
      return obj;

    if (Array.isArray(obj))
      return obj.map(toJson);

    if (typeof obj === 'undefined')
      return { _type: 'undefined' };

    if (obj instanceof Set) {
      return toJson({
        _type: 'set',
        values: toJson([...obj]),
      });
    }

    if (Object.getPrototypeOf(obj) === Object.getPrototypeOf({})) {
      const json = {};
      for (const k in obj) {
        json[k] = toJson(obj[k]);
      }
      return json;
    }

    throw Error(`Cannot serialize a ${typeof obj} // ${Object.getPrototypeOf(obj).constructor.name}`);
  }
}

export function deserialize(str) {
  return fromJson(JSON.parse(str));

  function fromJson(json) {
    if (['number', 'string', 'null', 'boolean'].includes(typeof json))
      return json;

    if (Array.isArray(json))
      return json.map(fromJson);

    if (json._type === 'undefined')
      return undefined;

    if (json._type === 'set') {
      const items = fromJson(json.values);
      return new Set(items);
    }

    const obj = {};
    for (const k in json)
      obj[k] = fromJson(json[k]);
    return obj;
  }
}

// Lazy assignment
export function lazyAss(obj, key, lz) {
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

// Import a module, bypassing the cache
// This *will* leak memory when the file changes
// Modified from https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
export async function importFresh(path) {
  return await import(`${path}?update=${+fs.statSync(path).mtime}`);
}
