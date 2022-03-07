import chokidar from 'chokidar';
import keypress from 'keypress';
import fs from 'fs';
import * as plib from 'path';
import StaticServer from 'static-server';

import { importFresh } from './util.mjs';


const PORT = '8000';

if (!fs.existsSync(plib.resolve(process.env.PWD, 'out')))
  fs.mkdirSync(plib.resolve(process.env.PWD, 'out'));

const server = new StaticServer({
  rootPath: plib.resolve(process.env.PWD, 'out'),
  port: PORT,
  host: '0.0.0.0',
});

server.start();



const watcher = chokidar
  .watch(
    ['./notes', './*.mjs', './fmt/*.mjs'],
    { cwd: '.' },
  )
  .on('ready', () => {
    onEvent('ready', null);
    watcher.on('all', onEvent);
  });


async function onEvent(ev, path) {
  const descs = {
    'add': 'New file',
    'change': 'File modified',
    'unlink': 'File deleted',
    'addDir': 'New directory',
    'unlinkDir': 'Directory deleted',
  };

  if (ev !== 'ready' && !(ev in descs)) return;

  if (ev === 'ready')
    console.log('Initialized')
  else
    console.log(`${descs[ev]} at ${path}; recompiling!`);

  await recompile();
}

async function recompile() {
  // Clear screen...
  for (let i = 0; i < 100; i++) process.stdout.write('\n');

  // Import dynamically in case its source changes
  const { main } = await importFresh('./compile.mjs');

  try {
    await main();
  } catch (e) {
    console.error(e);
  }
  console.log(`\nListening at localhost:${PORT}\nWatching for file changes or keypress...`);
  keyhelp();
}

function keyhelp() {
  console.log(
    '[q]uit; clear cache: [a]ll'
    + Object.values(getCacheNamespaces()).map(ns => `, [${ns.index}] ${ns.name}`).join('')
  );
}


const cacheLoc = plib.resolve(process.env.PWD, 'out', '.cache');
function getCacheNamespaces() {
  const namespaces = (
    fs.readdirSync(cacheLoc, { withFileTypes: true })
    .flatMap(elem => elem.isDirectory() ? [elem.name] : [])
    .sort((n1, n2) => n1.localeCompare(n2))
    .map((name, i) => ({ name, index: i + 1, loc: plib.resolve(cacheLoc, name) }))
  );
  return Object.fromEntries(namespaces.map(ns => [ns.index, ns]));
}


keypress(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('keypress', async (ch, key) => {
  if (ch === 'q') {
    process.exit(0);
  }

  if (ch === 'a') {
    fs.rmSync(cacheLoc, { recursive: true });
    await recompile();
    return;
  }

  const nss = getCacheNamespaces();
  if (ch in nss) {
    const ns = nss[ch];
    fs.rmSync(ns.loc, { recursive: true });
    await recompile();
    return;
  }

  if (true) {
    console.log("\nDon't know what to do with that");
    keyhelp();
  }
});
