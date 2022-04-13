
require('js-fire')({

  __description__: 'ζ',

  c: () => {
    // Compile from ./notes to ./out
    require('./compile.js').main();
  },

  i: (serverPort = 8000, websocketPort = 8001) => {
    // Start an interactive session
    require('./interactive.js').main({ serverPort, websocketPort });
  },

});
