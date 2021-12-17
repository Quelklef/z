const fs = require('fs');

function normalize_word(word) {
  return [...word.toLowerCase()].filter(c => 'abcdefghijklmnopqrstuvwxyz'.includes(c)).join('');
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
  let body = '';

  let i = 0;
  while (i < text.length) {

    while (text[i] === ' ') {
      body += ' ';
      i++;
    }

    // [!explicit reference!]
    if (text.slice(i, i + 2) === '[!') {
      const j = text.indexOf('!]', i);
      const note = text.slice(i + 2, j);
      body += `<a href="/${note}">${note}</a>`;
      i = j + 2;
    }

    else {
      let j = text.indexOf(' ', i);
      j = j === -1 ? text.length : j;
      const word = text.slice(i, j);
      if ( (termsMap[word] || []).length === 1 ) {
        const [src] = termsMap[word];
        body += `<a href="/${src}.html">${word}</a>`;
      } else {
        body += word;
      }
      i = j;
    }

  }

  return `
<!DOCTYPE HTML>
<head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css" integrity="sha384-R4558gYOUz8mP9YWpZJjofhk+zx0AS11p36HnD2ZKj/6JR5z27gSSULCNHIRReVs" crossorigin="anonymous">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.js" integrity="sha384-z1fJDqw8ZApjGO3/unPWUPsIymfsJmyrDVWC8Tv/a1HeOtGmkwNd/7xUS0Xcnvsx" crossorigin="anonymous"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/contrib/auto-render.min.js" integrity="sha384-+XBljXPPiv+OzfbB3cVmLHf4hdUFHlWNZN5spNQ7rmHTXpd7WvJum6fIACpNNfIR" crossorigin="anonymous"
      onload="renderMathInElement(document.body, { delimiters: [ { left: '$$', right: '$$', display: false } ] });"
    ></script>
</head>
<body>
<div style="font-size: 14px; white-space: pre; font-family: monospace; line-height: 1.1em; margin: 5em 15em;">
${body}
</div>
</body>
`;
}

function main() {
  fs.rmSync('./out', { recursive: true, force: true });
  fs.mkdirSync('./out');
  const names = fs.readdirSync('./notes').map(fname => fname.slice(0, fname.length - '.z'.length));

  let termsMap = {};
  for (const name of names) {
    const text = fs.readFileSync('./notes/' + name + '.z').toString();
    const terms = extract_tagged(text, '[:', ':]');
    for (const term of terms)
      termsMap[term] = [].concat(termsMap[term] || [], [name]);
  }

  for (const name of names) {
    const text = fs.readFileSync('./notes/' + name + '.z').toString();
    fs.writeFileSync('./out/' + name + '.html', compile(text, termsMap));
  }
}

main();
