const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { Cats, withTempDir } = squire('../../util.js');
const fss = squire('../../fss.js');

const { mkError } = squire('./parsing.js');

const traverse =
exports.traverse =
function traverse(rep, func) {
  for (const node of tree(rep))
    func(node);

  function * tree(node) {
    yield node;
    if (node.children)
      yield * node.children().flatMap(tree);
  }
}

const Seq =
exports.Seq =
class Seq {

  constructor(...parts) {
    this.parts = parts;
  }

  add(...parts) {
    for (const part of parts)
      if (part !== '')
        this.parts.push(part);
  }

  // == //

  toHtml(env) {
    return (
      this.parts
      .map(part => part.toHtml ? part.toHtml(env) : part.toString())
      .join('')
    );
  }

  children() {
    return this.parts;
  }

}

