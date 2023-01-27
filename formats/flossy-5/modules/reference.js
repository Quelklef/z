
const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


// -------------------------------------------------------------------------- //
// \ref
// -------------------------------------------------------------------------- //

exports.commands.ref = function(s) {
  const params = ppar.p_kvParams(s, {
    to: ppar.p_arg_string,
  });

  const toNoteId = params.to;

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

  get children() {
    return [this.body];
  }
}
