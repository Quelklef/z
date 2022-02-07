import { promises as fs } from 'fs';
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

export async function fsExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
};

export async function renderTikZ(source, env) {
  return await env.cache.at([renderTikZ, source], async () => {
    return await withTempDir(async tmp => {

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
      await fs.writeFile(plib.resolve(tmp, 'it.tex'), tex);

      const result = await new Promise((resolve, reject) => {
        child_process.exec(
          String.raw`
            cd ${tmp} \
            && latex it.tex >/dev/null \
            && { dvisvgm it.dvi --stdout | tail -n+3; }
          `,
          (error, stdout, stderr) => {
            if (error) reject(error);
            resolve(stdout.toString());
          }
        )
      });

      console.log(`Rendering LaTeX [done] [${source.length}]`);
      return result;

    });
  });
}

export async function withTempDir(fun) {
  let path = '/tmp/z-';
  for (let i = 0; i < 20; i++)
    path += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];

  await fs.mkdir(path);
  try {
    return await fun(path);
  } finally {
    await fs.rm(path, { recursive: true });
  }
}

export async function mkEnv(root) {
  const croot = plib.resolve(root, '.cache');
  if (!await fsExists(croot))
    await fs.mkdir(croot);

  return {

    cache: {
      _mkPath(keys) {
        let hash = crypto.createHash('md5');
        for (const key of keys)
          hash.update(key.toString())
        hash = hash.digest('hex');
        return plib.resolve(croot, hash);
      },

      async get(keys) {
        const path = this._mkPath(keys);
        const text = (await fs.readFile(path)).toString();
        return deserialize(text);
      },

      async has(keys) {
        return await fsExists(this._mkPath(keys));
      },

      async put(keys, value) {
        const path = this._mkPath(keys);
        const text = serialize(value);
        await fs.writeFile(path, text);
      },

      async at(keys, fun) {
        try {
          return await this.get(keys);
        } catch (e) {
          if (e.code === 'ENOENT');  // file dne
          else throw e;
        }

        const result = await fun();
        await this.put(keys, result);
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
