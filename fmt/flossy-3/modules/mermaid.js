const { squire } = require('../../../squire.js');
const { escapeHtml } = squire('../util.js');
const repm = squire('../repm.js');
const p = squire('../parse.js');

exports.commands = {};

// MermaidJS support
exports.commands.mermaid = function(s) {
  p.p_spaces(s);
  const [body, _] = p.p_enclosed(s, p.p_toplevel_verbatim);

  // Unfortunately, mermaid does not seem to offer an API for rendering
  // a chart outwide of a browser environment.
  // So instead we have to defer rendering to the client.

  const divId = p.gensym(s, 'mermaid');
  return new repm.Seq(String.raw`
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
