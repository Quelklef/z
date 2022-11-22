/*

repm, The *rep*resentation *m*odule
-----------------------------------

Instead of evaluating Zeta markup directly into resultant HTML, we
instead first go through an intermediate representation, called Rep,
so that the compilation pipeline looks like

  Markup --> Rep --> HTML

The intermediate representation is extremely simple. A Rep node is
any Javascript object that adheres to the following type:

  type Rep =
    string | { get children :: Array Rep
             , toHtml :: Env -> string
             }

The purpose of the intermediate representation is to allow Zeta
modules to retain some abstract information after parsing in order
to perform post-processing before rendering to HTML.

*/


// Traverse a Rep and all its descendants
// WANT: no need for callback; just yield
const traverse =
exports.traverse =
function traverse(rep, func) {
  for (const node of tree(rep))
    func(node);

  function * tree(rep) {
    yield rep;
    if (typeof rep !== 'string') {
      for (const ch of rep.children) {
        yield * tree(ch);
      }
    }
  }
}


/* Construct a sequence Rep, which is essentially an array of children */
const mkSeq =
exports.mkSeq =
function mkSeq(...parts) {
  return new Seq(parts);
}

class Seq {
  constructor(parts) {
    this.parts = parts;
  }

  // --

  get children() {
    return this.parts;
  }

  toHtml(aff) {
      return (
        this.parts.map(part =>
          typeof part === 'string'
            ? part
            : part.toHtml(aff)
        ).join('')
      );
  }

  // --

  and(...newParts) {
    return new Seq([].concat(this.parts, newParts))
  }
}
