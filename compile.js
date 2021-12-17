const fs = require('fs');


class Trie {
  constructor(strings, normalize) {
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


class Note {
  constructor(id, text) {
    this.id = id;
    this.text = text;
  }

  get href() {
    return `/${this.id}.html`;
  }

  get jargon() {
    const jargon = new Set();
    let i = 0;
    while (true) {
      i = this.text.indexOf('[:', i);
      const j = this.text.indexOf(':]', i);
      if (i === -1 || j === -1) break;
      jargon.add(Note.toJarg(this.text.slice(i + 2, j)));
      i = j + 2;
    }
    return jargon;
  }

  static toJarg(s) {
    return s.toLowerCase();
  }
}


class Graph {
  constructor(notes) {
    this.notesMap = {};
    for (const note of notes)
      this.notesMap[note.id] = note;

    const jargon = [...notes].flatMap(note => [...note.jargon]);
    this.jargonTrie = new Trie(jargon);

    this.jargonReln = new BinRel(notes.flatMap(note => [...note.jargon].map(jarg => [note, jarg])));
  }

  compile(note) {

    const meta = {
      references: new Set()
    };

    let i = 0;
    let result = '';

    loop:
    while (i < note.text.length) {

      // LaTeX (inline)
      latex_inline:
      if (note.text.startsWith('$$', i)) {
        const j = note.text.indexOf('$$', i + 2);
        if (j === -1) break latex_inline;
        result += note.text.slice(i, j + 2);
        i = j + 2;
        continue loop;
      }

      // LaTeX (block)
      latex_block:
      if (note.text.startsWith('$[', i)) {
        const j = note.text.indexOf(']$', i + 2);
        if (j === -1) break latex_block;
        result += note.text.slice(i, j + 2);
        i = j + 2;
        continue loop;
      }

      span:
      if (note.text.startsWith('\\', i) && !note.text.startsWith('\\\\', i)) {
        const pairs = {
          '[': ']',
          '(': ')',
          '<': '>',
          '{': '}',
          '$': '$',
        };

        let j = i;
        while (!Object.keys(pairs).includes(note.text[j])) j++;
        const open = note.text[j];
        const close = pairs[open];

        const tag = note.text.slice(i + 1, j);

        const k = note.text.indexOf(close, j + 1);
        if (k === -1) break span;
        const content = note.text.slice(j + 1, k);

        result += (
            tag === 'i' ? `<i>${content}</i>`
          : tag === 'b' ? `<b>${content}</b>`
          : tag === 'c' ? `<code style="background: rgba(0, 0, 0, 0.1)">${content}</code>`
          : `<span>${content}</span>`
        );

        i = k + 1;
      }

      // [[explicit reference]]
      if (note.text.startsWith('[[', i)) {
        const j = note.text.indexOf(']]', i);
        const reference = note.text.slice(i + 2, j);
        const jarg = Note.toJarg(reference);
        const source = [...this.jargonReln.rtlGet(jarg)][0];
        if (source)
          result += `<a href="${source.href}">${reference}</a>`;
        else
          result += `<span style="color:ref">${reference}</span>`;
        i = j + 2;

        if (reference in this.notesMap)
          meta.references.add(this.notesMap[reference]);
        continue loop;
      }

      // Implicit reference
      implicit: {
        if (/\w/.test(note.text[i - 1])) break implicit;
        const jarg = this.jargonTrie.longestPrefixOf(Note.toJarg(note.text.slice(i)));
        if (!jarg || /\w/.test(note.text[i + jarg.length])) break implicit;
        const source = [...this.jargonReln.rtlGet(jarg)][0];  // n.b. [0] is arbitrary
        const word = note.text.slice(i, i + jarg.length);
        result += `<a href="${source.href}">${word}</a>`;
        i += word.length;

        meta.references.add(source);
        continue loop;
      }

      // Default case
      result += note.text[i];
      i++;
      continue loop;

    }

  const html = `
<!DOCTYPE HTML>
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
</style>

<div style="font-size: 14px; white-space: pre-wrap; font-family: monospace; line-height: 1.5em; margin: 8vh 28vw;">
${result}
</div>
</body>
`;

  return { html, meta };

  }
}


{
  fs.rmSync('./out', { recursive: true, force: true });
  fs.mkdirSync('./out');

  const notes = fs.readdirSync('./notes').map(fname => {
    const id = fname.slice(0, fname.length - '.z'.length);
    const text = fs.readFileSync('./notes/' + fname).toString();
    return new Note(id, text);
  });

  const graph = new Graph(notes);

  const refReln = new BinRel();

  for (const note of notes) {
    const { html, meta } = graph.compile(note);
    fs.writeFileSync('./out/' + note.href, html);
    for (const ref of meta.references)
      refReln.add(note, ref);
  }

  {
    const popularity = new Map();
    for (const note of notes) popularity.set(note, 0);
    for (const note of notes)
      for (const ref of refReln.ltrGet(note))
        popularity.set(ref, popularity.get(ref) + 1);

    const notesByPopularity = [...notes];
    notesByPopularity.sort((a, b) => popularity.get(b) - popularity.get(a));

    const items = notesByPopularity.map(note =>
      `<li><a href="${note.href}">${note.id}</a> x${popularity.get(note)} (${[...note.jargon].join('; ')})</li>`);

    const html = `
<!DOCTYPE HTML>
<body>
  ${items.join('\n')}
</body>
    `;
    fs.writeFileSync('./out/index.html', html);
  }

  console.log('done');
}
