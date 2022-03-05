import fs from 'fs';
import katex from 'katex';
import * as plib from 'path';

import { lazyAss, cache } from './util.mjs';



// n.b. I would love to dynamically load these with require(),
//      but we're using modules instead...

import fmt_legacy from './fmt-legacy.mjs';
import fmt_reprise from './fmt-reprise.mjs';
import fmt_proper from './fmt-proper.mjs';

const formats = [
  fmt_legacy,
  fmt_reprise,
  fmt_proper,
];



function main() {

  const pwd = process.env.PWD;
  const out = plib.resolve(pwd, 'out');
  fs.mkdirSync(out, { recursive: true });

  // Initialize cache
  cache.root = plib.resolve(out, '.cache');

  const graph = {};
  graph.notes = [];

  const t = Symbol('compile.t');

  for (const format of formats) {
    for (let note of format(pwd, graph)) {

      const cached = cache.getOr(note.cacheKeys, null);
      if (cached) note = cached;

      // Initialize transient (non-cached) data
      Object.defineProperty(note, t, { enumerable: false, value: {} });
      note[t].isFromCache = !!cached;
      note[t].format = format;

      graph.notes.push(note);

    }
  }

  console.log(`Found ${graph.notes.length} notes`);

  // Log format counts
  {
    const counts = {};
    for (const note of graph.notes)
      counts[note[t].format.name] = (counts[note[t].format.name] || 0) + 1;
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    console.log('Formats:');
    for (const k of sorted)
      console.log(' ', k, 'has', counts[k], 'notes');
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

  writeFile(plib.resolve(out, 'index.html'), renderIndex(graph));

  for (const note of graph.notes) {

    const html = (
      '<base target="_parent">\n'  // makes clicking on <a> break out of <iframe>
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
    console.log(`Caching [${note.id}]`);
    cache.put(note.cacheKeys, note);
  }

  console.log('Done!');

}

function writeFile(loc, content) {
  fs.mkdirSync(plib.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, content);
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

function withTemplate(mainHtml) {
  return String.raw`
    <!DOCTYPE HTML>

    <html>
    <head>
      <meta charset="utf-8">
      <title>ζ</title>
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

    a {
      text-decoration: none;
      color: black;
      background-color: hsla(330, 75%, 85%, .25);
    }
    a:hover {
      background-color: hsla(330, 75%, 70%, .50);
    }

    iframe {
      border: none;
      width: 100%;
      height: 80vh;
    }

    </style>

    </head>

    <body>

    <nav>ζ &bull; <a href="/">index</a></nav>

<main id="main">${mainHtml}</main>
    </body>
    </html>
`;
}

main();
