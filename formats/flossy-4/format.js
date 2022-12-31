const plib = require('path');

const { closureStr } = require('../../squire.js');
const { lazyAss, hash } = require('../../util.js');
const { indexOf } = require('./util.js');
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

  // Parsing proceeds in two phases. In phase (1) we parse for
  // metadata only, such as what jargon is defined in each note.
  // In phase (2) we parse "for real" and render to HTML.
  //
  // This two-step process is necessary because all notes are
  // given all jargon information about all notes; there is no
  // dependency DAG for jargon. This means that first all jargon
  // information for all notes must be obtained *at the same
  // time* before any "real" parsing can happen.

  lazyAss(note[t], 'phase1', () => {
    env.log.info('parsing', note.id);
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
    env.log.info('parsing (again)', note.id);
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
    env.log.info('rendering', note.id);
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
  let referenceMod, jargonMod, sectionsMod;
  const modules = [
                    require('./modules/simple.js'),
                    require('./modules/unsafe.js'),
                    require('./modules/simple-commands.js'),
    (jargonMod    = require('./modules/jargon.js')({ graph, note, doImplicitReferences })),
    (referenceMod = require('./modules/reference.js')),
    (sectionsMod  = require('./modules/sections.js')),
                    require('./modules/annotations.js'),
                    require('./modules/quote-command.js'),
                    require('./modules/code.js'),
                    require('./modules/marks.js'),
                    require('./modules/tables.js'),
                    require('./modules/columns.js'),
                    require('./modules/tex.js'),
  ];

  const s = p.initState({

    text: text,

    // Environmental references
    // These are very powerful!
    quasi: { env: { graph, note, env } },

    modules: modules,

  });

  // Skip format header
  s.i = indexOf(s.text, '\n', s.i) + 1;

  // Parse metadata
  const meta = p_noteMetadata(s);
  if (meta) s.quasi.env.env.log.info('metadata is', meta);

  // Parse note body
  const { rep, prelude } = p.p_run(s);

  sectionsMod.renderToc(rep);

  const result = {};
  result.meta = meta;
  lazyAss(result, 'rep', () => {
    return template(prelude, rep);
  });
  lazyAss(result, 'references', () => {
    const rep = result.rep;
    const references = new Set([
      ...referenceMod.getExplicitReferences(rep),
      ...jargonMod.getImplicitReferences(rep),
    ]);
    return references;
  })
  lazyAss(result, 'defines', () => {
    const rep = result.rep;
    const defines = jargonMod.getDefines(rep)
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
  return repm.mkSeq(String.raw`
<!DOCTYPE HTML>
<html>
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif&display=swap">
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
  font-size: 14.5px;
  font-family: 'Noto Serif', serif;
  line-height: 1.4em;
}

main code {
  font-family: monospace;
  font-size: .9em;
  letter-spacing: -0.01em;
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

