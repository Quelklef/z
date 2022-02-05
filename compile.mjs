import { promises as fs } from 'fs';
import katex from 'katex';
import * as plib from 'path';

import { min, Trie, StringBuilder, fsExists, mkEnv, renderTikZ } from './util.mjs';

import * as fmt_legacy from './fmt-legacy.mjs';



const formats = [
  fmt_legacy,
];

async function main() {

  const pwd = process.env.PWD;
  const out = plib.resolve(pwd, 'out');
  if (!await fsExists(out)) {
    await fs.mkdir(out);
  }

  const env = await mkEnv(out);

  const graph = {};
  graph.notes = [];

  // note id -> format
  // stored separately so it's not saved into cache
  const fmts = {};

  console.log('Reading');
  await Promise.all(formats.map(async format => {
    for await (const note of format.gather(pwd, env)) {
      fmts[note.id] = format;
      graph.notes.push(note);
    }
  }));
  console.log(`Found ${graph.notes.length} notes`);

  const getNoteCacheKeys = note =>
    [ note.source
    , fmts[note.id].gather
    , fmts[note.id].phase1
    , fmts[note.id].phase2
    , fmts[note.id].phase3
    ];

  for (const note of graph.notes) {
    const keys = getNoteCacheKeys(note);
    if (await env.cache.has(keys)) {
      Object.assign(note, await env.cache.get(keys));
      note.skipMe = true;
    } else {
      note.skipMe = false;
    }
  }

  await Promise.all(graph.notes.map(async note => {
    if (note.skipMe) return;
    note.href = (note.id === 'index' ? 'index_' : note.id) + '.html';
    await fmts[note.id].phase1(note, graph, env);
    console.log(`Phase 1: ${note.id}`);
  }));

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

  await Promise.all(graph.notes.map(async note => {
    if (note.skipMe) return;
    console.log(`Phase 2: ${note.id}`);
    await fmts[note.id].phase2(note, graph, env);
  }));

  for (const note of graph.notes)
    note.referencedBy = new Set();
  for (const note of graph.notes) {
    for (const refId of note.references)
      graph.notesById[refId].referencedBy.add(note.id);
  }

  for (const note of graph.notes)
    note.popularity = note.referencedBy.size;

  await Promise.all(graph.notes.map(async note => {
    if (note.skipMe) return;
    console.log(`Phase 3: ${note.id}`);
    await fmts[note.id].phase3(note, graph, env);
  }));

  console.log('Caching');
  for (const note of graph.notes) {
    if (!note.skipMe) {
      const keys = getNoteCacheKeys(note);
      await env.cache.put(keys, note);
    }
  }

  console.log('Writing');
  await Promise.all([
    fs.writeFile(plib.resolve(out, 'index.html'), renderIndex(graph)),
    ...graph.notes.map(async note => {
      await fs.writeFile(
        plib.resolve(out, note.href),
        withTemplate(note.html),
      );
    }),

  ]);

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
      margin: 0;
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
      color: hsla(330, 75%, 40%, 1);
    }
    a:hover {
      border-bottom: 1px dotted hsla(330, 75%, 40%, 1);
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
