const plib = require('path');

const { squire, closureStr } = require('../../squire.js');
const { lazyAss, Cats, hash } = require('../../util.js');
const { indexOf } = require('./util.js');
const fss = require('../../aff/fss.js');  // FIXME: direct affordance import (bad!)
const repm = require('./repm.js');
const p = require('./parse.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}


function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  const note = {};

  note.source = source;
  note.source += '\n';  // allows parsers to assume lines end with \n

  note.hash = hash(floc, source, closureStr(__filename));

  note.id = noteId;

  // note[t] holds transient (non-cached) data
  const t = Symbol('flossy-3.t');
  Object.defineProperty(note, t, { enumerable: false, value: {} });

  lazyAss(note[t], 'phase1', () => {
    env.parent.log.info('parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: false,
    });
  });

  lazyAss(note, 'starred', () =>
    note[t].phase1.meta?.starred === true);

  lazyAss(note, 'defines', () =>
    note[t].phase1.defines);

  lazyAss(note[t], 'phase2', () => {
    env.parent.log.info('parsing (again)', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
    });
  });

  lazyAss(note, 'references', () =>
    note[t].phase2.references);

  lazyAss(note, 'html', () => {
    const noteRep = note[t].phase2.rep;
    env.parent.log.info('rendering', note.id);
    return noteRep.toHtml(env);
  });

  return note;
}




function parse({
  text,
  doImplicitReferences,
  graph,
  note,
  env,
}) {

  /*

  type Module ≅
    { parsers           [optional] :: Array (Parser Rep)
    , commands          [optional] :: Map String (Parser Rep)
    , prelude           [optional] :: String
    , nonlocalStateKeys [optional] :: Array String
    }

  */
  const modules = {
    base        : require('./modules/base.js'),
    tex         : require('./modules/tex.js'),
    annotations : require('./modules/annotations.js'),
    mark        : require('./modules/mark.js'),
    mermaid     : require('./modules/mermaid.js'),
    given       : require('./modules/given.js'),
    jargon      : require('./modules/jargon.js')({ graph, note, doImplicitReferences }),
    table       : require('./modules/table.js'),
    columns     : require('./modules/columns.js'),
  };

  const s = p.initState({

    text: text,

    // Environmental references
    // These are very powerful!
    quasi: { env: { graph, note, env } },

    modules: Object.values(modules),

  });

  // Skip format header
  s.i = indexOf(s.text, '\n', s.i) + 1;

  // Parse metadata
  const meta = p_noteMetadata(s);
  if (meta) s.quasi.env.env.log.info('metadata is', meta);

  // Parse note body
  const { rep, prelude } = p.p_run(s);

  const result = {};
  result.meta = meta;
  lazyAss(result, 'rep', () => {
    return template(prelude, rep);
  });
  lazyAss(result, 'references', () => {
    const rep = result.rep;
    const references = new Set([
      ...modules.base.getExplicitReferences(rep),
      ...modules.jargon.getImplicitReferences(rep),
    ]);
    return references;
  })
  lazyAss(result, 'defines', () => {
    const rep = result.rep;
    const defines = modules.jargon.getDefines(rep)
    return defines;
  });
  return result;

}


function p_noteMetadata(s) {
  if (!s.text.startsWith('meta:', s.i))
    return null;

  p.p_take(s, 'meta');
  return p.p_jsExpr(s);
}



function template(prelude, html) {
  return new repm.Seq(String.raw`
<!DOCTYPE HTML>
<html>
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
`, prelude, `
<style>

* {
  box-sizing: border-box;
}

:root {
  --color-static-rgb: 117, 19, 128;
  --color-static: rgb(var(--color-static-rgb));

  --color-dynamic-rgb: 204, 0, 102;
  --color-dynamic: rgb(var(--color-dynamic-rgb));
}

body {
  margin: 0;
  font-size: 0;
}

main {
  white-space: pre-wrap;
  font-size: 14px;
  font-family: 'Merriweather', serif;
  line-height: 1.5em;
}

a {
  color: var(--color-dynamic);
}

@media print {
  .hide-on-print {
    display: none;
  }
}

</style>
<script>

// <-> URL sync helpers
// Blunt, but it works
// Used by several format modules
// WANT: better API

window.urlSynchronizedState = {};

function syncToUrl() {
  const url0 = new URL(window.location.href);
  url0.searchParams.set('state', JSON.stringify(window.urlSynchronizedState));
  window.history.pushState(null, '', url0.toString());
}

function syncFromUrl() {
  const url = new URL(window.location.href);
  const str = url.searchParams.get('state')
  window.urlSynchronizedState = JSON.parse(str) || {};
}

syncFromUrl();

</script>

</head>
<body>

<main>`, html, `</main>

</body>
</html>
`);
}
