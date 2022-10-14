const { squire } = require('../../../squire.js');
const Rep = squire('../rep.js');
const { p_block, p_toplevel_markup, p_enclosed, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('../parsing.js');

exports.commands = {};

// tables
exports.commands.table = function(s) {

  const xi0 = s.i;

  p_whitespace(s);
  const opts = {};
  while (true) {
    const sb = s.clone();
    p_whitespace(sb);
    if (!/[\w-]/.test(sb.text[sb.i])) break;
    Object.assign(s, sb);

    const key = p_word(s);
    p_take(s, '=');
    const val = p_word(s);
    opts[key] = val;
  }

  let doHorizontalHeaders = false;
  let doVerticalHeaders = false;
  let doCentering = false;
  for (const [key, val] of Object.entries(opts)) {
    switch (key) {
      case 'headers':
        if (!'h v both no'.split(' ').includes(val))
          throw mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'headers'`);
        doHorizontalHeaders = 'h both'.split(' ').includes(val);
        doVerticalHeaders   = 'v both'.split(' ').includes(val);
        break;

      case 'center':
        doCentering = { 'yes': true, 'no': false }[val];
        if (doCentering === undefined)
          throw mkError(s.text, [xi0, s.i], `Invalid value '${val}' for option 'center'`);
        break;

      default:
        throw mkError(s.text, [xi0, s.i], `Unknown table option '${key}'`);
    }
  }

  const rows = [];
  while (true) {
    const ok = p_backtracking(s, s => {
      p_whitespace(s);
      return p_take(s, '|');
    });
    if (!ok) break;

    const row = [];
    while (true) {
      const cell = p_backtracking(s, s => {
        p_whitespace(s);
        const [body, kind] = p_enclosed(s, p_toplevel_markup);
        return body;
      });
      if (cell === null) break;
      row.push(cell);
    }
    rows.push(row);
  }

  p_backtracking(s, s => {
    p_spaces(s);
    p_take(s, '\n');
  });

  if (rows.length === 0)
    throw mkError(s.text, [xi0, s.i], "Empty table")

  let result = new Rep.Seq();
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
    result = new Rep.Seq('<center>', result, '</center>');

  return result;

}

exports.prelude = String.raw`

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
}
table.headers-horiz tr:first-child {
  border-bottom-width: 2px;
}
table.headers-vert td:first-child,
table.headers-vert th:first-child
{
  border-right-width: 2px;
}

</style>

`;
