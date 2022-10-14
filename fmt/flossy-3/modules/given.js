const { squire } = require('../../../squire.js');
const Rep = squire('../rep.js');
const { p_block, p_enclosed, p_toplevel_markup, p_take, p_takeTo, p_backtracking, p_spaces, p_whitespace, p_word, p_integer, ParseError, mkError } = squire('../parsing.js');

exports.commands = {};

exports.commands.Given = function(s) {

  const parseLines = (s, sentinel) => {
    s.GivenIndex ??= 1;
    s.Given_lineIdentToNumber ??= {};

    const lines = [];
    while (true) {
      p_whitespace(s);
      if (p_backtracking(s, s => p_take(s, sentinel))) break;

      let ident = p_backtracking(s, s => {
        const ident = p_word(s);
        p_take(s, ':');
        return ident;
      });
      ident ??= lines.length + '';

      p_whitespace(s);

      const isNb = p_backtracking(s, s => {
        p_take(s, 'nb');
        p_whitespace(s);
        return true;
      });

      // !!!! very fucking big hack
      const isBlock = s.text.slice(s.i, s.i + 10).includes('\\Given');

      const [body, _] = p_enclosed(s, p_toplevel_markup);
      p_whitespace(s);
      const by = p_backtracking(s, s => {
        p_take(s, 'by');
        p_whitespace(s);
        const parseRef = s => {
          if (!s.text.startsWith('@', s.i)) return '';
          p_take(s, '@');
          let toNum;
          if (s.text.startsWith('@', s.i)) {
            p_take(s, '@');
            toNum = s.GivenIndex - 1 + '';
          } else {
            const ident = p_word(s);
            toNum = s.Given_lineIdentToNumber[ident];
          }
          return new Rep.Seq(
            `<span class="given-by-ref" data-to="${toNum}">`,
            toNum + '',
            `</span>`,
          );
        };
        const sp = { ...s, extraParsers: [...s.extraParsers, parseRef] };
        const [by, _] = p_enclosed(sp, p_toplevel_markup);
        Object.assign(s, { ...sp, extraParsers: s.extraParsers });
        return by;
      });
      const number = s.GivenIndex;
      s.Given_lineIdentToNumber[ident] = number;
      const line = [number, ident, body, by, isNb, isBlock];
      lines.push(line);
      s.GivenIndex++;
    }
    return lines;
  };

  const given = parseLines(s, 'Then');
  const then = parseLines(s, ';');

  const renderLine = ([number, name, body, by, isNb, isBlock]) => (
    new Rep.Seq(
      `<span class="given-line" data-name="${number}">`,
        ...(!isBlock ? [
          `<span class="given-line-number ${isNb ? 'nb' : ''}">`,
          number + '',
          '</span>',
        ] : []),
        '<span class="given-line-body">',
        body,
        '</span>',
        '<span class="given-line-by">',
        (by ?? ''),
        '</span>',
      '</span>',
    )
  );

  return new Rep.Seq(
    '<div class="given">',
    ...given.map(renderLine),
    '<span class="given-rule"></span>',
    ...then.map(renderLine),
    '</div>'
  );
}

exports.prelude = String.raw`

<script>

document.addEventListener('DOMContentLoaded', () => {

  const $proofs = document.querySelectorAll('.given');

  for (const $proof of $proofs) {
    const state = new Set();

    const $lines = $proof.querySelectorAll('.given-line');
    const $refs = $proof.querySelectorAll('.given-by-ref');

    function rerender() {
      for (const $line of $lines) {
        const ident = $line.dataset.name;
        if (state.has(ident))
          $line.classList.add('highlight');
        else
          $line.classList.remove('highlight');
      }
    }

    for (const $ref of $refs) {
      const refTo = $ref.dataset.to;
      $ref.addEventListener('mouseover', () => {
        state.add(refTo);
        rerender();
      });
      $ref.addEventListener('mouseleave', () => {
        state.delete(refTo);
        rerender();
      });
    }
  }

});

</script>

<style>

.given {
  max-width: 80vw;

  display: flex;
  flex-direction: column;

  border: 4px solid rgb(0, 0, 0, 0.1);
  border-right: 0;
}

.given-rule {
  width: 100%;
  height: 0px;
  border-bottom: 1px dotted rgb(0, 0, 0, 0.5);
}

.given-line-number {
  margin-right: .3em;
  color: rgba(0, 0, 0, .35);
}
.given-line-number:after {
  content: ': ';
}

.given-line-number.nb {
  opacity: 0;
}

.given-line {
  display: flex;
  padding: .35em 0;
  padding-left: .65em;
}

.given-line.highlight {
  background-color: rgba(var(--color-dynamic-rgb), 0.1);
}

.given-line-body {
  flex: 1;
}

.given-by-ref:before { content: '['; }
.given-by-ref:after { content: ']'; }

.given-by-ref,
.given-by-ref:before,
.given-by-ref:after
{
  color: var(--color-dynamic);
  cursor: pointer;
}

.given-by-ref:hover,
.given-by-ref:hover:before,
.given-by-ref:hover:after
{
  background: black;
  color: white;
}

</style>

`;
