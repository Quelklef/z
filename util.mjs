import fs from 'fs';
import * as plib from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';

export class Trie {
  constructor(strings) {
    this.isElement = Symbol("isElement");

    this.trie = {};
    strings = new Set(strings);
    for (const str of strings) {
      let root = this.trie;
      for (const ch of str)
        root = (root[ch] = root[ch] || {});
      root[this.isElement] = true;
    }
  }

  longestPrefixOf(string) {
    let result = null;
    let root = this.trie;
    let path = '';

    for (const ch of string) {
      if (root[this.isElement]) result = path;
      root = root[ch];
      path += ch;
      if (root === undefined) break;
    }
    if (root && root[this.isElement]) result = path;

    return result;
  }
}

export class StringBuilder {
  constructor() {
    this.chunks = [];
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

export function min(x, y) {
  return x < y ? x : y;
}

export function renderTikZ(source, env) {
  return env.cache.at([renderTikZ, source], () => {
    return withTempDir(tmp => {

      console.log(`Rendering LaTeX [${source.length}]`);

      const tex = String.raw`
        \documentclass{standalone}
        \usepackage{tikz}
        \usepackage{lmodern}
        \usepackage[T1]{fontenc}
        \begin{document}

        ${source}

        \end{document}
      `;
      fs.writeFileSync(plib.resolve(tmp, 'it.tex'), tex);

      const stdout =
        child_process.execSync(
          String.raw`
            cd ${tmp} \
            && latex it.tex >/dev/null \
            && { dvisvgm it.dvi --stdout | tail -n+3; }
          `);

      console.log(`Rendering LaTeX [done] [${source.length}]`);
      return stdout.toString();

    });
  });
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

export function mkEnv(root) {
  const croot = plib.resolve(root, '.cache');
  if (!fs.existsSync(croot))
    fs.mkdirSync(croot);

  return {

    cache: {
      _mkPath(keys) {
        let hash = crypto.createHash('md5');
        for (const key of keys)
          hash.update(key.toString())
        hash = hash.digest('hex');
        return plib.resolve(croot, hash);
      },

      get(keys) {
        const path = this._mkPath(keys);
        const text = fs.readFileSync(path).toString();
        return deserialize(text);
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
    },

  };
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

    throw Error(`Cannot serialize a ${typeof obj} // ${Object.getPrototypeOf(obj)}`);
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
    get() {
      const val = lz();
      Object.defineProperty(obj, key, { value: val });
      return val;
    }
  });
}
