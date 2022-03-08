import * as crypto from 'crypto';
import * as plib from 'path';
import * as fs from 'fs';

import { writeFile, serialize, deserialize } from './util.mjs';

class Cache {

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

export function mkEnv(args) {

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
