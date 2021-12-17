const fs = require('fs');


class Trie {
  constructor(strings) {
    this.isElement = Symbol("isElement");

    this.trie = {};
    strings = new Set(strings);
    for (const str of strings) {
      let root = this.trie;
      for (const ch of str)
        root = (root[ch] = root[ch] || {});
      root[this.isElement] = true;
    }
  }

  longestPrefixOf(string) {
    let result = null;
    let root = this.trie;
    let path = '';

    for (const ch of string) {
      if (root[this.isElement]) result = path;
      root = root[ch];
      path += ch;
      if (root === undefined) break;
    }
    if (root && root[this.isElement]) result = path;

    return result;
  }
}


class BinRel {
  constructor(pairs = []) {
    this.ltr = new Map();
    this.rtl = new Map();

    for (const [l, r] of pairs)
      this.add(l, r);
  }

  add(l, r) {
    if (!this.ltr.has(l)) this.ltr.set(l, new Set());
    this.ltr.get(l).add(r);
    if (!this.rtl.has(r)) this.rtl.set(r, new Set());
    this.rtl.get(r).add(l);
  }

  rtlGet(r) {
    return (this.rtl.get(r) || new Set());
  }

  ltrGet(l) {
    return (this.ltr.get(l) || new Set());
  }
}


function j_norm(s) {
  return s.toLowerCase();
}

function extract(text, open, close) {
  const result = new Set();
  let i = 0;
  while (true) {
    i = text.indexOf(open, i);
    const j = text.indexOf(close, i);
    if (i === -1 || j === -1) break;
    result.add(text.slice(i + open.length, j));
    i = j + close.length;
  }
  return result;
}

// preimage mapping
// map k v -> map v [k]
function invert(map) {
  const inv = {};
  for (const k in map) {
    for (const v of map[k]) {
      if (!(v in inv)) inv[v] = [];
      inv[v].push(k);
    }
  }
  return inv;
}

class Note {
  constructor({ id, fname, jdefs, jmap, refs, refby }) {
    this.id = id;
    this.fname = fname;
    this.jdefs = jdefs;
    this.jmap = jmap;
    this.refs = refs;
    this.refby = refby;
  }

  get source() {
    return fs.readFileSync(this.fname).toString();
  }

  get href() {
    return `/${this.id}.html`;
  }

  get popularity() {
    return this.refby.size;
  }

  get jrefs() {
    return Object.keys(this.jmap);
  }

  get listItemHtml() {
    return `<li><a href="${this.href}">${this.id}</a> (⋆${this.popularity}) (${[...this.jdefs].join(', ')})</li>`;
  }
}


{

  fs.rmSync('./out', { recursive: true, force: true });
  fs.mkdirSync('./out');

  const noteIds = new Set(fs.readdirSync('./notes').map(fname => fname.slice(0, fname.length - '.z'.length)));
  const getSource = noteId => fs.readFileSync(`./notes/${noteId}.z`).toString();

  const mapJargonDef = {};  // note id -> Set(defined jargon)
  {
    for (const noteId of noteIds)
      mapJargonDef[noteId] = new Set([...extract(getSource(noteId), '[:', ':]')].map(j_norm));
  }

  const mapJargonMen = {};  // note id -> Set(mentioned jargon)
  {
    const allJargon = new Trie(Object.values(mapJargonDef).flatMap(jarg => [...jarg]));
    for (const noteId of noteIds) {
      const jargon = mapJargonMen[noteId] = new Set();
      const source = getSource(noteId);

      let i = 0;
      while (i < source.length) {
        if (/\w/.test(source[i - 1])) { i++; continue; }
        const jarg = allJargon.longestPrefixOf(j_norm(source.slice(i)));
        if (!jarg || /\w/.test(source[i + jarg.length])) { i++; continue; }
        const word = source.slice(i, i + jarg.length);
        jargon.add(j_norm(word));
        i += word.length;
      }
    }
  }

  // Resolve implicit references
  const mapJargonRef = {};  // note id -> jarg -> target note id
  {
    // Do it naively (for now)
    const mapJargonDef_inv = invert(mapJargonDef);
    for (const noteId of noteIds) {
      mapJargonRef[noteId] = {};
      for (const jarg of mapJargonMen[noteId]) {
        mapJargonRef[noteId][jarg] = mapJargonDef_inv[jarg][0];
      }
    }
  }

  const mapRef = {} // note id -> Set(referenced notes)
  {
    for (const noteId of noteIds) {
      mapRef[noteId] = new Set([
        ...extract(getSource(noteId), '[[', ']]'),  // explicit
        ...Object.values(mapJargonRef[noteId]),  // implicit
      ]);
    }
  }

  let notes = {};
  {
    for (const noteId of noteIds) {
      notes[noteId] = new Note({
        id: noteId,
        fname: `./notes/${noteId}.z`,
        jdefs: mapJargonDef[noteId],
        jmap: null,
        refs: mapRef[noteId],
        refby: null,
      });
    }

    for (const noteId of noteIds) {
      const jmap = notes[noteId].jmap = {};
      for (const [jarg, refId] of Object.entries(mapJargonRef[noteId])) {
        jmap[jarg] = notes[refId];
      }
    }

    for (const noteId of noteIds) {
      notes[noteId].refby = new Set([...noteIds].filter(nid => mapRef[nid].has(noteId)).map(nid => notes[nid]));
    }
  }

  for (const note of Object.values(notes)) {
    fs.writeFileSync(`./out/${note.id}.html`, compile(note));
  }

  {
    const notesByPopularity = [...Object.values(notes)];
    notesByPopularity.sort((a, b) => b.popularity - a.popularity);

    const html = template(`<ul>${notesByPopularity.map(n => n.listItemHtml).join('')}</ul>`);
    fs.writeFileSync('./out/index.html', html);
  }


  console.log('done');

}


function compile(note) {
  const source = note.source;
  const jtrie = new Trie(Object.keys(note.jmap));

  let i = 0;
  let html = '';

  loop:
  while (i < source.length) {

    // LaTeX (inline)
    latex_inline:
    if (source.startsWith('$$', i)) {
      const j = source.indexOf('$$', i + 2);
      if (j === -1) break latex_inline;
      html += source.slice(i, j + 2);
      i = j + 2;
      continue loop;
    }

    // LaTeX (block)
    latex_block:
    if (source.startsWith('$[', i)) {
      const j = source.indexOf(']$', i + 2);
      if (j === -1) break latex_block;
      html += source.slice(i, j + 2);
      i = j + 2;
      continue loop;
    }

    span:
    if (source.startsWith('\\', i) && !source.startsWith('\\\\', i)) {
      const pairs = {
        '[': ']',
        '(': ')',
        '<': '>',
        '{': '}',
        '$': '$',
      };

      let j = i;
      while (!Object.keys(pairs).includes(source[j])) j++;
      const open = source[j];
      const close = pairs[open];

      const tag = source.slice(i + 1, j);

      const k = source.indexOf(close, j + 1);
      if (k === -1) break span;
      const content = source.slice(j + 1, k);

      html += (
          tag === 'i' ? `<i>${content}</i>`
        : tag === 'b' ? `<b>${content}</b>`
        : tag === 'c' ? `<code style="background: rgba(0, 0, 0, 0.1)">${content}</code>`
        : `<span>${content}</span>`
      );

      i = k + 1;
    }

    // [[explicit reference]]
    if (source.startsWith('[[', i)) {
      const j = source.indexOf(']]', i);
      const refToWord = source.slice(i + 2, j);
      const refToNote = note.jmap[j_norm(refToWord)];
      if (refToNote)
        html += `<a href="${refToNote.href}">${refToWord}</a>`;
      else
        html += `<span style="color:ref">${refToWord}</span>`;
      i = j + 2;
      continue loop;
    }

    // Implicit reference
    implicit: {
      if (/\w/.test(source[i - 1])) break implicit;
      const jarg = jtrie.longestPrefixOf(j_norm(source.slice(i)));
      if (!jarg || /\w/.test(source[i + jarg.length])) break implicit;
      const word = source.slice(i, i + jarg.length);
      const refToNote = note.jmap[jarg];
      html += `<a href="${refToNote.href}">${word}</a>`;
      i += word.length;
      continue loop;
    }

    // Default case
    html += source[i];
    i++;
    continue loop;

  }

  return template(`
${html}








<u>Referenced by:</u>
<ul style="line-height: 1em">${[...note.refby].sort((a, b) => b.popularity - a.popularity).map(n => n.listItemHtml).join('')}</ul>
  `);
}


function template(body) {
  return `<!DOCTYPE HTML>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css" integrity="sha384-R4558gYOUz8mP9YWpZJjofhk+zx0AS11p36HnD2ZKj/6JR5z27gSSULCNHIRReVs" crossorigin="anonymous">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.js" integrity="sha384-z1fJDqw8ZApjGO3/unPWUPsIymfsJmyrDVWC8Tv/a1HeOtGmkwNd/7xUS0Xcnvsx" crossorigin="anonymous"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/contrib/auto-render.min.js" integrity="sha384-+XBljXPPiv+OzfbB3cVmLHf4hdUFHlWNZN5spNQ7rmHTXpd7WvJum6fIACpNNfIR" crossorigin="anonymous"
    onload="renderMathInElement(document.body, { delimiters: [ { left: '$$', right: '$$', display: false }, { left: '$[', right: ']$', display: true } ] });"
  ></script>
</head>
<body>

<style>
a {
  text-decoration: none;
  color: #ab3972;
  background-color: #ab39720d;
}

#main {
  font-size: 14px;
  white-space: pre-wrap;
  font-family: monospace;
  line-height: 1.5em;
  margin: 0 27vw 35vh 27vw;
}
</style>

<div id="main">
ζ &bull; <a href="/">Index</a>


  ${body}
</div>

</body>`;
}



