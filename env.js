const crypto = require('crypto');
const plib = require('path');
const fs = require('fs');

const { writeFile } = require('./util.js');


exports.mkEnv =
function mkEnv(args) {

  args.cacheRoot;
  args.logPrefixes ||= [];

  const env = {};
  env.parent = null;
  env.cache = new Cache(args.cacheRoot);
  env.log = new Logger(args.logPrefixes);

  env.descend = function() {
    const child = mkEnv({
      cacheRoot: args.cacheRoot,
      logPrefixes: [...args.logPrefixes],
    });
    child.parent = this;
    return child;
  }

  return env;

}


class Cache {

  // TODO:
  // cache.clear()
  // cache.getNamespaces()
  // cache.clearNamespace(ns)

  constructor(root) {
    this.root = root;
  }

  _mkPath(namespace, keys) {
    let hash = crypto.createHash('md5');
    for (const key of keys)
      hash.update(key.toString())
    hash = hash.digest('hex');
    return plib.resolve(this.root, namespace, hash);
  }

  get(namespace, keys) {
    const path = this._mkPath(namespace, keys);
    const text = fs.readFileSync(path).toString();
    return deserialize(text);
  }

  getOr(namespace, keys, fallback) {
    try {
      return this.get(namespace, keys);
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      else throw e;
    }
  }

  has(namespace, keys) {
    return fs.existsSync(this._mkPath(namespace, keys));
  }

  put(namespace, keys, value) {
    const path = this._mkPath(namespace, keys);
    const text = serialize(value);
    writeFile(path, text);
  }

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
