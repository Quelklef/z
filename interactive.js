const plib = require('path');

const chokidar = require('chokidar');
const keypress = require('keypress');
const StaticServer = require('static-server');
const WebSocket = require('ws');
const child_process = require('child_process');

const { squire } = require('./squire.js');
const { mkEnv } = squire('./env.js');
const fss = squire('./fss.js');

require('js-fire')(main);

function main(serverPort = 8000, websocketPort = 8001) {
  /* Start interactive mode */

  const env = mkEnv({
    root: process.env.PWD,
    cacheRoot: plib.resolve(process.env.PWD, 'out', '.cache'),
  });


  const server = new StaticServer({
    rootPath: plib.resolve(process.env.PWD, 'out'),
    port: serverPort,
    host: '0.0.0.0',
    followSymlink: true,  // assets are symlink'd
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

  const ws = new WebSocket.Server({ port: websocketPort });

  ws.on('connection', client => {
    clients.push(client);
    client.on('close', () => clients.splice(clients.indexOf(client), 1));
  });

  function notify() {
    for (const client of clients)
      client.send('reload');
  }



  const diffMode = {
    enabled: false,

    doDiff() {
      if (!fss.exists('./out-cmp')) return;

      fss.move({ source: './out/.cache', dest: './.cache-save-hack' });
      try {
        child_process.execSync(
          'git --no-pager diff --no-index ./out-cmp ./out --minimal --word-diff=color || true',
          { stdio: 'inherit' },
        );
      } finally {
        fss.move({ source: './.cache-save-hack', dest: './out/.cache' });
      }
    },

    commit() {
      if (fss.exists('./out-cmp')) fss.remove('./out-cmp');
      fss.copy({ source: './out', dest: './out-cmp' });
      fss.remove('./out-cmp/.cache');
    },

    delete() {
      if (fss.exists('./out-cmp'))
        fss.remove('./out-cmp');
    },

    get isEmpty() {
      return !fss.exists('./out-cmp');
    },
  }

  async function recompile() {

    // Clear screen...
    for (let i = 0; i < 100; i++) process.stdout.write('\n');

    const { main } = squire('./compile.js');

    let compileSuccess = false;
    try {
      main();
      compileSuccess = true;
    } catch (e) {
      console.error(e);
    }

    if (compileSuccess) {
      notify();

      if (diffMode.enabled) {
        console.log();
        if (diffMode.isEmpty) {
          console.log('WARN: DIFF MODE ON BUT CANNOT DIFF WITHOUT BASE COMMIT');
        } else {
          console.log('====== DIFF STRT ======');
          diffMode.doDiff();
          console.log('====== DIFF STOP ======');
        }
      }
    }

    const nss = {};
    env.cache.getNamespaces()
      .sort((a, b) => a.localeCompare(b))
      .forEach((ns, i) => nss[i + 1] = ns);

    console.log([
      '',
      `Listening at localhost:${serverPort}`,
      'Watching for file changes or keypress...',
      '',
      'quit: [q]; recompile: [r]',
      'caches: clear [a] all' + Object.entries(nss).map(([i, ns]) => `; [${i}] ${ns}`).join(''),
      'diffing: '
        + (diffMode.enabled ? 'ON' : 'OFF')
        + '; [d] toggle'
        + (diffMode.enabled ? '; [C] commit; [D] delete' : '')
    ].join('\n'));

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
      else if (ch === 'd') {
        diffMode.enabled = !diffMode.enabled;
        recompile();
        return true;
      }
      else if (ch === 'C') {
        console.log('Committing current state');
        diffMode.commit();
        recompile();
        return true;
      }
      else if (ch === 'D') {
        diffMode.delete();
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
