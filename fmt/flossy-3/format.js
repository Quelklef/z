const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const fss = squire('../../fss.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../util.js');
const rep = squire('./rep.js');
const { clone, Trie, indexOf, impossible, cloneIterator } = squire('./util.js');
// WANT: switch from p_ prefix to p. module
const { p_block, p_inline, p_enclosed, p_toplevel, p_toplevel_markup, p_toplevel_verbatim, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('./parsing.js');
const state = squire('./state.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();


function mkNote(floc, source, graph, env) {

  /*

  type Rep
    ≅ String
    | Cats
    | ({ toHtml :: () -> String
       , children :: () -> Array Rep
       })

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
    jargon      : squire('./modules/jargon.js'),
    table       : squire('./modules/table.js'),
  };

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
      modules,
    });
  });

  lazyAss(note, 'starred', () => {
    return note[t].phase1.meta?.starred === true;
  });

  lazyAss(note, 'defines', () => {
    const noteRep = note[t].phase1.rep;
    const defines = new Set();
    rep.traverse(noteRep, node => {
      if (node instanceof modules.jargon.Jargon) {
        for (const form of node.forms) {
          defines.add(form);
        }
      }
    });
    return defines;
  });

  lazyAss(note[t], 'phase2', () => {
    env.parent.log.info('parsing (again)', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: true,
      modules,
    });
  });

  lazyAss(note, 'references', () => {
    const noteRep = note[t].phase2.rep;
    const references = new Set();
    rep.traverse(noteRep, node => {
      if (node instanceof modules.jargon.Implicit) {
        references.add(node.toNote.id);
      } else if (node instanceof modules.base.Explicit) {
        if (!!node.toNote)
          references.add(node.toNote.id);
      }
    });
    return references;
  });

  lazyAss(note, 'html', () => {
    const noteRep = note[t].phase2.rep;
    env.parent.log.info('rendering', note.id);
    return noteRep.toHtml(env);
  });

  return note;
}

function initState(args) {

  // See state.js for context

  const { text, note, graph, env, modules } = args;

  // Initialize parser state
  const s = {};


  // MUTABLE STATE //

  // Index in text
  s.i = 0;

  // Symbol generation
  s.cursyms = {};


  // IMMUTABLE STATE //

  // Indentation stack
  s.indents = [];

  // Source text
  s.text = text;

  // Parsers
  s.parsers = [];
  s.parsers.push(p_command);
  for (const module of Object.values(modules))
    s.parsers = [...s.parsers, ...(module.parsers ?? [])];

  // Commands mapping
  s.commands = {};
  s.commands.scope = command_scope;
  for (const module of Object.values(modules))
    Object.assign(s.commands, module.commands);


  // WANT: give modules namespaces?
  for (const module of Object.values(modules))
    if (module.stateInit)
      Object.assign(s, module.stateInit(args));
        // ^ TODO: passing all of 'args' is bad


  // QUASI STATE //

  const sm = {};
  s._sm = sm;

  // Tracks which keys are part of the mutable state
  sm.StateT = [ 'i', 'cursyms' ];
  for (const module of Object.values(modules))
    if (module.StateT)
      sm.StateT = [...sm.StateT, module.StateT];

  // Environmental references
  // These are very powerful!
  sm.env = { graph, note, env };

  return s;

}


function parse(args) {

  const { modules } = args;

  const s = initState(args);

  // Parse format header, metadata, and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  const meta = p_noteMetadata(s);
  if (meta) s._sm.env.env.log.info('metadata is', meta);
  if (s.text[s.i] === '\n') s.i++;

  const noteRep = new rep.Seq();
  const done = s => s.i >= s.text.length;
  noteRep.add(p_toplevel_markup(s, done));

  // Prelude
  let prelude = new Cats();
  for (const module of Object.values(modules))
    prelude.add(module.prelude ?? '');
  prelude = prelude.toString();

  return { rep: template(prelude, noteRep), meta };

}


function p_noteMetadata(s) {
  if (!s.text.startsWith('meta:', s.i))
    return null;

  p_take(s, 'meta');
  return p_jsExpr(s);
}

function p_jsExpr(s) {
  const [expr, _] = p_enclosed(s, p_toplevel_verbatim);
  return eval('(' + expr + ')');
}


// Execute a backslash command
function p_command(s) {
  const xi0 = s.i;
  if (s.text[s.i] !== '\\') return '';
  s.i++;

  p_spaces(s);

  const name = p_word(s);

  const command = s.commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}

// Local evaluator modification
function command_scope(s) {
  p_spaces(s);
  const json = p_jsExpr(s);
  p_spaces(s);

  return state.local(s, s => {
    if ('inferReferences' in json)
      s.doImplicitReferences = !!json['inferReferences'];
    const [r, _] = p_enclosed(s, p_toplevel_markup);
    return r;
  });
}



function template(prelude, html) {
  return new rep.Seq(String.raw`
<!DOCTYPE HTML>
<html>
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
${ prelude }
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
