const fs = require('fs');
const plib = require('path');

/*

Append all sources from a module and its closure

Uhh... use this *after* all require() imports.
(to ensure require.cache populated so closure() works as intended)

*/
exports.closureStr =
function closureStr(path) {
  let result = '';
  for (const mod of closure(path)) {
    result += fs.readFileSync(mod.filename);
  }
  return result;
}

function * closure(path) {
  const mod = require.cache[path];
  if (!mod) return;
  yield mod;
  for (const dep of mod.children)
    yield* closure(dep.path);
}
