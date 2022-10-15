const plib = require('path');

const { squire } = require('../../squire.js');
const { lazyAss, Cats, hash } = squire('../../util.js');
const { indexOf } = squire('./util.js');
const fss = squire('../../fss.js');
const repm = squire('./repm.js');
const p = squire('./parse.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();


function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  env = env.descend();
  env.log.prefixes.push('note=' + noteId.toString());

  const note = {};

  note.source = source;
  note.source += '\n';  // allows parsers to assume lines end with \n

  // WANT: some way to include entire script closure instead of just scriptSrc?
  note.hash = hash(floc, source, scriptSrc);

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
    { parsers [optional] :: Array (Parser Rep)
    , commands [optional] :: Map String (Parser Rep)
    , prelude [optional] :: String
    , StateT [optiona] :: Array String
    }

  */
  const modules = {
    indent      : squire('./modules/indent.js'),
    base        : squire('./modules/base.js'),
    tex         : squire('./modules/tex.js'),
    annotations : squire('./modules/annotations.js'),
    mermaid     : squire('./modules/mermaid.js'),
    given       : squire('./modules/given.js'),
    jargon      : squire('./modules/jargon.js')({ graph, note, doImplicitReferences }),
    table       : squire('./modules/table.js'),
  };

  const s = p.initState({

    text: text,

    // Environmental references
    // These are very powerful!
    quasi: { env: { graph, note, env } },

    modules: [
      ...Object.values(modules),
      {
        parsers: [p_command],
        commands: {
          scope: command_scope
        },
      }
    ],

  });

  // Parse format header, metadata, and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  const meta = p_noteMetadata(s);
  if (meta) s.quasi.env.env.log.info('metadata is', meta);
  if (s.text[s.i] === '\n') s.i++;

  // Parse note body
  const noteRep = new repm.Seq();
  const done = s => s.i >= s.text.length;
  noteRep.add(p.p_toplevel_markup(s, done));

  const result = {};
  result.meta = meta;
  lazyAss(result, 'rep', () => {
    const prelude = new Cats();
    for (const module of Object.values(modules))
      prelude.add(module.prelude ?? '');
    return template(prelude.toString(), noteRep);
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
  return p_jsExpr(s);
}

function p_jsExpr(s) {
  const [expr, _] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return eval('(' + expr + ')');
}


// Execute a backslash command
function p_command(s) {
  const xi0 = s.i;
  if (s.text[s.i] !== '\\') return '';
  s.i++;

  p.p_spaces(s);

  const name = p.p_word(s);

  const command = s.commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}

// Local evaluator modification
function command_scope(s) {
  p.p_spaces(s);
  const json = p_jsExpr(s);
  p.p_spaces(s);

  return p.local(s, s => {
    if ('inferReferences' in json)
      s.doImplicitReferences = !!json['inferReferences'];
    const [r, _] = p.p_enclosed(s, p.p_toplevel_markup);
    return r;
  });
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



function sample_s(s, linec = 4) {
  return sample(s.text, s.i, linec);

  function sample(str, from = 0, linec = 5) {
    return ruled(str.toString().slice(from).split('\n').slice(0, linec).join('\n'));
  }

  function ruled(str, pref='>|') {
    const bar = '------';
    return [bar, ...str.toString().split('\n').map(l => pref + l.replace(/ /g, '⋅')), bar].join('\n');
  }
}
