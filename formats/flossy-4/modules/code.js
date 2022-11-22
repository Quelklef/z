const hljs = require('highlight.js');

const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


const code =
exports.commands.c =
exports.commands.code =
function code(s) {

  const params = ppar.p_kvParams(s, {
    lang: ppar.p_arg_optionally(ppar.p_arg_string, { default: 'auto' }),
  });
  const language = params.lang;

  let [body, kind] = p.p_enclosed(s, p.p_toplevel_verbatim);
  const codeIsBlock = kind === 'block';

  const highlighted =
    language !== 'auto'
        ? hljs.highlight(body, { language })
    : language === 'auto' && !codeIsBlock
        ? hljs.highlight(body, { language: 'plaintext' })
    : language === 'auto' && codeIsBlock
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
