
const repm = require('../repm.js');
const p = require('../parse.js');

exports.commands = {};
exports.prelude = '';

// tables
exports.commands.table = function(s) {

  const xi0 = s.i;

  p.p_whitespace(s);
  const opts = {};
  while (true) {
    p.p_whitespace(s);
    if (!/[\w-]/.test(s.text[s.i])) break;

    const key = p.p_word(s);
    p.p_take(s, '=');
    const val = p.p_word(s);
    opts[key] = val;
  }

  let doHorizontalHeaders = false;
  let doVerticalHeaders = false;
  let doCentering = false;
  for (const [key, val] of Object.entries(opts)) {
    switch (key) {
      case 'headers':
        if (!'h v both no'.split(' ').includes(val))
          throw p.mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'headers'`);
        doHorizontalHeaders = 'h both'.split(' ').includes(val);
        doVerticalHeaders   = 'v both'.split(' ').includes(val);
        break;

      case 'center':
        doCentering = { 'yes': true, 'no': false }[val];
        if (doCentering === undefined)
          throw p.mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'center'`);
        break;

      default:
        throw p.mkError(s.text, [xi0, s.i], `Unknown table option '${key}'`);
    }
  }

  const rows = [];
  while (true) {
    const ok = p.p_backtracking(s, s => {
      p.p_whitespace(s);
      return p.p_take(s, '|');
    });
    if (!ok) break;

    const row = [];
    while (true) {
      const cell = p.p_backtracking(s, s => {
        p.p_whitespace(s);
        const [body, kind] = p.p_enclosed(s, p.p_toplevel_markup);
        return body;
      });
      if (cell === null) break;
      row.push(cell);
    }
    rows.push(row);
  }

  p.p_backtracking(s, s => {
    p.p_spaces(s);
    p.p_take(s, '\n');
  });

  if (rows.length === 0)
    throw p.mkError(s.text, [xi0, s.i], "Empty table")

  let result = new repm.Seq();
  const classes = [].concat(doHorizontalHeaders ? ['headers-horiz'] : [], doVerticalHeaders ? ['headers-vert'] : []);
  result.add(`<table class="${classes.join(' ')}">`);
  rows.forEach((row, rowI) => {
    result.add('<tr>');
    row.forEach((cell, cellI) => {
      const isHeader = doHorizontalHeaders && rowI === 0 || doVerticalHeaders && cellI === 0;
      const tag = isHeader ? 'th' : 'td';
      result.add(`<${tag}>`, cell, `</${tag}>`);
    });
    result.add('</tr>');
  });
  result.add('</table>');

  if (doCentering)
    result = new repm.Seq('<center>', result, '</center>');

  return result;

}

exports.prelude += String.raw`

<style>

table {
  border-collapse: collapse;
  font-size: 1em;
}

table, tr, th, td {
  border: 1px solid var(--color-static);
}

th, td {
  padding: .3em .6em;
  white-space: pre-wrap;  /* hmmm */
}

table.headers-horiz tr:first-child {
  border-bottom-width: 2px;
}

table.headers-vert td:first-child,
table.headers-vert th:first-child
{
  border-right-width: 2px;
}

td {
}

</style>

`;
