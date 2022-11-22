const hljs = require('highlight.js');

const repm = require('../repm.js');
const p = require('../parse.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


const code =
exports.commands.c =
exports.commands.code =
function code(s) {

  p.p_whitespace(s);
  let language = /\w/.test(s.text[s.i]) ? p.p_word(s).toString() : null;
  p.p_whitespace(s);

  let [body, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
  const codeIsBlock = kind === 'block';

  const highlighted =
    language !== null
        ? hljs.highlight(body, { language })
    : language === null && !codeIsBlock
        ? hljs.highlight(body, { language: 'plaintext' })
    : language === null && codeIsBlock
        ? hljs.highlightAuto(body)
    : impossible();

  return (
    repm.h('code')
      .a('class', codeIsBlock ? 'block' : 'inline')
      .c(highlighted.value, { rawHtml: true })
  );
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
