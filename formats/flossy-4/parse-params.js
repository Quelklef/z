const p = require('./parse.js');

exports.p_kvParams =
function(s, spec) {
  const result = {};

  const idxBeforeParams = s.i;

  while (true) {
    p.p_whitespace(s);

    const idxAtKey = s.i;
    const key = p.p_backtracking(s, p_key);
    if (!key) break;

    p.p_take(s, '=');

    const parser = spec[key];
    if (!parser) {
      throw p.mkError(
        s.text,
        idxAtKey,
        (
          `Unknown parameter name '${key}'. Expected one of the following: `
          + Object.keys(spec).map(k => "'" + k + "'").join(', ')
        )
      );
    }

    const val = p_exprOr(s, parser);
    result[key] = val;
  }

  // Spoof unsupplied keys as empty string
  for (const [expectedKey, parser] of Object.entries(spec)) {
    const wasEncountered = Object.keys(result).includes(expectedKey);
    if (!wasEncountered) {
      const sc = p.clone(s);
      sc.text = '';
      sc.i = 0;
      try {
        result[expectedKey] = parser(sc);
      } catch (e) {
        if (e instanceof p.ParseError) {
          throw p.mkError(s.text, idxBeforeParams, `Missing required key '${expectedKey}'`);
        } else {
          throw e;
        }
      }
    }
  }

  return result;
}

// Parse an arg key
const p_key =
function(s) {
  const name = p.p_takeWhileRegexNonempty(s, /[\w-_]/, 'Expected parameter name');
  return name;
}

// Parse according to the given parser, *or* as a JS expression wrapped in (( ))
function p_exprOr(s, parser) {
  if (s.text.startsWith('((', s.i)) {
    p.p_take(s, '((');
    const jsExpr = p.p_takeTo(s, '))');
    p.p_take(s, '))');
    return eval(jsExpr);
  } else {
    return parser(s);
  }
}


// Make an arg_ parser optional
//
// p_arg_optionally(p_arg_integer)
// p_arg_optionally(p_arg_integer, { default: 100 })
exports.p_arg_optionally =
function(parser, opts) {
  const defaultTo = opts?.default ?? null;
  return s => {
    try {
      return parser(s);
    } catch (e) {
      if (e instanceof p.ParseError) {
        return defaultTo;
      } else {
        throw e;
      }
    }
  };
}


exports.p_arg_bool =
function(s) {

  const word = p.p_takeWhileRegexNonempty(s, /[\w-]/, 'Expected boolean parameter');

  const names = {
    'true': true,
    yes: true,
    y: true,

    'false': false,
    no: false,
    n: false,
  };

  if (word in names)
    return names[word];
  else
    throw p.mkError(s.text, [i0, s.i], `'${word}' is not a valid boolean parameter`);
}


exports.p_arg_integer =
function(s) {
  const numeral = p.p_takeWhileRegexNonempty(s, /[1-9]/, 'Expected integer parameter');
  return +numeral;
}


exports.p_arg_string =
function(s) {
  if (s.text.startsWith('<', s.i)) {
    s.i++;

    let text = '';

    while (true) {
      if (s.i >= s.text.length) {
        break;
      } else if (s.text.startsWith('\\\\', s.i)) {
        text += '\\';
        s.i += 2;
      } else if (s.text.startsWith('\\>', s.i)) {
        text += '>';
        s.i += 2;
      } else if (s.text.startsWith('>', s.i)) {
        break;
      } else {
        text += s.text[s.i];
        s.i++;
      }
    }

    p.p_take(s, '>');
    return text;
  }

  else {
    return p.p_takeWhileRegexNonempty(s, /[\w-_]/, 'Expected simple string');
  }
}
