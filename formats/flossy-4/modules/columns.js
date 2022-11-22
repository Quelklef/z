const repm = require('../repm.js');
const p = require('../parse.js');
const ppar = require('../parse-params.js');

exports.commands = {};
exports.prelude = '';

exports.commands.columns = function(s) {

  const params = ppar.p_kvParams(s, {
    count: ppar.p_arg_integer,
  });

  const cols = [];
  for (let _ = 0; _ < params.count; _++) {
    p.p_spaces(s);
    const [inner, _] = p.p_enclosed(s, p.p_toplevel_markup);
    cols.push(inner);
  }


  return (
    repm.h('div')
      .a('class', 'columns-columns')
      .cs(...cols.flatMap(col =>
              repm.h('div').a('class', 'columns-column').c(col)
      ))
  );

}

exports.prelude += String.raw`

<style>

.columns-columns {
  display: flex;
  gap: 1em;
}

.columns-column {
  flex: 1;
}

</style>

`;
