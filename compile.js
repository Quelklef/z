const fs = require('fs');
const { katex } = require('katex');
const plib = require('path');

const { quire } = require('./quire.js');
const { lazyAss, writeFile, readdirRecursive } = quire('./util.js');
const { mkEnv } = quire('./env.js');



const t = Symbol('compile.t');
const pwd = process.env.PWD;


exports.main =
function main() {

  const formats = [];
  for (const fname of fs.readdirSync('./fmt')) {
    const floc = plib.resolve(pwd, 'fmt', fname);

    const format = quire(floc).default;
    const name = plib.basename(fname, plib.extname(fname));
    Object.defineProperty(format, 'name', { value: name });

    formats.push(format);
  }

  const out = plib.resolve(pwd, 'out');
  fs.mkdirSync(out, { recursive: true });

  const env = mkEnv({
    cacheRoot: plib.resolve(out, '.cache'),
  });
  fs.mkdirSync(plib.resolve(out, '.cache'), { recursive: true });

  const graph = {};
  graph.notes = [];

  env.log.info('Found', formats.length, 'formats:', formats.map(f => f.name).join(', '));

  const notesLoc = plib.resolve(pwd, 'notes');
  for (const format of formats) {

    const files = readdirRecursive(notesLoc);
    for (let note of format(files, notesLoc, graph, env)) {

      const cached = env.cache.getOr('notes', note.cacheKeys, null);
      if (cached) note = cached;

      // Initialize transient (non-cached) data
      Object.defineProperty(note, t, { enumerable: false, value: {} });
      note[t].isFromCache = !!cached;
      note[t].format = format;

      graph.notes.push(note);

    }
  }

  env.log.info('Found', graph.notes.length, 'notes');

  // Log format counts
  {
    const counts = {};
    for (const note of graph.notes)
      counts[note[t].format.name] = (counts[note[t].format.name] || 0) + 1;
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    env.log.info(sorted.map(k => `format=${k}: ${counts[k]} notes`).join('; '))
  }

  for (const note of graph.notes) {
    lazyAss(note, 'relativeLoc', () => 'n/' + note.id + '.html');
    lazyAss(note, 'href', () => '/' + note.relativeLoc);
  }

  graph.notesById = {};
  for (const note of graph.notes)
    graph.notesById[note.id] = note;

  graph.jargonSet = new Set();
  graph.jargonToDefiningNoteSet = {};
  for (const note of graph.notes) {
    for (const jarg of note.defines) {
      graph.jargonSet.add(jarg);
      if (!(jarg in graph.jargonToDefiningNoteSet))
        graph.jargonToDefiningNoteSet[jarg] = new Set();
      graph.jargonToDefiningNoteSet[jarg].add(note);
    }
  }

  // Log longest jargon
  {
    let longest;
    for (const jarg of graph.jargonSet)
      if (!longest || jarg.length > longest.length)
        longest = jarg;
    if (longest)
      env.log.info('Longest jargon at:', longest.length, 'is:', longest);
  }

  for (const note of graph.notes)
    note.referencedBy = new Set();
  for (const note of graph.notes) {
    for (const refId of note.references) {
      if (!(refId in graph.notesById)) continue;  // can happen due to caching weirdness
      graph.notesById[refId].referencedBy.add(note.id);
    }
  }

  writeFile(plib.resolve(out, 'index.html'), renderIndex(graph));

  for (const note of graph.notes) {

    const html = (
      '<base target="_parent">\n'  // makes clicking on <a> break out of <iframe>
      + '<script type="text/javascript" src="https://rawcdn.githack.com/davidjbradshaw/iframe-resizer/036511095578f6166b2e780c9fec5d53bb501e21/js/iframeResizer.contentWindow.min.js"></script>'  // for <iframe> resizing
      + note.html
    );

    writeFile(plib.resolve(out, 'raw', note.relativeLoc), html);

    const wrapped =
      withTemplate(String.raw`
        <iframe
          src="${'/raw/' + note.relativeLoc}"
          scrolling="no"
          onload="this.style.height = (this.contentWindow.document.body.scrollHeight + 20) + 'px';"
        ></iframe>
    `);

    writeFile(plib.resolve(out, note.relativeLoc), wrapped);

  }

  for (const note of graph.notes) {
    if (note[t].isFromCache) continue;
    env.log.info(`Caching: ${note.id}`);
    env.cache.put('notes', note.cacheKeys, note);
  }

  env.log.info('Done!');

}


function renderIndex(graph) {
  let html = '';

  html += '<table>';

  html += '<tr>';
  html += '<th>Note</th>';
  html += '<th>Jargon</th>';
  html += '<th>Format</th>';
  html += '<th>Refs</th>';
  html += '<th>Ref&nbsp;by</th>';
  html += '</tr>';

  html += (
    [...graph.notes]
      .sort((na, nb) => nb.referencedBy.size - na.referencedBy.size)
      .map(note =>
        [ '<tr>'
        , `<td><a href="${note.href}">${note.id}</a></td>`
        , `<td><center>${[...note.defines].join(', ')}</center></td>`
        , `<td><center style="white-space: nowrap">${note[t].format.name}</center></td>`
        , `<td><center>${note.references.size}</center></td>`
        , `<td><center>${note.referencedBy.size}</center></td>`
        , '</tr>'
        ].join(''))
      .join('')
  );

  html += '</table>'

  html = withTemplate(html);

  return html;
}

function withTemplate(mainHtml) {
  return String.raw`
<!DOCTYPE HTML>

<html>
<head>
  <meta charset="utf-8">
  <title>ζ</title>
  <script type="text/javascript" src="https://rawcdn.githack.com/davidjbradshaw/iframe-resizer/036511095578f6166b2e780c9fec5d53bb501e21/js/iframeResizer.min.js"></script>
<style>

body {
  padding: 4vh 50px;
  padding-bottom: 25vh;
  max-width: 800px;
  margin: 0 auto;

  font-size: 18px;
  font-family: sans serif;
  line-height: 1.5em;
}

nav {
  margin-bottom: 3em;
}

a {
  text-decoration: none;
  color: black;
  border-bottom: 1px solid #C06;
}

a:hover {
  border-bottom-width: 2px;
}

tr:not(:last-child) th {
  border-bottom: 1px solid rgb(200, 200, 200);
}
tr:not(:last-child) td {
  border-bottom: 1px dashed rgb(200, 200, 200);
}

th, td {
  padding: .25em 1em;
}

table {
  position: relative;
}
tr:first-child {
  position: sticky;
  top: 0;
  background: white;
}

iframe {
  border: none;
  width: 100%;
}

</style>

</head>

<body>

<nav>ζ&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="/">table</a></nav>

<main>${mainHtml}</main>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const $iframe = document.getElementsByTagName('iframe')[0];
  iFrameResize({ log: false }, $iframe);
});
</script>

</body>
</html>
`;
}


if (require.main === module)
  main();
