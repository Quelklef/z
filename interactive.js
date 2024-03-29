const plib = require('path');

const chokidar = require('chokidar');
const keypress = require('keypress');
const StaticServer = require('static-server');
const WebSocket = require('ws');
const child_process = require('child_process');

const { mkCache } = require('./aff/cache.js');
const fss = require('./aff/fss.js');

exports.main =
function main({
  sourcePath,
  destPath,
  serverPort,
  websocketPort,
  mainArgs,
}) {

  const cache = mkCache({ fss }, plib.resolve(destPath, '.cache'));


  const server = new StaticServer({
    rootPath: destPath,
    port: serverPort,
    host: '0.0.0.0',
    followSymlink: true,  // assets are symlink'd
  });

  server.start();



  const watcher = chokidar
    .watch(
      [
        plib.resolve(sourcePath),
        plib.resolve(__dirname, '*.js'),
        plib.resolve(__dirname, 'formats/**/*.*'),
      ],
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

  const ws = new WebSocket.Server({ port: websocketPort });

  ws.on('connection', client => {
    clients.push(client);
    client.on('close', () => clients.splice(clients.indexOf(client), 1));
  });

  function notify() {
    for (const client of clients)
      client.send('reload');
  }


  let focusMode = true;
  async function recompile() {

    // Clear screen...
    for (let i = 0; i < 100; i++) process.stdout.write('\n');

    // Invalidate require cache
    for (const k in require.cache) delete require.cache[k];
    const { main } = require('./compile.js');

    let modifiedMainArgs;
    if (!focusMode) {
      modifiedMainArgs = mainArgs;
    } else {
      modifiedMainArgs = {
        ...mainArgs,
        ignoreCache: true,
        reducePaths: function(paths) {
          // consider only most recently modified path
          const thePath = Array.from(paths).sort((p1, p2) =>
                       (+new Date(fss.fs.statSync(p2).mtime))
                     - (+new Date(fss.fs.statSync(p1).mtime)) )[0];
          return [thePath];
        }
      }
    }

    let compileSuccess = false;
    try {
      main(modifiedMainArgs);
      compileSuccess = true;
    } catch (e) {
      console.error(e);
    }

    if (compileSuccess) {
      notify();
    }

    const nss = {};
    cache.getNamespaces()
      .sort((a, b) => a.localeCompare(b))
      .forEach((ns, i) => nss[i + 1] = ns);

    console.log([
      '',
      `Listening at localhost:${serverPort}`,
      'Watching for file changes or keypress...',
      '',
      'quit: [q]; recompile: [r]',
      '[f]ocus mode (recompile only most recently-edited note): ' + (focusMode ? 'ON' : 'OFF'),
      'caches: clear [a] all' + Object.entries(nss).map(([i, ns]) => `; [${i}] ${ns}`).join(''),
    ].join('\n'));

    withUserInput(ch => {
      if (ch === 'q') {
        process.exit(0)
      }
      else if (ch === 'f') {
        focusMode = !focusMode;
        recompile();
        return true;
      }
      else if (ch === 'r') {
        recompile();
        return true;
      }
      else if (ch === 'a') {
        cache.clear();
        recompile();
        return true;
      }
      else if (ch in nss) {
        cache.clearNamespace(nss[ch]);
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

}
