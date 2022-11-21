const plib = require('path');

const clc = require('cli-color');

const { squire } = require('./squire.js');
const { hash, writeFile } = require('./util.js');
const fss = require('./fss.js');


exports.mkEnv =
function mkEnv(args) {

  args.cacheRoot;
  args.logPrefixes ||= [];

  const env = {};
  env.parent = null;

  // reader monad
  env.opts = args.opts;

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

  constructor(root) {
    this.root = plib.resolve(root);
    fss.mkdir(this.root);
  }

  _mkPath(ns, keys) {
    return plib.resolve(this.root, ns, hash(...keys));
  }

  get(ns, keys) {
    const path = this._mkPath(ns, keys);
    const text = fss.read(path);
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
    return fss.exists(this._mkPath(ns, keys));
  }

  put(ns, keys, value) {
    const path = this._mkPath(ns, keys);
    const text = serialize(value);
    fss.write(path, text);
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
    fss.remove(this.root);
    fss.mkdir(this.root);
  }

  getNamespaces() {
    return [...fss.list(this.root, { type: 'd' })].map(loc => plib.relative(this.root, loc));
  }

  clearNamespace(ns) {
    const nsLoc = plib.resolve(this.root, ns);
    if (fss.exists(nsLoc))
      fss.remove(nsLoc);
  }

}


class Logger {

  constructor(prefixes) {
    this.prefixes = prefixes;
  }

  generic(color, fst, ...args) {
    const prefix = [color(fst), ...this.prefixes.map(p => `(${p})`)].join(' ');
    console.log(prefix, ...args);
  }

  info(...a) {
    this.generic(clc.blue, 'info', ...a);
  }

  success(...a) {
    this.generic(clc.green, 'succ', ...a);
  }

  warn(...a) {
    this.generic(clc.bold.yellow, 'WARN', ...a);
  }

  error(...a) {
    this.generic(clc.bold.red, 'ERR ', ...a);
  }

  debug(...a) {
    this.generic(clc.bold.magenta, 'DEBG', ...a);
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

    if (json === null)
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
