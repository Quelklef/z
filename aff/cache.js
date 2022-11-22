const plib = require('path');

const { hash, writeFile } = require('../util.js');
const { serialize, deserialize } = require('../plain.js');

const mkCache =
exports.mkCache =
function(aff, root) {

  const { fss } = aff;

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

  return new Cache(root);

}
