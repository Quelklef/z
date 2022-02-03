import { promises as fs } from 'fs';
import katex from 'katex';
import * as plib from 'path';

import { min, Trie, StringBuilder, fsExists, mkEnv, renderTikZ } from './util.mjs';

import * as fmt_legacy from './fmt-legacy.mjs';



function renderIndex(notes) {
  const html = (
    [...notes]
      .sort((na, nb) => nb.popularity - na.popularity)
      .map(note => `<center><a href="${note.href}">${note.id}</a></center>`)
      .join('\n')
  );
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

  font-size: 14px;
  font-family: monospace;
  white-space: pre-wrap;
  line-height: 1.5em;
  padding: 4vh 50px;
  margin: 0 auto;
  max-width: 800px;
}

a {
  text-decoration: none;
  border-bottom: 1px dotted hsla(330, 75%, 40%, 1);
  color: hsla(330, 75%, 40%, 1);
}
a:hover {
  border-bottom-style: solid;
}

</style>

</head>

<body>${body}</body>
</html>
`;
}

const formats = [
  fmt_legacy
];

async function main() {

  const pwd = process.env.PWD;
  const out = plib.resolve(pwd, 'out');
  if (!await fsExists(out)) {
    await fs.mkdir(out);
  }

  const env = mkEnv(out);

  const graph = {};
  graph.notes = [];

  console.log('Reading');
  await Promise.all(formats.map(async format => {
    for await (const note of format.gather(pwd)) {
      console.log(`Found: ${note.id}`);
      note.format = format;
      note.href = `${note.id}.html`;
      graph.notes.push(note);
    }
  }));

  graph.notesById = {};
  for (const note of graph.notes)
    graph.notesById[note.id] = note;

  await Promise.all(graph.notes.map(async note => {
    console.log(`Phase 1: ${note.id}`);
    await note.format.prep1_jargon(note, graph, env);
  }));

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
    console.log(`Phase 2: ${note.id}`);
    await note.format.prep2_references(note, graph, env);
  }));

  for (const note of graph.notes)
    note.referencedBy = new Set();
  for (const note of graph.notes) {
    for (const ref of note.references)
      ref.referencedBy.add(note);
  }

  for (const note of graph.notes)
    note.popularity = note.referencedBy.size;

  await Promise.all(graph.notes.map(async note => {
    console.log(`Phase 3: ${note.id}`);
    await note.format.prep3_render(note, graph, env);
  }));

  console.log('Writing');
  await Promise.all([
    fs.writeFile(plib.resolve(out, 'index.html'), withTemplate(renderIndex(graph.notes))),
    ...graph.notes.map(async note => {
      await fs.writeFile(
        plib.resolve(out, note.href),
        withTemplate(note.html),
      );
    }),
  ]);

  console.log('Done!');

}

main();
