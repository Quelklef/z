const crypto = require('crypto');
const plib = require('path');
const fs = require('fs');

const { writeFile } = require('./util.js');


exports.mkEnv =
function mkEnv(args) {

  args.root;
  args.cacheRoot;
  args.logPrefixes ||= [];

  const env = {};
  env.parent = null;

  env.root = args.root;

  env.cache = new Cache(args.cacheRoot);
  env.log = new Logger(args.logPrefixes);

  env.descend = function() {
    const child = mkEnv({
      root: args.root,
      cacheRoot: args.cacheRoot,
      logPrefixes: [...args.logPrefixes],
    });
    child.parent = this;
    return child;
  }

  return env;

}


class Cache {

  constructor(root) {
    this.root = plib.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  _mkPath(ns, keys) {
    let hash = crypto.createHash('md5');
    for (const key of keys)
      hash.update(key.toString())
    hash = hash.digest('hex');
    return plib.resolve(this.root, ns, hash);
  }

  get(ns, keys) {
    const path = this._mkPath(ns, keys);
    const text = fs.readFileSync(path).toString();
    return deserialize(text);
  }

  getOr(ns, keys, fallback) {
    try {
      return this.get(ns, keys);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      else throw e;
    }
  }

  has(ns, keys) {
    return fs.existsSync(this._mkPath(ns, keys));
  }

  put(ns, keys, value) {
    const path = this._mkPath(ns, keys);
    const text = serialize(value);
    writeFile(path, text);
  }

  at(ns, keys, fun) {
    try {
      return this.get(ns, keys);
    } catch (e) {
      if (e.code === 'ENOENT');  // file dne
      else throw e;
    }

    const result = fun();
    this.put(ns, keys, result);
    return result;
  }

  clear() {
    fs.rmSync(this.root, { recursive: true });
    fs.mkdirSync(this.root);
  }

  getNamespaces() {
    return fs.readdirSync(this.root);
  }

  clearNamespace(ns) {
    const nsLoc = plib.resolve(this.root, ns);
    if (fs.existsSync(nsLoc))
      fs.rmSync(nsLoc, { recursive: true });
  }

}


class Logger {

  constructor(prefixes) {
    this.prefixes = prefixes;
  }

  mkPrefix(fst) {
    return [].concat([fst], this.prefixes.map(p => `(${p})`)).join(' ');
  }

  info(...a) {
    console.log(this.mkPrefix('[info]'), ...a);
  }

  warn(...a) {
    console.log(this.mkPrefix('[WARN]'), ...a);
  }

}


function serialize(obj) {
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


function deserialize(str) {
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
