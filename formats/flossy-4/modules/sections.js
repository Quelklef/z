const hljs = require('highlight.js');

const repm = require('../repm.js');
const p = require('../parse.js');
const { Trie, indexOf, htmlEscapes, escapeHtml } = require('../util.js');

exports.commands = {};
exports.parsers = [];
exports.prelude = `
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather&display=swap">
`;
exports.stateInit = {
  sectionPath: [1],
  showSectionLabels: false,
};
exports.nonlocalStateKeys = [ 'sectionPath' ];


// \title
exports.commands.title =
function(s) {
  return titleOrSection(s, 'title');
}

// \sec
exports.commands.sec =
function(s) {
  return titleOrSection(s, 'section-header');
}

function titleOrSection(s, className) {
  p.p_whitespace(s);

  const path = s.sectionPath;

  let title;
  let result;
  if (title = p.p_backtracking(s, s => p.p_block(s, p.p_toplevel_markup))) {
    result = mkSec({ path, title, body: '', className, showLabels: s.showSectionLabels });
  } else {
    title = p.p_inline(s, p.p_toplevel_markup);
    p.p_whitespace(s);

    // Descend in path
    s.sectionPath = [...s.sectionPath, 1];

    const [body, _] =  p.p_enclosed(s, p.p_toplevel_markup);

    // Ascend in path
    s.sectionPath = s.sectionPath.slice(0, -1);

    result = mkSec({ path, title, body, className, showLabels: s.showSectionLabels });
  }

  // Increment last index
  s.sectionPath = [
    ...s.sectionPath.slice(0, -1),
    s.sectionPath[s.sectionPath.length - 1] + 1
  ];

  return result;
}

// \table-of-contents
exports.commands['table-of-contents'] =
function(s) {
  p.p_chompRestOfLine(s);
  return repm.mkSeq(mkToc(), '\n');
}


const isSec = Symbol('isSec');
function mkSec({ path, title, body, className, showLabels }) {
  return {

    [isSec]: true,
    _path: path,
    _title: title,
    _secId: 'sec-' + path.join('-'),

    children: [title, body],
    toHtml(aff) {
      return repm.mkSeq(
        repm.h('div')
          .a('class', className)
          .a('id', this._secId)
          .c(
            repm.h('span')
            .c(title)
            .c(
              showLabels
                ? repm.h('span').a('class', 'section-path').c(path.join('.'))
                : ''
            )
          ),
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

  // Build tree
  let tree = {};
  repm.traverse(rep, node => {
    if (node[isSec]) {
      let root = tree;
      for (const idx of node._path) {
        if (!(idx in root)) root[idx] = {};
        root = root[idx];
      }
      root.sec = node;
    }
  });

  // Render tree
  const rendered = renderTree(tree);
  function renderTree(tree) {
    const children = [];
    for (const k in tree) {
      if (!Number.isFinite(+k)) continue;
      const subtree = tree[k];
      children.push(
        repm.h('div')
          .s('margin-left', '2.5ch')
          .c(renderTree(subtree))
      );
    }

    return (
      repm.h('div')
        .a('class', 'toc')
        .c('↳&nbsp;')
        .c(
            tree.sec
            ?
              repm.h('a')
                .s('display', 'inline-block')
                .a('class', 'toc-link')
                .a('href', '#' + tree.sec._secId)
                .c(`(§${tree.sec._path.join('.')}) `)
                .c(tree.sec._title)
            : '<em>This page</em>'
        )
        .cs(...children)
    );
  }

  // Replace toc nodes with tree
  repm.traverse(rep, node => {
    if (node[isToc]) {
      node._rendered = (
        repm.h('div')
          .c(repm.h('h4').a('class', 'toc-title').c('Table of Contents'))
          .c(rendered)
      );
    }
  });

  return rep;

}

exports.prelude += String.raw`
<style>

.title {
  font-weight: bold;
  color: var(--color-static);
  margin-bottom: 1em;
}

.toc-link:not(:hover) {
  color: inherit;
}

.toc-title {
  margin: 0;
}

.section-header {
  font-weight: bold;
  color: var(--color-static);
  border-bottom: 1px dotted var(--color-static);
}

.title, .section-header {
  font-family: 'Merriweather', serif;
}
.title {
  font-size: 18px;
}
.section-header {
  font-size: 0.9em;
}

.section-path::before { content: '(§'; }
.section-path::after { content: ')'; }
.section-path {
  margin-left: 1em;
  opacity: 0.5;
}

hr {
  border: none;
  border-bottom: 1px dashed rgb(200, 200, 200);
}

</style>
`;
