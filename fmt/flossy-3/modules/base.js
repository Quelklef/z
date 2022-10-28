const hljs = require('highlight.js');

const { squire } = require('../../../squire.js');
const repm = squire('../repm.js');
const p = squire('../parse.js');
const { Cats } = squire('../../../util.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = squire('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


// -------------------------------------------------------------------------- //
// \title and \sec
// -------------------------------------------------------------------------- //

// Title
exports.commands.title = function(s) {
  return new repm.Seq('<div class="title">', p.p_block(s, p.p_toplevel_markup), '</div>');
}

// Section header
exports.commands.sec = function(s) {
  return new repm.Seq('<div class="section-header">', p.p_block(s, p.p_toplevel_markup), '</div>');
}

exports.prelude += String.raw`
<style>

.title {
  font-weight: bold;
  color: var(--color-static);
  font-size: 18px;
  margin-bottom: 1em;
}

.section-header {
  font-weight: bold;
  color: var(--color-static);
  border-bottom: 1px dotted var(--color-static);
}

hr {
  border: none;
  border-bottom: 1px dashed rgb(200, 200, 200);
}

</style>
`;


// -------------------------------------------------------------------------- //
// \code
// -------------------------------------------------------------------------- //

exports.commands.c = function(s) {
  return exports.commands.code(s);
}

exports.commands.code = function(s) {
  p.p_whitespace(s);
  let language = /\w/.test(s.text[s.i]) ? p.p_word(s).toString() : null;
  p.p_whitespace(s);
  let [body, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return new Code({ language, body, isBlock: kind === 'block' });
}

const Code =
exports.Code =
class Code {

  constructor({ language, body, isBlock }) {
    this.language = language;
    this.body = body;
    this.isBlock = isBlock;
  }

  toHtml() {
    const highlighted =
      this.language !== null
          ? hljs.highlight(this.body, { language: this.language })
      : this.language === null && !this.isBlock
          ? hljs.highlight(this.body, { language: 'plaintext' })
      : this.language === null && this.isBlock
          ? hljs.highlightAuto(this.body)
      : impossible();

    return new Cats(`<code class="${this.isBlock ? 'block' : 'inline'}">`, highlighted.value, '</code>');
  }

  children() {
    return [];
  }

}

exports.prelude += String.raw`
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.4.0/styles/github.min.css">

<style>

code {
  border: 1px solid rgba(var(--color-static-rgb), .25);
  background-color: rgb(245, 245, 245);
  border-radius: 3px;
  white-space: pre-wrap;
}
code.inline {
  display: inline;
  padding: 0px 3px;
}
code.block {
  display: block;
  padding: .35em .5em;
}

</style>
`;


// -------------------------------------------------------------------------- //
// \quote
// -------------------------------------------------------------------------- //

exports.commands.quote = function(s) {
  p.p_spaces(s);
  const [body, _] = p.p_enclosed(s, p.p_toplevel_markup);
  return new repm.Seq('<blockquote>', body, '</blockquote>');
}

exports.prelude += String.raw`
<style>

blockquote {
  margin: 0;
  padding-left: 1em;
  border-left: 4px solid rgba(0, 0, 0, 0.1);
  position: relative;
}
blockquote::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 4px;
  width: 30px;
  height: 30px;
  opacity: 0.05;
  pointer-events: none;
  background-size: cover;
  background-position: center;
  background-image: url(data:image/png;base64,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);
}

</style>
`;


// -------------------------------------------------------------------------- //
// \ref
// -------------------------------------------------------------------------- //

exports.commands.ref = function(s) {
  p.p_spaces(s);
  const toNoteId = p.p_backtracking(s, p.p_word);
  if (!toNoteId) throw p.mkError(s.text, s.i, "Missing note ID");
  p.p_spaces(s);

  const body = p.local(s, s => {
    s.doImplicitReferences = false;
    return p.p_inline(s, p.p_toplevel_markup);
  });

  const toNote = s.quasi.env.graph.notesById[toNoteId];
  return new Explicit({ toNoteId, toNote, body });
}

exports.getExplicitReferences =
function(rep)
{
  const references = new Set();
  repm.traverse(rep, node => {
    if (node instanceof Explicit)
      if (!!node.toNote)
        references.add(node.toNote.id);
  })
  return references;
}

const Explicit =
exports.Explicit =
class Explicit {

  constructor({ toNoteId, toNote, body }) {
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) env.log.error(`Reference to nonexistent note '${this.toNoteId}'`);
    if (this.toNote)
      return new Cats(`<a href="${this.toNote.href}" class="reference explicit">`, this.body.toHtml(env), '</a>');
    else
      return new Cats(`<a class="reference explicit invalid">`, this.body.toHtml(env), '</a>');
  }

  children() {
    return [this.body];
  }
}



// -------------------------------------------------------------------------- //
// some simple stuff
// -------------------------------------------------------------------------- //

// nb. This has to come before p_sigils so that
//     precedence is right.
exports.parsers.push(p_hr);
function p_hr(s) {
  if (!p.isStartOfLine(s)) return '';
  const eol = indexOf(s.text, '\n', s.i);
  if (
    s.text.startsWith('---', s.i)
    && s.text.slice(s.i + 3, eol).trim() === ''
  ) {
    s.i = eol + 1;
    return '<hr />';
  }
  return '';
}

const sigilMapping = {
  '<->': '&harr;',
  '->': '&rarr;',
  '<-': '&larr;',
  '<=>': '&hArr;',
  '=>': '&rArr;',
  '<=': '&lArr;',
  '<-->': '&xharr;',
  '-->': '&xrarr;',
  '<--': '&xlarr;',
  '<==>': '&xhArr;',
  '==>': '&xrArr;',
  '<==': '&xlArr;',

  '--': '&mdash;',

  '{sec}': '§',
  '{para}': '¶',
};

const sigilTrie = new Trie(Object.keys(sigilMapping));

exports.parsers.push(p_sigils);
function p_sigils(s) {
  const sigil = sigilTrie.longestPrefixOf(s.text, s.i);
  if (!sigil) return '';
  s.i += sigil.length;
  return sigilMapping[sigil];
}


exports.parsers.push(p_escapes);
function p_escapes(s) {
  const c = s.text[s.i];
  if (c in htmlEscapes) {
    s.i++;
    return htmlEscapes[c];
  } else {
    return '';
  }
}

// Fancy quote marks
exports.parsers.push(p_quotes);
function p_quotes(s) {
  if (!`'"`.includes(s.text[s.i])) return '';

  const isletter = c => !!(c || '').match(/[a-zA-Z]/);
  const quot = s.text[s.i];
  const before = isletter(s.text[s.i - 1]);
  const after = isletter(s.text[s.i + 1]);

  const mapping = {
    [`true ' true`]: `’`,
    [`true " true`]: `”`,
    [`true ' false`]: `’`,
    [`true " false`]: `”`,
    [`false ' true`]: `‘`,
    [`false " true`]: `“`,
    [`false ' false`]: `'`,
    [`false " false`]: `"`,
  };

  const fancy = mapping[before + ' ' + quot + ' ' + after];
  s.i++;
  return fancy;
}

// Lines containing only a minus and whitespace are not emitted
exports.parsers.push(p_skipLine);
function p_skipLine(s) {
  const eol = indexOf(s.text, '\n', s.i);
  if (
    p.isStartOfLine(s)
    && s.text[s.i] === '-'
    && s.text.slice(s.i + 1, eol).trim() === ''
  ) {
    s.i = eol + 1;
  }
  return '';
}

// Italic, bold, underline, strikethrough
for (const tag of 'ibus') {
  exports.commands[tag] = function(s) {
    return new repm.Seq(`<${tag}>`, p.p_inline(s, p.p_toplevel_markup), `</${tag}>`);
  }
}

// Comment (REMark)
exports.commands.rem = function(s) {
  p.p_spaces(s);
  const [comment, _] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return '';
}

// External (hyper-)reference
exports.commands.href = function(s) {
  p.p_spaces(s)
  p.p_take(s, '<');
  const href = p.p_takeTo(s, '>');
  p.p_take(s, '>');
  p.p_spaces(s)

  const body = p.local(s, s => {
    // Nested <a> tags are forbidden in HTML
    s.doImplicitReferences = false;
    return p.p_inline(s, p.p_toplevel_markup);
  });

  return new repm.Seq(`<a href="${href}" class="ext-reference" target="_blank">`, body, "</a>");
}

exports.commands['unsafe-raw-html'] = function(s) {
  s.env.log.warn(`use of \\unsafe-raw-html`);
  p.p_spaces(s);
  const [html, _] = p.p_enclosed(s, p.p_toplevel_verbatim);
  return new repm.Seq(html);
}

exports.commands['unsafe-exec'] =
function unsafe_exec(s) {
  s.quasi.env.env.log.warn(`use of \\unsafe-exec`);

  p.p_whitespace(s);
  const [body, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);

  const code =
    kind === 'inline'
      ? body.toString()
    : kind === 'block'
      ? `(function(){\n${body}\n})()`
    : null;

  // Set up eval() environment
  const parse = str => {
    return p.local(s, s => {
      s.text = str;
      const i0 = s.i;
      s.i = 0;
      s.sentinel = s => s.i >= s.text.length;
      const r = p.p_toplevel_markup(s);
      s.i = i0;
      return r;
    });
  };

  return eval(code) || '';
}
