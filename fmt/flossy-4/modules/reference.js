const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


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
  console.log(toNoteId);
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
    this.toNoteId = toNoteId;
    this.toNote = toNote;
    this.body = body;
  }

  toHtml(env) {
    if (!this.toNote) env.log.error(`Reference to nonexistent note '${this.toNoteId}'`);
    if (this.toNote)
      return `<a href="${this.toNote.href}" class="reference explicit">` + this.body.toHtml(env) + '</a>';
    else
      return `<a class="reference explicit invalid">` + this.body.toHtml(env) + '</a>';
  }

  children() {
    return [this.body];
  }
}
