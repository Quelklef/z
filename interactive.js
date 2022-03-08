const fs = require('fs');
const plib = require('path');

const chokidar = require('chokidar');
const keypress = require('keypress');
const StaticServer = require('static-server');

const { quire } = require('./quire.js');
const { mkEnv } = quire('./env.js');



const env = mkEnv({
  root: process.env.PWD,
  cacheRoot: plib.resolve(process.env.PWD, 'out', '.cache'),
});


const PORT = '8000';

const server = new StaticServer({
  rootPath: plib.resolve(process.env.PWD, 'out'),
  port: PORT,
  host: '0.0.0.0',
});

server.start();



const watcher = chokidar
  .watch(
    ['./notes', './*.js', './fmt/*.js'],
    { cwd: '.' },
  )
  .on('ready', () => {
    recompile();
    watcher.on('add', () => recompile())
    watcher.on('change', () => recompile());
    watcher.on('inlink', () => recompile());
    watcher.on('addDir', () => recompile());
    watcher.on('unlinkDir', () => recompile());
  });


async function recompile() {

  // Clear screen...
  for (let i = 0; i < 100; i++) process.stdout.write('\n');

  const { main } = quire('./compile.js');

  try {
    main();
  } catch (e) {
    console.error(e);
  }

  console.log(
    `\nListening at localhost:${PORT}`
    + '\nWatching for file changes or keypress...'
  );

  const nss = {};
  env.cache.getNamespaces()
    .sort((a, b) => a.localeCompare(b))
    .forEach((ns, i) => nss[i + 1] = ns);

  console.log(
    '[q]uit; clear cache: [a]ll'
    + Object.entries(nss).map(([i, ns]) => ` [${i}] ${ns}`).join('')
  );

  withUserInput(ch => {
    if (ch === 'q') {
      process.exit(0)
    }
    else if (ch === 'a') {
      env.cache.clear();
      recompile();
      return true;
    }
    else if (ch in nss) {
      env.cache.clearNamespace(nss[ch]);
      recompile();
      return true;
    }
  });

}


const handlers = [];
keypress(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('keypress', (ch, key) => {
  const handler = handlers[handlers.length - 1];
  if (handler)
    handler(ch, key);
});

function withUserInput(func) {
  handlers.push(ch => {
    const done = func(ch)
    if (done) handlers.pop();
    else console.log("Don't understand");
  });
}
