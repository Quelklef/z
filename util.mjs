import fs from 'fs';
import * as plib from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';


export class StringBuilder {
  constructor() {
    this.chunks = [];
    this.pending = null;
  }

  add(s) {
    this.chunks.push(s);
  }

  build() {
    const r = this.chunks.join('');
    this.chunks = [r];
    return r;
  }
}


export const cache = {

  // cache.root is a pseudo-constant set at program start
  // This is bad code structure!
  // I chose to do it this way because parameter-drilling is
  // annoying and Javascript doesn't offer better solutions.
  set root(root) {
    root = plib.resolve(process.env.PWD, root);
    if (!fs.existsSync(root))
      fs.mkdirSync(root);
    this._root = root;
  },

  get root() {
    return this._root;
  },

  _mkPath(namespace, keys) {
    let hash = crypto.createHash('md5');
    for (const key of keys)
      hash.update(key.toString())
    hash = hash.digest('hex');
    return plib.resolve(this.root, namespace, hash);
  },

  get(namespace, keys) {
    const path = this._mkPath(namespace, keys);
    const text = fs.readFileSync(path).toString();
    return deserialize(text);
  },

  getOr(namespace, keys, fallback) {
    try {
      return this.get(namespace, keys);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      else throw e;
    }
  },

  has(namespace, keys) {
    return fs.existsSync(this._mkPath(namespace, keys));
  },

  put(namespace, keys, value) {
    const path = this._mkPath(namespace, keys);
    const text = serialize(value);
    writeFile(path, text);
  },

  at(namespace, keys, fun) {
    try {
      return this.get(namespace, keys);
    } catch (e) {
      if (e.code === 'ENOENT');  // file dne
      else throw e;
    }

    const result = fun();
    this.put(namespace, keys, result);
    return result;
  },

};


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
