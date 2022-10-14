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
  const t = Symbol('fmt-proper.t');
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
    rep.traverse(node => {
      if (node instanceof Rep.Jargon) {
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
    rep.traverse(node => {
      if (node instanceof Rep.Implicit) {
        references.add(node.toNote.id);
      } else if (node instanceof Rep.Explicit) {
        if (!!node.toNote)
          references.add(node.toNote.id);
      }
    });
    return references;
  });

  lazyAss(note, 'html', () => {
    const rep = note[t].phase2.rep;

    const referencedBy = [...note.referencedBy].map(id => graph.notesById[id]);
    rep.traverse(node => {
      if (node instanceof Rep.ReferencedBy)
        node.setReferencedBy(referencedBy);
    });

    env.parent.log.info('rendering', note.id);
    return rep.toHtml(env);
  });

  return note;
}


const commands = {};

const modules = [
  squire('./modules/indent.js'),
  squire('./modules/base.js'),
  squire('./modules/tex.js'),
  squire('./modules/annotations.js'),
  squire('./modules/mermaid.js'),
  squire('./modules/given.js'),
  squire('./modules/jargon.js'),
  squire('./modules/table.js'),
];

let prelude = new Cats();
for (const module of modules) {
  Object.assign(commands, module.commands);
  prelude.add(module.prelude ?? '');
}
prelude = prelude.toString();

function parse(args) {

  const { text, note, graph, env, doImplicitReferences } = args;

  let baseParsers = [];
  for (const module of modules)
    baseParsers = [...baseParsers, ...(module.parsers ?? [])];

  // Initial parser state
  let s = {

    // Environmental references
    graph, note, env,

    // Note metadata (initialized below)
    meta: null,

    // Source text
    text,

    // Index in text
    i: 0,

    // Indentation stack
    indents: [],

    // Symbol generation
    cursyms: {},
    gensym(namespace = '') {
      if (!(namespace in this.cursyms)) this.cursyms[namespace] = 0;
      return 'gensym-' + (namespace ? (namespace + '-') : '') + (this.cursyms[namespace]++);
    },

    // parsers
    parsers: [
      p_command,
      ...baseParsers,
    ],

    // TODO
    clone() {
      const c = { ...this };
      c.indents = [...c.indents];
      c.parsers = [...c.parsers];
      c.annotNameQueue = [...c.annotNameQueue];
      c.annotNameStack = cloneIterator(c.annotNameStack);
      c.katexPrefix = c.katexPrefix.clone();
      c.texPrefix = c.texPrefix.clone();
      return c;
    },

  };

  for (const module of modules)
    if (module.stateInit)
      Object.assign(s, module.stateInit(args));

  // Parse format header, metadata, and optional following newline
  s.i = indexOf(s.text, '\n', s.i) + 1;
  const meta = p_noteMetadata(s);
  if (meta) s.env.log.info('metadata is', meta);
  if (s.text[s.i] === '\n') s.i++;

  const rep = new Rep.Seq();

  const done = s => s.i >= s.text.length;
  rep.add(p_toplevel_markup(s, done));

  rep.add(new Rep.ReferencedBy());

  return { rep: template(rep), meta };

}


function p_noteMetadata(s) {
  const prefix = 'meta:';

  if (!s.text.startsWith(prefix, s.i))
    return null;

  s.i += prefix.length;
  p_spaces(s);

  const expr = p_dhallExpr(s, { takeToEol: true });
  return evalDhall(expr, s.env);
}

// Scan a single Dhall expression
// Because Dhall uses whitespace to juxtapose, it's not possible to
// know whan an expression has ended.
// If your expressions are being cut off, wrap them in parens.
function p_dhallExpr(s, { takeToEol }) {

  let delims = [];

  const i0 = s.i;

  parsing:
  while (true) {

    if (s.i >= s.text.length)
      break parsing;

    const topDelim = delims[delims.length - 1]
    switch (topDelim) {

      // Expression
      case undefined:
      case '${':
      case '(':
      case '[':
      case '{':
      {

        const pairs = {
          "''": null,
          '"': null,
          "{-": null,
          "(": ")",
          "[": "]",
          "{": "}",
        };

        for (const [opener, closer] of Object.entries(pairs)) {
          if (s.text.startsWith(opener, s.i)) {
            s.i += opener.length;
            delims.push(opener);
            continue parsing;
          }
          if (closer && s.text.startsWith(closer, s.i)) {
            if (pairs[topDelim] !== closer)
              throw mkError(s.text, [i0, s.i], `Unpaired '${closer}'`);
            s.i += closer.length;
            delims.pop();
            continue parsing;
          }
        }

        s.i++;

      }
      break;

      // String
      case '"':
      case "''":
      {
        if (s.text.startsWith('\\', s.i)) {
          s.i += 2;
        }
        else if (s.text.startsWith(topDelim, s.i)) {
          s.i += topDelim.length;
          delims.pop();
        }
        else if (s.text.startsWith('${', s.i)) {
          s.i += 2;
          delims.push('${');
        }
        else {
          s.i++;
        }
      }
      break;

      // Line comment
      case '--':
      {
        if (s.text.startsWith('\n', s.i))
          delims.pop();
        s.i++;
      }
      break;

      // Block comment
      case '{-':
      {
        if (s.text.startsWith('{-', s.i)) {
          s.i += 2;
          delims.push('{-');
        }
        else if (s.text.startsWith('-}', s.i)) {
          s.i += 2;
          delims.pop();
        }
        else {
          s.i++;
        }
      }
      break;

      default:
        impossible(topDelim);

    }

    if (delims.length === 0)
      break parsing;

  }

  if (takeToEol)
    s.i = indexOf(s.text, '\n', s.i);

  return s.text.slice(i0, s.i);

}

function evalDhall(expr, env) {
  return env.cache.at('note-parts', ['dhall', expr], () => {
    return fss.withTempDir(tmp => {

      env.log.info(`Evaluating Dhall [${expr.length}]`);

      fss.write(plib.resolve(tmp, 'it.dhall'), expr);

      const cmd = String.raw`
        cd ${tmp} \
        && dhall-to-json --file it.dhall --compact
      `;

      let result;
      try {
        result = child_process.execSync(cmd).toString();
      } catch (err) {
        env.log.error(err.stderr.toString());  // meh
        throw 'Dhall eval failed; see above!';  // TODO
      }

      result = JSON.parse(result);
      env.log.info(`Evaluating Dhall [done] [${expr.length}]`);
      return result;

    });
  });
}










// Execute a backslash command
function p_command(s) {
  const xi0 = s.i;
  if (s.text[s.i] !== '\\') return '';
  s.i++;

  p_spaces(s);

  const name = p_word(s);

  const command = commands[name];
  if (!command)
    throw mkError(s.text, [xi0, s.i], `No command '${name}'!`);

  return command(s);
}

// Local evaluator modification
commands.scope = function(s) {
  p_spaces(s);
  const expr = p_dhallExpr(s, { takeToEol: false });
  const json = evalDhall(expr, s.env);

  const srec = s.clone();

  if ('infer-references' in json)
    srec.doImplicitReferences = !!json['infer-references'];

  const [r, _] = p_enclosed(srec, p_toplevel_markup);

  Object.assign(s, { ...srec, doImplicitReferences: s.doImplicitReferences });
    // ^ TODO: bugged; see (B*)

  return r;
}



function template(html) {
  return new Rep.Seq(String.raw`

<!DOCTYPE HTML>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.4.0/styles/github.min.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
  </head>
<body>

<style>

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

`,

prelude,

`

<main>`, html, `</main>

</body>
</html>

`);
}






function ruled(str, pref='>|') {
  const bar = '------';
  return [bar, ...str.toString().split('\n').map(l => pref + l.replace(/ /g, '⋅')), bar].join('\n');
}

function sample(str, from = 0, linec = 5) {
  return ruled(str.toString().slice(from).split('\n').slice(0, linec).join('\n'));
}

function sample_s(s, linec = 4) {
  return sample(s.text, s.i, linec);
}
