import fs from 'fs';
import katex from 'katex';
import * as plib from 'path';

import { lazyAss, cache } from './util.mjs';

import fmt_legacy from './fmt-legacy.mjs';
fmt_legacy.source = fs.readFileSync('./fmt-legacy.mjs').toString();

import fmt_reprise from './fmt-reprise.mjs';
fmt_reprise.source = fs.readFileSync('./fmt-reprise.mjs').toString();





const formats = [
  fmt_legacy,
  fmt_reprise,
];

function main() {

  const pwd = process.env.PWD;
  const out = plib.resolve(pwd, 'out');
  if (!fs.existsSync(out)) {
    fs.mkdirSync(out);
  }

  cache.root = plib.resolve(out, '.cache');

  const graph = {};
  graph.notes = [];

  graph.newNote = () => {
    const note = {};
    note.t = {};  // Transient data, doesn't get cached
    return note;
  };

  for (const format of formats) {
    for (const note of format(pwd, graph)) {
      note.t.format = format;
      // console.log(`Gathering [format=${format.name}] [${note.id}]`)
      graph.notes.push(note);
    }
  }
  console.log(`Found ${graph.notes.length} notes`);

  const getCacheKeys = note => [note.id, note.source, note.t.format.source];

  // Consult the cache
  for (let i = 0; i < graph.notes.length; i++) {
    const note = graph.notes[i];
    const cached = cache.getOr(getCacheKeys(note), null);
    if (cached) {
      // console.log(`Cached [${note.id}]`);
      graph.notes[i] = cached;
      graph.notes[i].t.isFromCache = true;
    } else {
      note.t.isFromCache = false;
    }
  }

  for (const note of graph.notes) {
    lazyAss(note, 'href', () => '/n/' + note.id + '.html');
    lazyAss(note, 'relativeOutLoc', () => 'n/' + note.id + '.html');
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
      console.log('Longest jargon at:', longest.length, 'is:', longest);
  }

  for (const note of graph.notes)
    note.referencedBy = new Set();
  for (const note of graph.notes) {
    for (const refId of note.references) {
      if (!(refId in graph.notesById)) continue;  // can happen due to caching weirdness
      graph.notesById[refId].referencedBy.add(note.id);
    }
  }

  for (const note of graph.notes)
    note.popularity = note.referencedBy.size;

  fs.writeFileSync(plib.resolve(out, 'index.html'), renderIndex(graph));
  if (!fs.existsSync(plib.resolve(out, 'n'))) fs.mkdirSync(plib.resolve(out, 'n'));

  for (const note of graph.notes) {
    // console.log(`Writing [${note.id}]`)
    fs.writeFileSync(
      plib.resolve(out, note.relativeOutLoc),
      withTemplate(note.html),
    );
  }

  for (const note of graph.notes) {
    if (!note.t.isFromCache) {
      console.log(`Caching [${note.id}]`);
      const cacheKeys = getCacheKeys(note);
      note.t = {};
      cache.put(cacheKeys, note);
    }
  }

  console.log('Done!');

}

function renderIndex(graph) {
  let html;

  html = (
    [...graph.notes]
      .sort((na, nb) => nb.popularity - na.popularity)
      .map(note => `<p><a href="${note.href}">${note.id}</a></p>`)
      .join('')
  );

  html += `
    <style>
      p {
        line-height: 1.2em;
        margin: .5em;
      }
    </style>
  `;

  html = withTemplate(html);

  return html;
}

function withTemplate(body) {
  return `
    <!DOCTYPE HTML>

    <html>
    <head>
      <meta charset="utf-8">
      <title>ζ</title>

      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css">
    <style>

    body {
      padding: 4vh 50px;
      max-width: 800px;
      margin: 0 auto;

      font-size: 14px;
      font-family: monospace;
      line-height: 1.5em;
    }

    nav {
      margin-bottom: 4em;
    }

    main {
      white-space: pre-wrap;
    }

    a {
      text-decoration: none;
      color: black;
      background-color: hsla(330, 75%, 85%, .25);
    }
    a:hover {
      background-color: hsla(330, 75%, 70%, .50);
    }

    hr {
      border: none;
      border-bottom: 1px dashed lightgrey;
    }

    code {
      background-color: rgba(0, 0, 0, 0.05);
      padding: 1px 4px;
      border: 1px solid rgb(200, 200, 200);
      border-radius: 3px;
    }

    </style>

    </head>

    <body>

    <nav>ζ &bull; <a href="/">index</a></nav>

<main>${body}</main>

    </body>
    </html>
`;
}

main();
