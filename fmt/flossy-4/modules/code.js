const hljs = require('highlight.js');

const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';




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

    return `<code class="${this.isBlock ? 'block' : 'inline'}">` + highlighted.value + '</code>';
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
