const plib = require('path');
const child_process = require('child_process');

const { squire } = require('../../squire.js');
const { lazyAss, Cats, withTempDir, hash } = squire('../../util.js');
const fss = squire('../../fss.js');
const rand = squire('../../rand.js');

exports.default =
function * (floc, source, graph, env) {
  yield * parseTranscription(floc, source, graph, env);
}

const scriptSrc = fss.read(__filename).toString();

function * parseTranscription(floc, source, graph, env) {

  const { emitSensitiveInfo } = env.opts;

  rand.seed(0);  // make deterministic to prevent misleading diffs

  const fname = plib.basename(floc, plib.extname(floc));
  const journalNumber = parseInt(fname.split('-')[1], 10);

  const pages = [];

  for (const line of source.split('\n')) {

    const curPage = pages[pages.length - 1];

    // Command
    if (line.startsWith(':')) {

      const cmd = line.slice(':'.length, indexOf(line, ' '));
      const payload = line.slice((':' + cmd + ' ').length);

      if (cmd === 'page') {
        const newPage = {};
        newPage.range = payload.includes('-') ? payload.split('-') : [payload, payload];
        newPage.id = mkId(journalNumber, newPage.range);
        newPage.hash = hash(newPage.id, scriptSrc, source, emitSensitiveInfo);
        newPage.defines = [];
        newPage.references = new Set();
        newPage.journalInfo = { number: journalNumber };
        newPage.doEmitThisPage = emitSensitiveInfo;

        newPage.source = new Cats();

        if (curPage && iso(curPage.range[1], x => x + 1) !== newPage.range[0])
          throw Error(`Bad indexing ${curPage.range[1]} -> ${newPage.range[0]}`);

        pages.push(newPage);
      }

      else if (cmd === 'when') {
        curPage.when = payload;
      }

      else if (cmd === 'transcribed-when') {
        // pass
      }

      else if (cmd === 'public') {
        curPage.doEmitThisPage = true;
      }

      else {
        throw Error(`Unrecognized command: ${cmd}`);
      }

    // Content
    } else {
      if (!curPage) continue;
      curPage.source.add(line, '\n');
    }

  }

  for (const page of pages) {
    page.source = page.source.toString();
    const [_, hasAnyCensoring] = parseBody(page.source.toString().trim(), env);

    const doImages = (page.doEmitThisPage && !hasAnyCensoring) || emitSensitiveInfo;

    if (doImages) {
      page.images = [];
      for (
        let pg = page.range[0];
        parseInt(pg, 10) <= parseInt(page.range[1], 10);
        pg = iso(pg, x => x + 1)
      ) {
        const name = `j-${page.journalInfo.number}-p-${pg}.png`;
        const loc = plib.resolve(floc, '..', 'assets', name);
        page.images.push(loc);
      }
      page.assets = [...page.images];
    } else {
      page.images = [];
    }
  }

  for (const page of pages) {
    lazyAss(page, 'html', () => {
      env.log.info('Rendering ' + page.id);
      return mkHtml(page, graph, env);
    });

    yield page;
  }

}

function prettifyRange(range) {
  return range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`;
}

function mkId(journalNumber, range) {
  return `J${journalNumber}p${prettifyRange(range)}`;
}

function iso(num, f) {
  const len = num.length;
  const n = parseInt(num, 10);
  const fn = f(n);
  return ('' + fn).padStart(len, '0');
}

function isSameJournal(there, here) {
  return 'journalInfo' in there && there.journalInfo.number === here.journalInfo.number;
}

function mkHtml(page, graph, env) {

  const [html, _] = parseBody(page.source.toString().trim(), env);

  const emphasizeImages = html.trim().split('\n').length === 1;

  let prevNext = '';
  {
    const prevPage = graph.notes.find(n => isSameJournal(n, page) && iso(n.range[1], x => x + 1) === page.range[0]);
    const nextPage = graph.notes.find(n => isSameJournal(n, page) && n.range[0] === iso(page.range[1], x => x + 1));
    // ^ TODO: O(n) but ought to be O(1)
    prevNext = mk(prevPage, '&larr; prev') + ' &bull; ' + mk(nextPage, 'next &rarr;');

    function mk(n, text) {
      if (!n) return `<span style="opacity: 0.5">${text}</span>`;
      return `<a href="${n.href}">${text}</a>`;
    }
  }

  let images = '';
  images +='<div class="left">';
  {
    for (const imageLoc of page.images) {
      const href = graph.resolvedAssetHrefs[imageLoc];
      images += `<a href="${href}" target="_blank"><img class="page" src="${href}" /></a>`;
    }
  }
  images += '</div>';

  let whenHtml = '';
  {
    if (page.when)
      whenHtml = '<span style="font-family: monospace">' + escapeHtml(page.when) + '</span>\n\n';
  }

  return String.raw`

<html>
  <head>
    <meta charset="utf-8">
  </head>
  <body>

<main>

<div class="prelude">
  <p>Journal #${page.journalInfo.number} &bull; ${prettifyRange(page.range)}</p>
  <p class="prevnext">${prevNext}</p>
</div>

${page.doEmitThisPage ? String.raw`
<div class="leftright">
  ${images}
  <div class="right">${whenHtml}${html.toString()}</div>
</div>
` : '<center><p>This section has not been made public.</p></center>'}

</main>

<style>

@import url('https://fonts.googleapis.com/css2?family=Merriweather&display=swap');

* {
  box-sizing: border-box;
}

.prevnext a {
  color: inherit;
  text-decoration: none;
}

body {
  font-family: 'Merriweather', serif;
  font-size: 14px;
  margin-bottom: 25vh;
}


main {
  width: 100%;
}

.prelude {
  text-align: center;
  color: rgb(117, 19, 128);
  margin-bottom: 50px;
  border-bottom: 1px dotted rgba(117, 19, 128, .25);
}

.leftright {
  width: 100%;
  display: flex;
}

.leftright .left {
  flex: 0 0 ${emphasizeImages ? '65%' : '25%'};
  margin-right: 2em;
}

.leftright .right {
  white-space: pre-wrap;
}

.right {
  line-height: 1.5em;
}

.left {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  align-content: flex-start;
}

.left a {
  display: contents;
}

.page {
  width: 100%;
  margin-bottom: 2%;
  border: 1px solid rgb(200, 200, 200);
}

.interp, .interp::before, .interp::after {
  color: grey;
}
.interp::before { content: '['; }
.interp::after { content: ']'; }

</style>

  </body>
</html>

`;
}



// indexOf but on fail return str.length instead of -1
function indexOf(str, sub, from = 0) {
  let result = str.indexOf(sub, from);
  if (result === -1) result = str.length;
  return result;
}

function escapeHtml(s) {
  const htmlEscapes = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
  };

  return [...s].map(c => htmlEscapes[c] || c).join('');
}


function parseBody(body, env) {

  const { emitSensitiveInfo } = env.opts;

  body += '\n';

  let stack = [];
  const result = new Cats();

  let hasAnyCensoring = false;

  let i = 0;
  while (i < body.length) {

    if (i === 0 || body[i - 1] === '\n') {
      if (i !== 0) result.add('</div>');
      let indent = 0;
      while (body[i] === ' ') {
        indent++;
        i++;
      }
      result.add(`<div style="margin-left: ${indent}ch">`);
      if (indent !== 0) continue;
    }

    const isLiteral = stack.length > 0 && stack[stack.length - 1] === 'html';
    const isCensoring = stack.includes('#');

    if (body.startsWith('\\', i)) {
      result.add(body[i]);
      i += 2;
    }

    // TODO: this lets [html:raw html] leak out of [#:censors]
    else if (isLiteral && body[i] !== ']') {
      result.add(body[i]);
      i++;
    }

    else if (body.startsWith('[', i)) {
      i++;
      const cmd = body.slice(i, indexOf(body, ':', i));
      i += cmd.length;
      stack.push(cmd);
      if (body[i] !== ':') throw Error('Expected command');
      i++;

      if (['u', 'i', 'b'].includes(cmd)) {
        result.add(`<${cmd}>`);
      } else if (cmd === 'c') {  // comment
        result.add('<span class="interp">');
      } else if (cmd === 'html') {
        true;
      } else if (cmd === '#') {
        hasAnyCensoring = true;
      } else {
        throw Error(`Unrecognized command ${cmd}`);
      }
    }

    else if (body.startsWith(']', i)) {
      if (stack.length === 0) throw Error(`Unmached ']' near: ${body.slice(i - 10, i + 10)}`);
      const cmd = stack.pop();
      i++;
      if (['u', 'i', 'b'].includes(cmd)) {
        result.add(`</${cmd}>`);
      } else if (cmd === 'c') {
        result.add('</span>');
      } else if (cmd === 'html' || cmd === '#') {
        true;
      } else {
        throw Error(`Impossible: ${cmd}`);
      }
    }

    else if (isCensoring && !emitSensitiveInfo) {
      if (body[i] === '\n') {
        result.add('\n');
        i++;
      } else {
        const length = rand.random() < .3 ? 0 : (rand.random() < .5 ? 1 : 2);
        for (let _ = 0; _ < length; _++) {
          result.add('&#8203;<span style="background: black; color: black">X</span>&#8203;');
        }
        i++;
      }
    }

    else if (body.startsWith('--', i)) {
      result.add('&mdash;');
      i += 2;
    }

    else {
      result.add(escapeHtml(body[i]));
      i++;
    }

  }

  if (stack.length > 0)
    throw Error(`Nonempty stack after parse: ${stack}`);

  return [result.toString(), hasAnyCensoring];
}
