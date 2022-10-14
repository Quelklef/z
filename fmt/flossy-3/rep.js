const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { Cats, withTempDir } = squire('../../util.js');
const fss = squire('../../fss.js');

const { mkError } = squire('./parsing.js');

const Rep =
exports.Rep =
class Rep {

  // note: Think of this class as an abstract class
  // playing the role of a typeclass. This is not
  // to be interpreted as a type.

  // Expected methods:
  // .toHtml : () -> string | Cats
  // .children : () -> Iterable<Rep>

  // Derived methods:

  *tree() {
    for (const elem of this.children()) {
      if (typeof elem === 'string' || elem instanceof Cats) {
        yield elem;
      } else {
        yield elem;
        yield* elem.tree();
      }
    }
  }

  traverse(func) {
    for (const node of this.tree()) {
      func(node);
    }
  }

}


const Seq =
exports.Seq =
class Seq extends Rep {

  constructor(...parts) {
    super();
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

// Hacky but allows us to do rendering in 2 passes instead of 3
const ReferencedBy =
exports.ReferencedBy =
class ReferencedBy extends Rep {

  constructor() {
    super();
    this.referencedBy = null;
  }

  setReferencedBy(refBy) {
    this.referencedBy = refBy;
  }

  toHtml() {
    if (!this.referencedBy) return '';
    const html = new Cats();
    html.add('<div class="hide-on-print">');
    html.add('<br /><br />');
    html.add('<hr />');
    html.add('<p>Referenced by:</p>');
    html.add('<ul>');
    for (const refBy of this.referencedBy) {
      html.add(`<li><a href="${refBy.href}" class="reference explicit">${refBy.id}</a></li>`);
    }
    html.add('</ul>');
    html.add('</div>');
    return html;
  }

  children() {
    return [];
  }

}
