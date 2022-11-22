const hljs = require('highlight.js');


const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = '';


// \title
exports.commands.title =
function(s) {
  p.p_whitespace(s);
  const title = p.p_inline(s, p.p_toplevel_markup);
  p.p_whitespace(s);
  const [body, _] = p.p_enclosed(s, p.p_toplevel_markup);
  return mkSec({ title, body, className: 'title' });
}

// \sec
exports.commands.sec =
function(s) {
  p.p_whitespace(s);
  const title = p.p_inline(s, p.p_toplevel_markup);
  p.p_whitespace(s);
  const [body, _] = p.p_enclosed(s, p.p_toplevel_markup);
  return mkSec({ title, body, className: 'section-header' });
}

// \table-of-contents
exports.commands['table-of-contents'] =
function(s) {
  p.p_chompRestOfLine(s);
  return repm.mkSeq(mkToc(), '\n');
}


const isSec = Symbol('isSec');
function mkSec({ title, body, className }) {
  return {

    [isSec]: true,
    _title: title,
    _body: body,
    _secId: null,

    children: [title, body],
    toHtml(aff) {
      console.log(this._secId);
      return repm.mkSeq(
        repm.h('div')
          .a('class', className)
          .a('id', 'sec-' + this._secId)
          .c(title),
        body,
      ).toHtml(aff);
    },

  };
}

const isToc = Symbol('isToc');
function mkToc() {
  return {

    [isToc]: true,
    _rendered: null,

    children: [],
    toHtml(aff) {
      if (!this._rendered)
        return '<em>The table of contents should show here. If you are seeing this, something is wrong.</em>';
      return this._rendered.toHtml(aff);

    }

  };
}

exports.renderToc =
function(rep) {

  const secsTree = mkTree(rep);

  repm.traverse(rep, node => {
    if (node[isToc]) {
      node._rendered = (
        repm.h('div')
          .c(repm.h('h4').c('Table of Contents (WIP)'))
          .c(renderTree(secsTree))
      );
    }
  });

  return rep;

  function mkTree(rep) {
    let counter = 0;
    const tree = {};
    go(rep, tree);
    return tree;

    function go(node, tree) {
      if (typeof node === 'string') {
        return;
      }
      else if (node[isSec]) {
        const secId = (counter++) + '';
        rep._secId = secId;
        const subTree = {};
        subTree._rose = node._title;
        tree[secId] = subTree;
        go(node._body, subTree);
      }
      else {
        for (const ch of node.children) {
          go(ch, tree);
        }
      }
    }
  }

  function renderTree(tree) {
    const el = (
      repm.h('div')
        .a('class', 'toc')
        .c('↳&nbsp;')
        .c(tree._rose ?? '<em>This page</em>')
    );

    for (const [k, v] of Object.entries(tree)) {
      if (k !== '_rose') {
        el.c(
          repm.h('div')
            .s('margin-left', '2.5ch')
            .c(renderTree(v))
        );
      }
    }

    return el;
  }

}

exports.prelude += String.raw`
<style>

.title {
  font-weight: bold;
  color: var(--color-static);
  font-size: 18px;
  margin-bottom: 1em;
}

.section-header {
  font-weight: bold;
  color: var(--color-static);
  border-bottom: 1px dotted var(--color-static);
}

hr {
  border: none;
  border-bottom: 1px dashed rgb(200, 200, 200);
}

</style>
`;
