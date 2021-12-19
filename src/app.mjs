
import { Trie } from './trie.mjs';

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

async function getNotes() {
  const noteIds = await (await fetch('/api/list')).json();

  const notes = [];
  await Promise.all(noteIds.map(async noteId => {
    console.log(`Loading ${noteId}`)
    const content = await (await fetch(`/api/get/${noteId}`)).text();
    notes.push({
      text: content,
      id: noteId,
    });
  }));

  return notes;
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

function renderNote(note) {

  const mentionedJargonTrie = new Trie(note.mentionedJargonSet);

  let i = 0;
  let html = '';

  loop:
  while (i < note.text.length) {

    // LaTeX (inline)
    latex_inline:
    if (note.text.startsWith('$$', i)) {
      const j = note.text.indexOf('$$', i + 2);
      if (j === -1) break latex_inline;
      html += note.text.slice(i, j + 2);
      i = j + 2;
      continue loop;
    }

    // LaTeX (block)
    latex_block:
    if (note.text.startsWith('$[', i)) {
      const j = note.text.indexOf(']$', i + 2);
      if (j === -1) break latex_block;
      html += note.text.slice(i, j + 2);
      i = j + 2;
      continue loop;
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
      };

      let j = i;
      while (!Object.keys(pairs).includes(note.text[j])) j++;
      const open = note.text[j];
      const close = pairs[open];

      const tag = note.text.slice(i + 1, j);

      const k = note.text.indexOf(close, j + 1);
      if (k === -1) break span;
      const content = note.text.slice(j + 1, k);

      html += (
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

async function main() {
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

main();
