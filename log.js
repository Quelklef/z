const plib = require('path');

const clc = require('cli-color');

const { squire } = require('./squire.js');
const { hash, writeFile } = require('./util.js');
const fss = require('./fss.js');


// data Severity = Info | Success | Warn | Error | Debug
// type Payload = (String, Severity)
// type Handler = Payload -> IO ()


// Payload -> String
function generic(msg, sev) {
  const dict = {
    info:    [ 'info', clc.blue ],
    success: [ 'succ', clc.green ],
    warn:    [ 'WARN', clc.bold.yellow ],
    error:   [ 'ERR ', clc.bold.red ],
    debug:   [ 'DEBG', clc.bold.magenta ],
  };

  const [pre, color] = dict[sev];
  return color(pre) + ' ' + msg;
}


// :: Handler
exports.stdoutHandler =
function(msg, sev) {
  console.log(generic(msg, sev));
}


// :: forall f. Foldable f => (IORef (List Payload), f Severity) -> Handler
exports.writerHandler =
function(array, sevs) {
  return function(msg, sev) {
    if (sevs.includes(sev)) {
      array.push([msg, sev]);
    }
  }
}

// :: (List Payload, Handler) -> IO ()
exports.replayWith =
function(array, handler) {
  for (const args of array) {
    handler(...args);
  }
}


// :: (Handler, Handler) -> Handler
exports.addHandlers =
function(h1, h2) {
  return (msg, sev) => {
    h1(msg, sev);
    h2(msg, sev);
  };
}


// :: (Handler, String) -> Handler
exports.withPrefix =
function(handler, prefix) {
  return (msg, sev) => handler('[' + prefix + '] ' + msg, sev);
}


// :: Handler -> Logger
const Logger =
exports.Logger =
class Logger {

  constructor(handler) {
    this.handler = handler
  }

  info(msg) { this.handler(msg, 'info'); }
  success(msg) { this.handler(msg, 'success'); }
  warn(msg) { this.handler(msg, 'warn'); }
  error(msg) { this.handler(msg, 'error'); }
  debug(msg) { this.handler(msg, 'debug'); }

}

