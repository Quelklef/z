const fs = require('fs');
const http = require('http');

const server = http.createServer((req, res) => {

  if (req.url === '/api/list') {
    const fnames = [...fs.readdirSync('./notes')];
    const ids = fnames.map(fname => fname.slice(0, fname.length - '.z'.length));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ids));
  }

  else if (req.url.startsWith('/api/get/')) {
    const id = req.url.slice('/api/get/'.length);

    let data = null;
    try {
      data = fs.readFileSync(`./notes/${id}.z`);
    } catch (e) { }

    if (data !== null) {
      res.writeHead(200);
      res.end(data);
    } else {
      res.writeHead(404);
      res.end();
    }
  }

  else if (req.url.includes('..')) {
    res.writeHead(401);
    res.end();
  }

  else {

    const url = req.url === '/' ? '/index.html' : req.url;

    let data = null;
    try {
      data = fs.readFileSync('./app' + url);
    } catch (e) { }

    if (data !== null) {
      if (url.endsWith('.js') || url.endsWith('.mjs'))
        res.setHeader('Content-Type', 'text/javascript');
      res.writeHead(200);
      res.end(data);
    } else {
      res.writeHead(404);
      res.end();
    }

  }

});

server.listen(parseInt(process.env.Z_PORT) || 8000);
