const fs = require('fs');


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

  path = require.resolve(path);

  const loadt = loadTimes[path];
  const writet = +fs.statSync(path).mtime;
  if (!loadt || writet > loadt) {
    loadTimes[path] = writet;
    delete require.cache[path];
  }

  return require(path);
}
