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

  _mkPath(keys) {
    let hash = crypto.createHash('md5');
    for (const key of keys)
      hash.update(key.toString())
    hash = hash.digest('hex');
    return plib.resolve(this.root, hash);
  },

  get(keys) {
    const path = this._mkPath(keys);
    const text = fs.readFileSync(path).toString();
    return deserialize(text);
  },

  getOr(keys, fallback) {
    try {
      return this.get(keys);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      else throw e;
    }
  },

  has(keys) {
    return fs.existsSync(this._mkPath(keys));
  },

  put(keys, value) {
    const path = this._mkPath(keys);
    const text = serialize(value);
    fs.writeFileSync(path, text);
  },

  at(keys, fun) {
    try {
      return this.get(keys);
    } catch (e) {
      if (e.code === 'ENOENT');  // file dne
      else throw e;
    }

    const result = fun();
    this.put(keys, result);
    return result;
  },

};

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
