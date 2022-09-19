const plib = require('path');

const help = `HELP

  zeta
  zeta --help

    Show this help text

  zeta compile

    --src=<path>                 = Note source location
    --dest=<path>                = Compilation destination
    [--symlink]                  = Symlink assets instead of copying
    [--safe]                     = Emit marked-sensitive info

    [--interactive               = Start in interactive mode
      [--server-port=<port>]
      [--websocket-port=<port>] ]
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

    const symlinksOk = clargs.consumeFlag('--symlink');
    const emitSensitiveInfo = clargs.consumeFlag('--safe');

    const isInteractive = clargs.consumeFlag('--interactive');
    const serverPort = !isInteractive ? null : Number(clargs.consumeArg('--server-port', '8000'));
    const websocketPort = !isInteractive ? null : Number(clargs.consumeArg('--websocket-port', '8001'));

    clargs.done();

    const mainArgs = {
      sourcePath,
      destPath,
      websocketPort,
      symlinksOk,
      emitSensitiveInfo,
    };

    const interactiveArgs = {
      sourcePath,
      destPath,
      serverPort,
      websocketPort,
      mainArgs,
    };

    if (isInteractive) {
      require('./interactive.js').main(interactiveArgs);
    } else {
      require('./compile.js').main(mainArgs);
    }
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
