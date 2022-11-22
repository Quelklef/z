const { squire } = require('../../../squire.js');
const repm = require('../repm.js');
const p = require('../parse.js');

exports.commands = {};
exports.prelude = '';

exports.commands.columns = function(s) {

  p.p_whitespace(s);
  const arity = p.p_integer(s);
  p.p_whitespace(s);

  const cols = [];
  for (let _ = 0; _ < arity; _++) {
    p.p_spaces(s);
    const [inner, _] = p.p_enclosed(s, p.p_toplevel_markup);
    cols.push(inner);
  }


  return repm.mkSeq(
    `<div class="columns-columns">`,
    ...cols.flatMap(col => [
      `<div class="columns-column">`,
      col,
      `</div>`,
    ]),
    `</div>`,
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
</stlye>

`;
