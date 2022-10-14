const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../util.js');
const fss = squire('../../fss.js');

const Rep = squire('./rep.js');
const { Trie, indexOf, impossible, cloneIterator } = squire('./util.js');
// WANT: switch from p_ prefix to p. module
const { p_block, p_inline, p_enclosed, p_toplevel, p_toplevel_markup, p_toplevel_verbatim, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('./parsing.js');

exports.default =
function * (floc, source, graph, env) {
  yield mkNote(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();

/*

type Rep
  ≅ String
  | ({ toHtml :: () -> String
     , children :: () -> Array Rep
     })

type Module ≅
  { parsers [optional] :: Array (Parser Rep)
  , commands [optional] :: ObjectOf (Parser Rep)
  , prelude [optional] :: String
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

function mkNote(floc, source, graph, env) {

  const noteId = plib.basename(floc, '.z');

  env = env.descend();
  env.log.prefixes.push('note=' + noteId.toString());

  const note = {};

  note.source = source;
  note.source += '\n';  // allows parsers to assume lines end with \n

  note.hash = hash(floc, source, scriptSrc);

  note.id = noteId;

  // note[t] holds transient (non-cached) data
  const t = Symbol('fmt-flossy-3.t');
  Object.defineProperty(note, t, { enumerable: false, value: {} });


  lazyAss(note[t], 'phase1', () => {
    env.parent.log.info('parsing', note.id);
    return parse({
      text: source,
      note, graph, env,
      doImplicitReferences: false,
    });
  });

  lazyAss(note, 'starred', () => {
    return note[t].phase1.meta?.starred === true;
  });

  lazyAss(note, 'defines', () => {
    const rep = note[t].phase1.rep;
    const defines = new Set();
    Rep.traverse(rep, node => {
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
    });
  });

  lazyAss(note, 'references', () => {
    const rep = note[t].phase2.rep;
    const references = new Set();
    Rep.traverse(rep, node => {
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
    const rep = note[t].phase2.rep;

    const referencedBy = [...note.referencedBy].map(id => graph.notesById[id]);
    Rep.traverse(rep, node => {
      if (node instanceof Rep.ReferencedBy)
        node.setReferencedBy(referencedBy);
    });

    env.parent.log.info('rendering', note.id);
    return rep.toHtml(env);
  });

  return note;
}


function parse(args) {

  const { text, note, graph, env, doImplicitReferences } = args;

  // Initialize parser state
  const s = {};
  {

    // Environmental references
    s.graph = graph;
    s.note = note;
    s.env = env;

    // Source text
    s.text = text;

    // Index in text
    s.i = 0;

    // Indentation stack
    s.indents = [];

    // Symbol generation
    s.cursyms = {};
    s.gensym = function(namespace = '') {
      if (!(namespace in this.cursyms)) this.cursyms[namespace] = 0;
      return 'gensym-' + (namespace ? (namespace + '-') : '') + (this.cursyms[namespace]++);
    };

    // parsers
    s.parsers = [];
    s.parsers.push(p_command);
    for (const module of Object.values(modules))
      s.parsers = [...s.parsers, ...(module.parsers ?? [])];

    // Prelude
    s.prelude = new Cats();
    for (const module of Object.values(modules))
      s.prelude.add(module.prelude ?? '');
    s.prelude = s.prelude.toString();

    // Commands mapping
    s.commands = {};
    Object.assign(s.commands, builtinCommands);
    for (const module of Object.values(modules))
      Object.assign(s.commands, module.commands);

    // TODO
    s.clone = function() {
      const c = { ...this };
      c.indents = [...c.indents];
      c.parsers = [...c.parsers];
      c.annotNameQueue = [...c.annotNameQueue];
      c.annotNameStack = cloneIterator(c.annotNameStack);
      c.katexPrefix = c.katexPrefix.clone();
      c.texPrefix = c.texPrefix.clone();
      return c;
    };

    // TODO: remove!!
    for (const module of Object.values(modules))
      if (module.stateInit)
        Object.assign(s, module.stateInit(args));

  }

  // Parse format header, metadata, and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  const meta = p_noteMetadata(s);
  if (meta) s.env.log.info('metadata is', meta);
  if (s.text[s.i] === '\n') s.i++;

  const rep = new Rep.Seq();

  const done = s => s.i >= s.text.length;
  rep.add(p_toplevel_markup(s, done));

  rep.add(new Rep.ReferencedBy());

  return { rep: template(s, rep), meta };

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

const builtinCommands = {};

// Local evaluator modification
builtinCommands.scope = function(s) {
  p_spaces(s);
  const json = p_jsExpr(s);
  p_spaces(s);

  const srec = s.clone();

  if ('inferReferences' in json)
    srec.doImplicitReferences = !!json['infer-references'];

  const [r, _] = p_enclosed(srec, p_toplevel_markup);

  Object.assign(s, { ...srec, doImplicitReferences: s.doImplicitReferences });
    // ^ TODO: bugged; see (B*)

  return r;
}



function template(s, html) {
  return new Rep.Seq(String.raw`
<!DOCTYPE HTML>
<html>
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
${ s.prelude }
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
