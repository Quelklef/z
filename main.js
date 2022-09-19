const plib = require('path');

const help = `HELP

  zeta
  zeta --help

    Show this help text

  zeta compile --src=<path> --dest=<path>

    Compile a directory of notes

  zeta interactive --src=<path> --dest=<path> [ --server-port=<port> ] [ --websocket-port=<port> ]

    Enter an interactive session with live updates
`

function main() {

  const clargs = Clargs.parse(process.argv);

  console.log(clargs);

  if (
    clargs.keys().length === 0
    || clargs.has('--help')
  ) {
    console.log(help);
  }

  else if (clargs.has('compile')) {
    clargs.consumeFlag('compile');
    const sourcePath = plib.resolve(process.env.PWD, clargs.consumeArg('--src'));
    const destPath = plib.resolve(process.env.PWD, clargs.consumeArg('--dest'));
    clargs.done();

    require('./compile.js').main({
      sourcePath,
      destPath,
    });
  }

  else if (clargs.has('interactive')) {
    clargs.consumeFlag('interactive');
    const sourcePath = plib.resolve(process.env.PWD, clargs.consumeArg('--src'));
    const destPath = plib.resolve(process.env.PWD, clargs.consumeArg('--dest'));
    const serverPort = Number(clargs.consumeArg('--server-port', '8000'));
    const websocketPort = Number(clargs.consumeArg('--websocket-port', '8001'));
    clargs.done();

    require('./interactive.js').main({
      sourcePath,
      destPath,
      serverPort,
      websocketPort,
    });
  }

  else {
    console.log(help);
  }
}

class Clargs {

  /*

  Parse an argument list akin to 'process.argv'

  Invokations must look like:

    my-app do-thing --this=that --ok

  This parses to the following mapping:

    {
      'do-thing': Clargs.set,
      '--this': 'that',
      '--ok': Clargs.set,
    }

  */
  static parse(args) {
    const clargs = new Clargs();

    args = args.slice(2);  // drop 'node program'
    for (const arg of args) {
      if (arg.includes('=')) {
        const [key, val] = splitFirst(arg, '=');
        clargs.mapping[key] = val;
      } else {
        clargs.mapping[arg] = Clargs.set;
      }
    }

    return clargs;

    function splitFirst(string, delim) {
      const [x, ...xs] = string.split(delim);
      return [x, xs.join(delim)];
    }
  }

  static set = Symbol('Clargs.set');

  constructor() {
    this.mapping = {};
  }

  /* Return a list of all keys */
  keys() {
    return Object.keys(this.mapping);
  }

  has(key) {
    return key in this.mapping;
  }

  /* Consume a key and expect it to be a non-flag */
  consumeArg(key, deflt = undefined) {
    const val = this.mapping[key];
    delete this.mapping[key];
    if (val === Clargs.set || (val === undefined && deflt === undefined))
      throw new Error(`Expected an argument for CLI parameter '${key}'`);
    return val ?? deflt;
  }

  /*

  Accepts a key and does the following:
    - If the key exists and is a flag, return true
    - If the key exists and is not a flag, error
    - If the key does not exist, return false

  */
  consumeFlag(key) {
    if (key in this.mapping) {
      const val = this.mapping[key];
      delete this.mapping[key];
      if (val === Clargs.set) {
        return true;
      } else {
        throw new Error(`Did not expect an argument for CLI parameter '${key}'`);
      }
    } else {
      return false;
    }
  }

  /* Error if any keys remain */
  done() {
    const keys = this.keys();
    if (keys.length > 0) {
      throw new Error(`Unexpected CLI arguments: ${keys.join(', ')}`);
    }
  }

}

main();
