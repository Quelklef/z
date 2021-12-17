const fs = require('fs');

function mktrie(strings) {
  const present = Symbol("present");
  const trie = {};

  for (const str of strings) {
    let root = trie;
    for (const c of str) {
      root[c] = root[c] || {};
      root = root[c];
    }
    root[present] = true;
  }

  return {

    longest_prefix_of(str) {
      let result = null;
      let root = trie;
      let path = '';
      for (const c of str) {
        if (root[present]) result = path;
        root = root[c];
        path += c;
        if (root === undefined) break;
        if (root[present]) result = path;
      }
      return result;
    }

  }
}

function normalize_word(word) {
  return word.toLowerCase();
}

function extract_tagged(text, open, close) {
  const result = new Set();
  let i = 0;
  while (true) {
    i = text.indexOf(open, i);
    if (i === -1) break;
    const j = text.indexOf(close, i);
    if (j === -1) break;

    const word = text.slice(i + open.length, j);
    result.add(normalize_word(word));
    i = j + close.length;
  }
  return result;
}

function compile(text, termsMap) {

  const terms = mktrie(Object.keys(termsMap));
  const text_lower = text.toLowerCase();

  const refs = new Set();

  let body = '';
  let i = 0;

  main:
  while (i < text.length) {

    // [!explicit reference!]
    if (text.slice(i, i + 2) === '[!') {
      const j = text.indexOf('!]', i);
      const note = text.slice(i + 2, j);
      body += `<a href="/${note}">${note}</a>`;
      i = j + 2;
      refs.add(note);
      continue main;
    }

    if (!'abcdefghijklmnopqrstuvwxyz'.includes(text[i - 1])) {
      const term = terms.longest_prefix_of(text_lower.slice(i));
      if (term && !'abcdefghijklmnopqrstuvwxyz'.includes(text[i + term.length])) {
        const word = text.slice(i, i + term.length);
        if (normalize_word(word) === term) {
          const src = termsMap[term][0];
          body += `<a href="/${src}.html">${word}</a>`;
          refs.add(src);
          i += word.length;
          continue main;
        }
      }
    }

    body += text[i];
    i++;
    continue main;

  }

  const html = `
<!DOCTYPE HTML>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css" integrity="sha384-R4558gYOUz8mP9YWpZJjofhk+zx0AS11p36HnD2ZKj/6JR5z27gSSULCNHIRReVs" crossorigin="anonymous">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.js" integrity="sha384-z1fJDqw8ZApjGO3/unPWUPsIymfsJmyrDVWC8Tv/a1HeOtGmkwNd/7xUS0Xcnvsx" crossorigin="anonymous"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/contrib/auto-render.min.js" integrity="sha384-+XBljXPPiv+OzfbB3cVmLHf4hdUFHlWNZN5spNQ7rmHTXpd7WvJum6fIACpNNfIR" crossorigin="anonymous"
    onload="renderMathInElement(document.body, { delimiters: [ { left: '$$', right: '$$', display: false } ] });"
  ></script>
</head>
<body>
<div style="font-size: 14px; white-space: pre-wrap; font-family: monospace; line-height: 1.1em; margin: 5vh 15vw;">
${body}
</div>
</body>
`;

  return { html, refs };
}

function main() {
  fs.rmSync('./out', { recursive: true, force: true });
  fs.mkdirSync('./out');
  const names = fs.readdirSync('./notes').map(fname => fname.slice(0, fname.length - '.z'.length));

  // map term -> Array(defining note names)
  let termsMap = {};
  for (const name of names) {
    const text = fs.readFileSync('./notes/' + name + '.z').toString();
    const terms = extract_tagged(text, '[:', ':]');
    for (const term of terms)
      termsMap[term] = [].concat(termsMap[term] || [], [name]);
  }

  // map name -> Set(referenced names)
  const refMap = {};
  for (const name of names) {
    const text = fs.readFileSync('./notes/' + name + '.z').toString();
    const { html, refs } = compile(text, termsMap);
    refMap[name] = refs;
    fs.writeFileSync('./out/' + name + '.html', html);
  }

  const refMap_inv = {};
  for (const k in refMap) {
    for (const v of refMap[k]) {
      refMap_inv[v] = [].concat(refMap_inv[v] || [], [k]);
    }
  }

  {
    const pop = name => ( refMap_inv[name] || [] ).length;

    const namesByPop = names;
    namesByPop.sort((a, b) => pop(b) - pop(a));

    let items = [];
    for (const name of namesByPop) {
      const text = fs.readFileSync('./notes/' + name + '.z').toString();
      const terms = extract_tagged(text, '[:', ':]');
      items.push(`<li><a href="/${name}.html">${name}</a> x${pop(name)} (${[...terms].join(' ')})</li>`);
    }
    const html = `
<!DOCTYPE HTML>
<body>
  ${items.join('\n')}
</body>
    `;
    fs.writeFileSync('./out/index.html', html);
  }
}

main();
