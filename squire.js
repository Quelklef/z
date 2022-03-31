const fs = require('fs');
const plib = require('path');

const doSquire = true;

/*

Like require() but bypasses the cache if the file has changed

Used to correctly reload modules when running interactive.js and
javascript source is modified.

*/
exports.squire =
function squire(path) {
  // Don't do this at home, kids

  const caller = new Error().stack.split('\n')[2].match(/^[^\/]*(.+):.+:/)[1];
  path = plib.resolve(plib.dirname(caller), path);
  path = require.resolve(path);

  if (!doSquire)
    return require(path);

  const times = (squire.times = squire.times || {});

  let invalidate = false;

  if (!times[path]) {
    invalidate = true;
  }

  else {
    for (const mod of closure(path)) {
      const writet = +fs.statSync(mod.path).mtime;
      if (writet > times[path]) {
        times[path] = writet;
        invalidate = true;
        break;
      }
    }
  }

  if (invalidate)
    delete require.cache[path];

  return require(path);
}

function * closure(path) {
  const mod = require.cache[path];
  if (!mod) return;
  yield mod;
  for (const dep of mod.children)
    yield* closure(dep.path);
}
