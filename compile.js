const { katex } = require('katex');
const plib = require('path');

const { squire } = require('./squire.js');
const { lazyAss, Cats, iife } = squire('./util.js');
const { mkEnv } = squire('./env.js');
const fss = squire('./fss.js');

const t = Symbol('compile.t');

const main =
exports.main =
function main(args) {

  const callTime = Date.now();

  let { websocketPort } = args ?? {};
  websocketPort ??= null;

  fss.mkdir(plib.resolve(process.env.PWD, 'out'));
  const env = mkEnv({
    root: process.env.PWD,
    cacheRoot: plib.resolve(process.env.PWD, 'out', '.cache'),
  });

  const formats = {};
  for (const dname of fss.list('./fmt', { type: 'd' })) {
    const floc = plib.resolve(env.root, 'fmt', dname, 'format.js');

    const format = squire(floc).default;
    const name = plib.parse(floc).dir.split(plib.sep).reverse()[0];
    Object.defineProperty(format, 'name', { value: name });

    formats[name] = format;
  }

  const graph = {};
  graph.notes = [];

  const files = fss.list(
    plib.resolve(env.root, 'notes'),
    { type: 'f', recursive: true },
  );

  for (const floc of files) {
    if (plib.extname(floc) !== '.z') continue;

    const source = fss.read(floc);

    let formatName = null;
    {
      let eol = source.indexOf('\n');
      if (eol === -1) eol = source.length;
      const line0 = source.slice(0, eol);
      if (line0.startsWith('format='))
        formatName = line0.slice('format='.length);
    }
    if (!formatName) {
      env.log.warn(`File at ${floc} has no format; skipping!`);
      continue;
    }

    const format = formats[formatName];
    if (!format) {
      env.log.warn(`File at ${floc} specifies unknown format '${formatName}'; skipping!`);
      continue;
    }

    for (let note of format(floc, source, graph, env)) {
      const cached = env.cache.getOr('notes', [note.hash], null);
      if (cached) note = cached;

      // Initialize transient (non-cached) data
      Object.defineProperty(note, t, { enumerable: false, value: {} });
      note[t].isFromCache = !!cached;
      note[t].format = format;

      graph.notes.push(note);
    }

  }


  env.log.info(`Found ${graph.notes.length} notes`);

  // Log format counts
  {
    const counts = {};
    for (const note of graph.notes)
      counts[note[t].format.name] = (counts[note[t].format.name] || 0) + 1;
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    env.log.info(
      `Found ${Object.keys(formats).length} formats: `
       + sorted.map(k => `${k} (×${counts[k]})`).join(', ')
    );
  }

  for (const note of graph.notes) {
    note.relativeLoc = `n/${note.id}.html`;
    note.href = '/' + note.relativeLoc;
  }

  graph.notesById = iife(function() {
    const notesById = {};
    for (const note of graph.notes)
      notesById[note.id] = note;
    return notesById;
  });

  [graph.jargonSet, graph.jargonToDefiningNoteSet] = iife(function() {
    const jargonSet = new Set();
    const jargonToDefiningNoteSet = {};
    for (const note of graph.notes) {
      for (const jarg of note.defines) {
        jargonSet.add(jarg);
        if (!(jarg in jargonToDefiningNoteSet))
          jargonToDefiningNoteSet[jarg] = new Set();
        jargonToDefiningNoteSet[jarg].add(note);
      }
    }
    return [jargonSet, jargonToDefiningNoteSet];
  });

  const noteReferencedByMap = {};
  for (const note of graph.notes)
    noteReferencedByMap[note.id] = new Set();
  for (const note of graph.notes) {
    for (const refId of note.references) {
      if (!(refId in graph.notesById)) continue;  // can happen due to caching weirdness
      noteReferencedByMap[refId].add(note.id);
    }
  }
  for (const note of graph.notes)
    note.referencedBy = noteReferencedByMap[note.id];

  // graph.resolvedAssetHrefs : { string: string }
  // derived from note.assets : [string]
  // String of absolute paths to files
  graph.resolvedAssetHrefs = iife(function() {
    const resolved = {}
    for (const note of graph.notes) {
      for (const assetLoc of (note.assets ?? [])) {
        if (!plib.isAbsolute(assetLoc))
          throw Error(`Note '${note.id}' requests asset at '${assetLoc}'; asset paths MUST be absolute!`);

        let href = '/' + plib.join('assets', plib.basename(assetLoc));
        while (href in resolved)
          href = href.slice(0, plib.extname(href).length) + '0' + pib.extname(href);
        resolved[assetLoc] = href;
      }
    }
    return resolved;
  });

  // Empty out dir except for cache
  for (const loc of fss.list(plib.resolve(env.root, 'out'))) {
    const isCache = plib.resolve(loc) === plib.resolve(env.cache.root);
    if (!isCache) fss.remove(loc);
  }

  fss.write(plib.resolve(env.root, 'out', 'index.html'), renderIndex(graph));

  env.log.info(`Writing...`);

  for (const note of graph.notes) {
    fss.write(
      plib.resolve(env.root, 'out', 'raw', note.relativeLoc),
      '<base target="_parent">\n'  // makes clicking on <a> break out of <iframe>
      + '<script type="text/javascript" src="https://rawcdn.githack.com/davidjbradshaw/iframe-resizer/036511095578f6166b2e780c9fec5d53bb501e21/js/iframeResizer.contentWindow.min.js"></script>\n'  // for <iframe> resizing
      + note.html
    );

    fss.write(
      plib.resolve(env.root, 'out', note.relativeLoc),
      withTemplate(`<iframe src="${'/raw/' + note.relativeLoc}"></iframe>`, websocketPort),
    );
  }

  fss.mkdir(plib.resolve(env.root, 'out', 'assets'));
  for (const [assetLoc, assetHref] of Object.entries(graph.resolvedAssetHrefs)) {
    const dest = plib.join(env.root, 'out', assetHref);
    if (process.env.Z_SYMLINKS_OK === '1') {
      fss.symlink({ source: assetLoc, dest });  // symlink for speed
    } else {
      fss.copy({ source: assetLoc, dest });
    }
  }

  env.log.info(`Caching...`);
  for (const note of graph.notes) {
    if (note[t].isFromCache) continue;
    env.cache.put('notes', [note.hash], note);
  }

  const doneTime = Date.now();
  const tookSecs = ((doneTime - callTime) / 1000).toFixed(1);
  env.log.success(`Done! (${tookSecs}s)`);

}


function renderIndex(graph) {
  const html = new Cats();

  html.add('<table>\n');

  html.add('<tr>\n');
  html.add('<th>Note</th>\n');
  html.add('<th>⭐</th>\n');
  html.add('<th>Refs</th>\n');
  html.add('<th>Ref&nbsp;by</th>\n');
  html.add('</tr>\n');

  for (
    const note of
      [...graph.notes]
        .sort((na, nb) =>
          !!nb.starred === !!na.starred
          ? nb.referencedBy.size - na.referencedBy.size
          : +!!nb.starred - +!!na.starred
        )
  ) {
    html.add('<tr>\n');
    html.add(`<td style="width: 100%"><a href="${note.href}">${note.id}</a></td>\n`);
    html.add(`<td><center>${note.starred ? '⭐' : ''}</center></td>\n`);
    html.add(`<td><center>${note.references.size}</center></td>\n`);
    html.add(`<td><center>${note.referencedBy.size}</center></td>\n`);
    html.add('</tr>\n');
  }

  html.add('</table>\n');

  return withTemplate(html);
}

function withTemplate(mainHtml, websocketPort = null) {
  const result = new Cats();
  result.add(String.raw`
<!DOCTYPE HTML>

<html>
<head>
  <title>ζ</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
  min-height: 80vh;
}

</style>

</head>

<body>

<nav>ζ&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="/">table</a></nav>

<main>`);

  result.add(mainHtml);

  result.add(`</main>`);

  result.add(`
<script>
document.addEventListener('DOMContentLoaded', () => {
  const $iframe = document.getElementsByTagName('iframe')[0];
  iFrameResize({ log: false }, $iframe);
`);

  if (websocketPort !== null) {
    result.add(String.raw`
  // Refresh iframe on websocket message
  const ws = new WebSocket('ws://localhost:${websocketPort}');
  ws.addEventListener('message', () => $iframe.contentWindow.location.reload());
`);
  }

  result.add(String.raw`
});
</script>
`);

  result.add(`</body></html>`);

  return result.toString();
}
