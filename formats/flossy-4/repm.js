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

const { escapeHtml } = require('./util.js');

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
    this.parts = parts.filter(p => p !== '');
  }

  // --

  get children() {
    return this.parts.filter(part => typeof part !== 'string');
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


/*

HTML construction DSL

Useful to automatically handle HTML escapes and
to work

Example:

  h('div')
    .a('id', 'my-div')
    .s('background-color', 'blue')
    .s('font-weight', 'bold')
    .c('Hello, world!')
    .ok()

The result of .ok() is not a string but a Rep object,
meaning that .c() can take any Rep.

*/
exports.h =
function h(tag) {
  return new H(tag);
}

class H {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.styles = {};
    this.children = [];
  }

  a(k, v) {
    this.attributes[k] = escapeHtml(v);
    return this;
  }

  s(k, v) {
    this.styles[k] = escapeHtml(v);
    return this;
  }

  // parentH.c(childH, ...)
  // parentH.c(childRep, ...)
  // parentH.c(childHtml, ..., { rawHtml: true })
  c(ch, opts) {
    if (this.isSelfClosing)
      throw new Error(`<${this.tag}> element cannot have children`);

    if (typeof ch === 'string') {
      const cleaned = opts?.rawHtml ? ch : escapeHtml(ch);
      this.children.push(ch);
    } else {
      this.children.push(ch);
    }

    return this;
  }

  cs(...chs) {
    for (const ch of chs)
      this.c(ch);
    return this;
  }

  get isSelfClosing() {
    return (
      'area base br col embed hr img input link meta param source track wbt command keygen menuitem'
      .split(' ')
      .includes(this.tag)
    );
  }

  // ---------- //

  toHtml(aff) {
    const style = (
      Object.entries(this.styles)
        .map(([k, v]) => k + ': ' + v)
        .join('; ')
    );

    const attrs = (
      Object.entries({ ...this.attributes, style })
        .map(([k, v]) => k + '="' + v + '"')
        .join(' ')
    );

    const result = mkSeq(
      '<' + this.tag + (attrs ? ' ' + attrs : '') + '>',
      ...this.children,
      this.isSeflClosing ? '' : '</' + this.tag + '>',
    );

    return result.toHtml(aff);
  }
}
