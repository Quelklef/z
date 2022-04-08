/*

fs wrapper

Simple and naive!

*/

const fs = require('fs');
const plib = require('path');


exports.fs = fs;


/* Write to a file, creating parent dirs if necessary */
exports.write =
function write(loc, content) {
  fs.mkdirSync(plib.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, content.toString());
}


/* Read a file */
exports.read =
function read(loc) {
  return fs.readFileSync(loc).toString();
}


/* List directory descendant paths */
exports.list =
function * list(dirloc, args) {
  args ||= {};
  args.type ||= 'both';
  args.recursive ||= false;

  const ls = fs.readdirSync(dirloc, { withFileTypes: true });
  for (const elem of ls) {
    const loc = plib.resolve(dirloc, elem.name);
    if (elem.isDirectory()) {
      if (args.type === 'd' || args.type === 'both')
        yield loc;
      if (args.recursive)
        yield * list(loc, args)
    } else {
      if (args.type === 'f' || args.type === 'both')
        yield loc;
    }
  }
}


/* Remove a file or directory */
exports.remove =
function remove(loc) {
  fs.rmSync(loc, { recursive: true });
}


/* Empty a directory */
exports.empty =
function empty(loc) {
  if (!fs.lstatSync(loc).isDirectory())
    throw Error('Does not point to a directory: ' + loc);
  fs.rmSync(loc, { recursive: true });
  fs.mkdirSync(loc);
}


/* Check if a file or directory exists */
exports.exists =
function exists(loc) {
  return fs.existsSync(loc);
}


/* Create a directory */
exports.mkdir =
function mkdir(loc) {
  return fs.mkdirSync(loc, { recursive: true });
}


/* Perform computation within a temporary directory */
exports.withTempDir =
function withTempDir(fun) {
  let path = '/tmp/z-';
  for (let i = 0; i < 20; i++)
    path += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];

  fs.mkdirSync(path);
  try {
    return fun(path);
  } finally {
    fs.rmSync(path, { recursive: true });
  }
}
