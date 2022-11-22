
const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

exports.commands = {};
exports.prelude = '';

// tables
exports.commands.table = function(s) {

  const params = ppar.p_kvParams(s, {
    vheaders: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
    hheaders: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
    centering: ppar.p_arg_optionally(ppar.p_arg_bool, { default: false }),
  });

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
    throw p.mkError(s.text, s.i, "Empty table")

  let result = repm.mkSeq();
  const classes = [].concat(params.hheaders ? ['headers-horiz'] : [], params.vheaders ? ['headers-vert'] : []);
  result = result.and(`<table class="${classes.join(' ')}">`);
  rows.forEach((row, rowI) => {
    result = result.and('<tr>');
    row.forEach((cell, cellI) => {
      const isHeader = params.hheaders && rowI === 0 || params.vheaders && cellI === 0;
      const tag = isHeader ? 'th' : 'td';
      result = result.and(`<${tag}>`, cell, `</${tag}>`);
    });
    result = result.and('</tr>');
  });
  result = result.and('</table>');

  if (params.centering)
    result = repm.mkSeq('<center>', result, '</center>');

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
