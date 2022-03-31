const fs = require('fs');
const plib = require('path');

const doQuire = true;
const loadTimes = {};

/*

TODO:
1. Rename to squire
2. Expose a function which returns the transitive closure of the
   deps of the given module, or the sources thereof.
   Useful in combination with cacheKeys for automagic reload on
   dependency change!

... Y'know, I think this module can be made "magic" by having it
    monkeypatch global.require.

*/

/*

Like require() but bypasses the cache if the file has changed

Used to correctly reload modules when running interactive.js and
javascript source is modified.

*/
exports.quire =
function quire(path) {

  // Don't do this at home, kids
  const caller = new Error().stack.split('\n')[2].match(/^[^\/]*(.+):.+:/)[1];
  path = plib.resolve(plib.dirname(caller), path);
  path = require.resolve(path);

  if (!doQuire)
    return require(path);

  const loadt = loadTimes[path];
  const writet = +fs.statSync(path).mtime;
  if (!loadt || writet > loadt) {
    loadTimes[path] = writet;
    delete require.cache[path];
  }

  return require(path);
}
