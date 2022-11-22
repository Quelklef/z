const { squire } = require('../../squire.js');

// nb 'repm' stands for 'representation module', ie the javascript
//    module for AST representation

/*

type Rep =
  { children :: () -> Array Rep
  , toHtml :: Env -> String
  }
  | string

*/

const traverse =
exports.traverse =
function traverse(rep, func) {
  for (const node of tree(rep))
    func(node);

  function * tree(rep) {
    yield rep;
    if (rep.children)
      for (const ch of rep.children())
      yield * tree(ch);
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

