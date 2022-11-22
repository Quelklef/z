const { katex } = require('katex');
const plib = require('path');

const { lazyAss, Cats, iife } = require('./util.js');
const { Cache } = require('./cache.js');
const logging = require('./log.js');
const fss = require('./fss.js');

const fileSrc = fss.read(__filename).toString();

const main =
exports.main =
function main({
  sourcePath,  // location of source files
  destPath,  // compilation destination
  serverPort,
  websocketPort,
  symlinksOk,
  emitSensitiveInfo,

  reducePaths,
  ignoreCache,
}) {

  reducePaths ??= (x => x);

  const callTime = Date.now();

  fss.mkdir(destPath);
  const issuesLogged = [];  // persists warnings and errors
  const aff = {
    opts: { emitSensitiveInfo },

    cache: new Cache(plib.resolve(destPath, '.cache')),

    issuesLogged,
    logHandler: (
      logging.addHandlers(
        logging.stdoutHandler,
        logging.writerHandler(issuesLogged, ['warn', 'error']),
      )
    ),
    get log() {
      return new logging.Logger(this.logHandler);
    },
  };

  // Holds transient (ie, not cached) information
  const trans = new WeakMap();

  const formats = {};
  const formatsHome = plib.resolve(__dirname, 'fmt');
  for (const dname of fss.list(formatsHome, { type: 'd' })) {
    const floc = plib.resolve(formatsHome, dname, 'format.js');

    const format = require(floc).default;
    const name = plib.parse(floc).dir.split(plib.sep).reverse()[0];
    Object.defineProperty(format, 'name', { value: name });

    formats[name] = format;
  }

  const graph = {};
  graph.notes = [];

  let files = Array.from(fss.list(sourcePath, { type: 'f', recursive: true }));
  files = reducePaths(files);

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
      aff.log.warn(`File at ${floc} has no format; skipping!`);
      continue;
    }

    const format = formats[formatName];
    if (!format) {
      aff.log.warn(`File at ${floc} specifies unknown format '${formatName}'; skipping!`);
      continue;
    }

    const subAff = Object.create(aff);
    subAff.logHandler = logging.withPrefix(aff.logHandler, plib.relative(sourcePath, floc));
    subAff.parent = subAff;  // legacy compat; remove when possible

    for (let note of format(floc, source, graph, subAff)) {
      const cached = aff.cache.getOr('notes', [note.hash], null);
      if (cached && !ignoreCache)
        note = cached;

      // initialize transient data
      trans.set(note, {
        isFromCache: !!cached,
        format: format,
      });

      graph.notes.push(note);
    }

  }


  aff.log.info(`Found ${graph.notes.length} notes`);

  // Log format counts
  {
    const counts = {};
    for (const note of graph.notes)
      counts[trans.get(note).format.name] = (counts[trans.get(note).format.name] || 0) + 1;
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    aff.log.info(
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

  // Empty out dir except for cache and .git (used for something)
  for (const loc of fss.list(destPath)) {
    const isCache = plib.resolve(loc) === plib.resolve(aff.cache.root);
    const isGit = loc.endsWith('.git');
    if (!isCache && !isGit) fss.remove(loc);
  }

  aff.log.info(`Writing...`);

  // Write notes
  for (const note of graph.notes) {
    fss.write(
      plib.resolve(destPath, 'raw', note.relativeLoc),

      // make clicking on <a> break out of <iframe>
      '<base target="_parent">\n'

      // for <iframe> resizing
      + '<script type="text/javascript" src="https://rawcdn.githack.com/davidjbradshaw/iframe-resizer/036511095578f6166b2e780c9fec5d53bb501e21/js/iframeResizer.contentWindow.min.js"></script>\n'

      // have events bubble out of <iframe>
      + `<script>
           const evNames = ['keypress']
           for (const evName of evNames) {
             window.addEventListener(evName, ev => {
               const clone = new ev.constructor(ev.type, ev);
               window.parent.document.dispatchEvent(clone);
             });
           }
         </script>`

      + note.html
    );

    fss.write(
      plib.resolve(destPath, note.relativeLoc),
      withTemplate(
        `<iframe src="${'/raw/' + note.relativeLoc}"></iframe>`,
        renderReferencedBy(graph, note),
        websocketPort,
      ),
    );
  }

  // Write index
  fss.write(plib.resolve(destPath, 'index.html'), renderIndex(graph));

  // Write search index
  fss.write(plib.resolve(destPath, 'search.json'), renderSearchIndex(graph, aff));

  // Write assets
  fss.mkdir(plib.resolve(destPath, 'assets'));
  for (const [assetLoc, assetHref] of Object.entries(graph.resolvedAssetHrefs)) {
    const dest = plib.join(destPath, assetHref);
    if (symlinksOk) {
      fss.symlink({ source: assetLoc, dest });  // symlink for speed
    } else {
      fss.copy({ source: assetLoc, dest });
    }
  }

  aff.log.info(`Caching...`);
  for (const note of graph.notes) {
    if (trans.get(note).isFromcache) continue;
    aff.cache.put('notes', [note.hash], note);
  }

  const doneTime = Date.now();
  const tookSecs = ((doneTime - callTime) / 1000).toFixed(1);
  aff.log.success(`Done! (${tookSecs}s)`);

  // Replay warnings and errors
  if (aff.issuesLogged.length > 0) {
    console.log('\nIssues:\n');
    logging.replayWith(aff.issuesLogged, logging.stdoutHandler);
  }

}


function renderSearchIndex(graph, aff) {
  return aff.cache.at('metadata', ['search-index', renderSearchIndex.toString()], () => {
    aff.log.info('Building search index');

    const index = {};

    // must have no free variables, since it gets .toString()'d
    const tokenize = source => (
        source
        .replace(/_/g, '')
        .split(/\W/g)
        .filter(tok => !!tok)
        .map(tok => tok.toLowerCase())
    );

    index.tokenize = tokenize.toString();

    index.notes = {};

    for (const note of graph.notes) {
      const noteInfo = {};
      index.notes[note.id] = noteInfo;

      const noteTokens = tokenize(note.id + ' ' + note.source);

      noteInfo.id = note.id;
      noteInfo.totalWordCount = noteTokens.length;

      const counts = noteInfo.counts = {};
      for (let word of noteTokens) {
        if (!(word in counts)) counts[word] = 0;
        counts[word] += 1;
      }
    }
    return JSON.stringify(index);
  });
}

const searchClient = `
    <span id="search-root"></span>
    <script>

function mkHtml(html) {
  /* Render a single element */
  const template = document.createElement('template');
  html = html.trim(); // Never return a text node of whitespace as the result
  template.innerHTML = html;
  return template.content.firstChild;
}

function component({ init, render }) {
  const $node = mkHtml(\`<div style="display: contents">\`);
  const comp = { update, modify, getState, $node };

  let state = init;

  function modify(endo) {
    state = endo(state);
    $node.innerHTML = '';
    $node.append(render(state));
  }
  modify(x => x);

  function update(newState) {
    modify(_ => newState);
  }

  // This feels wrong ...
  function getState() {
    return state;
  }

  return comp;
}

(async function() {
  const searchIndex = await (await fetch('/search.json')).json();

  const showCount = 12;

  const tokenize = eval(searchIndex.tokenize);

  function doSearch(query) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const scores = {};
    for (const note of Object.values(searchIndex.notes)) {
      const score = (
        tokens
        .map(tok => note.counts[tok] || 0)
        .reduce((a, b) => a + b, 0)
      ) / note.totalWordCount;
      scores[note.id] = score;
    }

    const noteIds = Object.keys(searchIndex.notes);
    return (
      noteIds
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, showCount)
      .filter(noteId => scores[noteId] > 0)
      .map(noteId => ({ noteId, score: scores[noteId] }))
    );
  }

  const $root = document.getElementById('search-root');

  const $search = mkHtml(\`
    <div style="position: relative"></div>
  \`);
  $root.append($search);

  const $bar = mkHtml(\`
    <input
      type="text"
      style="padding: .5em; width: 40ch"
      placeholder="Press '/' to search"
    />
  \`);
  $search.append($bar);
  document.addEventListener('keypress', ev => {
    if (ev.key === '/') {
      $bar.focus();
      ev.preventDefault();
      ev.stopPropagation();
    }
  });

  const $results = component({
    init: { results: [], selection: null },
    render({ results, selection }) {
      if (results.length === 0)
        return mkHtml('<span>');

      const $box = mkHtml(\`
        <div
         style="
           position: absolute;
           top: 100%;
           width: calc(100% + 2px);
           left: -1px;
           background: white;
           z-index: 99;
           border: 1px solid lightgrey;
           border-top: none;
         "
         ></div>
      \`);

      for (let i = 0; i < results.length; i++) {
        const { noteId, score } = results[i];
        const isSelected = selection === i;

        $box.append(mkHtml(\`
          <div
            style="
              display: flex; justify-content: space-between; font-size: 0.8em;
              \${isSelected ? 'background-color: rgba(255, 100, 100, 0.1)' : ''}
            "
          >
            <a href="/n/\${noteId}.html" class="--no-link-decor" style="flex: 1; padding: 0 .5em">\${noteId}</a>
            <span style="padding: 0 .5em">\${(score * 100).toFixed(2) + '%'}</span>
          </div>
        \`));
      }
      return $box;
    },
  });
  $search.append($results.$node);

  $bar.addEventListener('input', () => {
    const query = $bar.value;
    $results.modify(state => ({ ...state, results: doSearch(query) }));
  });

  $bar.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') {
      $results.modify(moveSelection(+1));
      ev.preventDefault();
    } else if (ev.key === 'ArrowUp') {
      $results.modify(moveSelection(-1));
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      $bar.blur();
    } else if (ev.key === 'Enter') {
      const sel = $results.getState().results[$results.getState().selection];
      if (sel) {
        const url = '/n/' + sel.noteId + '.html';
        if (ev.shiftKey || ev.ctrlKey)
          window.open(url, '_blank');
        else
          window.location = url;
      }
    } else {
      return;
    }

    function moveSelection(n) {
      return state => {
        const base = Math.min(showCount, $results.getState().results.length);
        state.selection = (state.selection === null ? 0 : mod(state.selection + n, base));
        return state;
      };
    }

    function mod(n, k) {
      return ((n % k) + k) % k;
    }
  });

})()

    </script>
`;


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

// WANT: using ejs might be nice
function withTemplate(mainHtml, postHtml = '', websocketPort = null) {
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

* {
  box-sizing: border-box;
}

body {
  padding: 4vh 0;
  padding-bottom: 25vh;
  margin: 0 auto;

  font-size: 18px;
  font-family: sans serif;
  line-height: 1.5em;
}

body {
  max-width: 800px;
}
iframe, nav {
  padding: 0 0;
}

nav {
  margin-bottom: 3em;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

a:not(.--no-link-decor) {
  text-decoration: none;
  color: black;
  border-bottom: 1px solid #C06;
}

a:not(.--no-link-decor):hover {
  border-bottom-width: 2px;
}

a.--no-link-decor {
  color: inherit;
  text-decoration: none;
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

<nav>
  <span>ζ&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="/">table</a></span>
  ${searchClient}
</nav>

<main>`);

  result.add(mainHtml);

  result.add(`</main>`);

  result.add(postHtml);

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

function renderReferencedBy(graph, note) {
  const referencedBy = [...note.referencedBy].map(id => graph.notesById[id]);

  if (referencedBy.length === 0) return '';
  const html = new Cats();
  html.add('<div class="hide-on-print" style="font-size: .8em; line-height: 1.5em">');  // TODO: remove <style>
  html.add('<br /><br />');
  html.add('<hr />');
  html.add('<p>Referenced by:</p>');
  html.add('<ul>');
  for (const refBy of referencedBy) {
    html.add(`<li><a href="${refBy.href}" class="reference explicit">${refBy.id}</a></li>`);
  }
  html.add('</ul>');
  html.add('</div>');
  return html;
}
