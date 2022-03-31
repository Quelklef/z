const plib = require('path');

const chokidar = require('chokidar');
const keypress = require('keypress');
const StaticServer = require('static-server');
const WebSocket = require('ws');

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


const clients = [];

const ws = new WebSocket.Server({ port: '8001' });

ws.on('connection', client => {
  clients.push(client);
  client.on('close', () => clients.splice(clients.indexOf(client), 1));
});

function notify() {
  for (const client of clients)
    client.send('reload');
}


async function recompile() {

  // Clear screen...
  for (let i = 0; i < 100; i++) process.stdout.write('\n');

  const { main } = quire('./compile.js');

  try {
    main();
  } catch (e) {
    console.error(e);
  }

  notify();

  console.log(
    `\nListening at localhost:${PORT}`
    + '\nWatching for file changes or keypress...'
  );

  const nss = {};
  env.cache.getNamespaces()
    .sort((a, b) => a.localeCompare(b))
    .forEach((ns, i) => nss[i + 1] = ns);

  console.log(
    '[q]uit; force [r]ecompile; clear cache: [a]ll'
    + Object.entries(nss).map(([i, ns]) => ` [${i}]${ns}`).join('')
  );

  withUserInput(ch => {
    if (ch === 'q') {
      process.exit(0)
    }
    else if (ch === 'r') {
      recompile();
      return true;
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


let handlers = [];
keypress(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('keypress', (ch, key) => {
  const handler = handlers[handlers.length - 1];
  if (handler)
    handler(ch, key);
});

function withUserInput(func) {
  const handler = ch => {
    const done = func(ch)
    if (done) handlers = handlers.flatMap(h => h === handler ? [] : [h]);
    else console.log("?");
  };
  handlers.push(handler);
}
