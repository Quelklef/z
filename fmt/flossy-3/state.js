const util = require('./util.js');

// Parser state module

/*

Parsing is a little funky. We keep track of three kinds of state:

1 Mutable state
  This is state shared between all parts of the parser
  Here we keep track of things like the file pointer
  Think StateT

2 Immutable state
  This is like mutable state, but may only be locally modified
  Here we keep track of things like the indentation stack
  Think ReaderT

3 Quasi state
  This is not 'really' state, because parsers are expected to
    not modify it at all
  The reason it's treated as state is that it is still *computed*;
    namely, it is computed from imported modules
  Here we keep track of things like how to clone the mutable state
  Think compile-time parameter


Semantically a parser is a function with signature

  r = parser(ms, is, qs, ...args)

where

  ms is the mutable state
  is is the immutable state
  qs is the quasi state

and parser:

  may modify the mutable state but not the local- or quasi- state
  may throw ParseError to signal failure

For convenience, we wrap up the states into one value

  s = { ...ms, ...is, _sm: qs }

and pass that around instead

------------

type State ≅
  { text :: String
  , i :: Int
  , cursyms :: Map String Int
  , _sm ::
    { StateT :: Array String
    , ...
    }
  , ...
  }

*/

// Generate a fresh symbol under a given namespace
exports.gensym = function(s, namespace = '') {
  if (!(namespace in s.cursyms)) s.cursyms[namespace] = 0;
  const sym = s.cursyms[namespace]++
  return 'gensym-' + (namespace ? (namespace + '-') : '') + sym;
};

// Clone the parser state
// This implementation makes sense only because we mandate that
// the quasi-state not be modified during parsing
const clone =
exports.clone = function(s) {
  const sm = s._sm;
  s._sm = null;
  const r = util.clone(s);
  r._sm = s._sm = sm;
  return r;
};

// Parse with a local state modification
const local =
exports.local = function(s, inner) {
  const sc = clone(s);
  const res = inner(sc);
  for (const key of s._sm.StateT)
    s[key] = sc[key];
  return res;
};
