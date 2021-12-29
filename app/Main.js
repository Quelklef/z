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

function min(x, y) {
  return x < y ? x : y;
}

function extract(text, open, close) {
  const result = [];
  let i = 0;
  while (true) {
    i = text.indexOf(open, i);
    const j = text.indexOf(close, i);
    if (i === -1 || j === -1) break;
    result.push(text.slice(i + open.length, j));
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

function j_norm(s) {
  return s.toLowerCase();
}

// -- end util -- //

const getNotes = async function() {
  const listResponse = await fetch('/api/list');
  const noteIds = await listResponse.json();

  async function getNote(noteId) {
    const getResponse = await fetch(`/api/get/${noteId}`);
    const content = await getResponse.text();
    return {
      text: content,
      id: noteId,
    };
  }

  return await Promise.all(noteIds.map(getNote));
}

function decorate(notes, meta) {

  meta.notesById = {};
  for (const note of notes)
    meta.notesById[note.id] = note;

  for (const note of notes)
    note.definedJargonSet = new Set(extract(note.text, '[:', ':]').map(j_norm));

  meta.allJargonTrie = new Trie([...notes].flatMap(note => [...note.definedJargonSet]));

  for (const note of notes) {
    note.mentionedJargonSet = new Set();
    let i = 0;
    while (i < note.text.length) {
      if (/\w/.test(note.text[i - 1])) { i++; continue; }
      const jarg = meta.allJargonTrie.longestPrefixOf(j_norm(note.text.slice(i)));
      if (note.definedJargonSet.has(jarg)) { i++; continue; }
      if (!jarg || /\w/.test(note.text[i + jarg.length])) { i++; continue; }
      const word = note.text.slice(i, i + jarg.length);
      note.mentionedJargonSet.add(jarg);
      i += word.length;
    }
  }

  meta.jargonToDefiningNoteSetMap = {};
  for (const note of notes) {
    for (const jarg of note.definedJargonSet) {
      if (!(jarg in meta.jargonToDefiningNoteSetMap))
        meta.jargonToDefiningNoteSetMap[jarg] = new Set();
      meta.jargonToDefiningNoteSetMap[jarg].add(note);
    }
  }

  for (const note of notes) {
    note.mentionedJargonToDefiningNoteMap = {};
    // Do it naively (for now)
    for (const jarg of note.mentionedJargonSet) {
      const definingNote = [...meta.jargonToDefiningNoteSetMap[jarg]][0];
      note.mentionedJargonToDefiningNoteMap[jarg] = definingNote;
    }
  }

  for (const note of notes) {
    note.referencedNoteSet = new Set();

    // Explicit references
    for (const refId of extract(note.text, '[[', ']]')) {
      const refNote = meta.notesById[refId];
      if (refNote)
        note.referencedNoteSet.add(refNote);
    }

    // Implicit references
    for (const ref of Object.values(note.mentionedJargonToDefiningNoteMap))
      note.referencedNoteSet.add(ref);
  }

  {
    for (const note of notes)
      note.referencedBySet = new Set();
    for (const note of notes) {
      for (const ref of note.referencedNoteSet)
        ref.referencedBySet.add(note);
    }
    for (const note of notes)
      note.popularity = note.referencedBySet.size;
  }

  for (const note of notes) {
    note.mkLink = function(text = null) {
      text = text || note.id;
      return `<a href="#/${note.id}" onclick="app.routes.note('${note.id}')">${text}</a>`;
    }
  }

}

function renderIndex(notes, meta) {
  return (
    [...notes]
      .sort((na, nb) => nb.popularity - na.popularity)
      .map(note => `${note.mkLink()} (⋆${note.popularity}) (${[...note.definedJargonSet].join(', ')})`)
      .join('\n')
  );
}

function chompDelimited(text, i, open, close) {
  if (!text.startsWith(open, i)) return [i, null];
  const j = text.indexOf(close, i + open.length);
  if (j === -1) return [i, null];
  const content = text.slice(i + open.length, j);
  return [j + close.length, content];
}

function renderNote(note) {

  const mentionedJargonTrie = new Trie(note.mentionedJargonSet);

  let i = 0;
  let html = '';

  loop:
  while (i < note.text.length) {

    // literal sections
    {
      const literalDelims = [
        ['$$', '$$'],  // inline latex
        ['$[', ']$'],  // block latex
      ];
      for (const elem of literalDelims) {
        const [open, close] = elem;
        let content;
        [i, content] = chompDelimited(note.text, i, open, close);
        if (content !== null) {
          html += open + content + close;
          continue loop;
        }
      }
    }

    // Definitions
    defn:
    if (note.text.startsWith('[:', i)) {
      const j = note.text.indexOf(':]', i + 2);
      if (j === -1) break defn;
      html += note.text.slice(i, j + 2);
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
        '::': ';;',
      };

      let j = i, open, close;
      done: while (!open) {
        for (const elem of Object.entries(pairs)) {
          const [left, right] = elem;
          if (note.text.startsWith(left, j)) {
            [open, close] = [left, right];
            break done;
          }
        }
        j++;
      }

      const tag = note.text.slice(i + '\\'.length, j);

      const k = note.text.indexOf(close, j + open.length);
      if (k === -1) break span;
      const content = note.text.slice(j + open.length, k);

      html += (
          tag === 'i' ? `<i>${content}</i>`
        : tag === 'b' ? `<b>${content}</b>`
        : tag === 'c' ? `<code style="background: rgba(0, 0, 0, 0.1)">${content}</code>`
        : tag === 'z' ? `<script type="text/tikz"> ${content} </script>`
        : tag === 'Z' ? `<center><script type="text/tikz"> ${content} </script></center>`
        : `<span>${content}</span>`
      );

      i = k + close.length;
    }

    // [[explicit reference]]
    if (note.text.startsWith('[[', i)) {
      const j = note.text.indexOf(']]', i);
      const refToWord = note.text.slice(i + 2, j);
      const refToNote = note.mentionedJargonToDefiningNoteMap[j_norm(refToWord)];
      if (refToNote)
        html += refToNote.mkLink(refToWord);
      else
        html += `<span style="color:ref">${refToWord}</span>`;
      i = j + 2;
      continue loop;
    }

    // Implicit reference
    // TODO:
    //   This has a bug where if two jargs A,B match the current text,
    //   and A is shorter than B, and A does not end on a word boundary
    //   but B does, then we will fail to add a link to B.
    implicit: {
      if (/\w/.test(note.text[i - 1])) break implicit;
      const jarg = mentionedJargonTrie.longestPrefixOf(j_norm(note.text.slice(i)));
      if (!jarg || /\w/.test(note.text[i + jarg.length])) break implicit;
      const word = note.text.slice(i, i + jarg.length);
      const refToNote = note.mentionedJargonToDefiningNoteMap[jarg];
      html += refToNote.mkLink(word);
      i += word.length;
      continue loop;
    }

    // Default case
    html += note.text[i];
    i++;
    continue loop;

  }

  return `
${html}








<u>Referenced by:</u>
<ul style="line-height: 1.2em">${
  [...note.referencedBySet]
    .sort((a, b) => b.popularity - a.popularity)
    .map(n => '<li>' + n.mkLink() + ' (' + [...n.definedJargonSet].join(', ') + ')</li>')
    .join('')
}</ul>`;

}

function doKatex() {
  window.renderMathInElement(document.body,
    { delimiters:
      [
        { left: '$$', right: '$$', display: false },
        { left: '$[', right: ']$', display: true },
      ]
    }
  );

  // Display math has weird margins in elements with white-space:pre-wrap
  // Fix that here
  for (const $el of document.getElementsByClassName('katex-display')) {
    const text = $el.parentNode.nextSibling;
    if (text && text.nodeName === '#text' && text.textContent.startsWith('\n'))
      text.textContent = text.textContent.slice(1);
  }
}

async function fmain() {
  const notes = await getNotes();
  const meta = {};
  decorate(notes, meta);

  const $main = document.getElementsByTagName('main')[0];

  const app = window.app = {};

  app.routes = {};
  app.routes.index = function() {
    console.log('Route to index');
    $main.innerHTML = renderIndex(notes, meta);
    doKatex();
  }
  app.routes.note = function(noteId) {
    console.log(`Route to ${noteId}`);
    const note = meta.notesById[noteId];
    if (note) {
      $main.innerHTML = renderNote(note);
      doKatex();
    }
  }

  const id = window.location.hash.slice(2);
  if (id && id in meta.notesById) app.routes.note(id);
  else app.routes.index();
}

exports.fmain = fmain;
