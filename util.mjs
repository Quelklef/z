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

      return await new Promise((resolve, reject) => {
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

export function mkEnv(root) {
  return {

    cache: {
      async at(keys, fun) {

        const croot = plib.resolve(root, '.cache');
        if (!await fsExists(croot))
          await fs.mkdir(croot);

        let path;
        {
          let hash = crypto.createHash('md5');
          for (const key of keys)
            hash.update(key.toString())
          hash = hash.digest('hex');
          path = plib.resolve(croot, hash);
        }

        try {
          return await fs.readFile(path);
        } catch (e) {
          if (e.code === 'ENOENT');  // file dne
          else throw e;
        }

        const result = await fun();
        await fs.writeFile(path, result);
        return result;

      }
    },

  };
}
