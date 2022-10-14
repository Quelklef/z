const { squire } = require('../../../squire.js');
const Rep = squire('../rep.js');
const { p_block, p_inline, p_enclosed, p_toplevel, p_toplevel_markup, p_toplevel_verbatim, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('../parsing.js');

exports.commands = {};

// MermaidJS support
exports.commands.mermaid = function(s) {
  p_spaces(s);
  const [body, _] = p_enclosed(s, p_toplevel_verbatim);

  // Unfortunately, mermaid does not seem to offer an API for rendering
  // a chart outwide of a browser environment.
  // So instead we have to defer rendering to the client.

  const divId = s.gensym('mermaid');
  return new Rep.Seq(String.raw`
    <div id="${divId}">${escapeHtml(body)}</div>
    <script> window.renderMermaid('${divId}'); </script>
  `);
}

exports.prelude = String.raw`

<script>

window.renderMermaid = async function(eltId) {
  await loadMermaid();
  mermaid.mermaidAPI.initialize({ startOnLoad: false });
    // ^ Yes, we have to reload and reinitialize every time.
    //   No, I don't know why.

  await domContentLoaded;

  const $in = document.getElementById(eltId);
  const $out = document.createElement('div');
  $out.style.textAlign = 'center';
  $in.after($out);

  mermaid.mermaidAPI.render($in.id, $in.innerText, r => { $out.innerHTML = r; });
}

const domContentLoaded = new Promise(resolve =>
  document.addEventListener('DOMContentLoaded', () => resolve()));

async function loadMermaid() {
  const $script = document.createElement('script');
  $script.src = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
  await new Promise(resolve => {
    $script.onload = () => resolve();
    document.body.append($script);
  });
}

</script>

`;

// WANT: deduplicate from here and parsing.js
function escapeHtml(s) {
  return [...s].map(c => htmlEscapes[c] || c).join('');
}
const htmlEscapes = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
};
