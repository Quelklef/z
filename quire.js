const fs = require('fs');
const plib = require('path');

const doQuire = true;
const loadTimes = {};

/*

Like require() but bypasses the cache if the file has changed

Used to correctly reload modules when running interactive.js and
javascript source is modified.

*/
exports.quire =
function quire(path) {
  if (!doQuire) return require(path);

  // Don't do this at home, kids
  const caller = new Error().stack.split('\n')[2].match(/^[^\/]*(.+):.+:/)[1];
  path = plib.resolve(plib.dirname(caller), path);
  path = require.resolve(path);

  const loadt = loadTimes[path];
  const writet = +fs.statSync(path).mtime;
  if (!loadt || writet > loadt) {
    loadTimes[path] = writet;
    delete require.cache[path];
  }

  return require(path);
}
