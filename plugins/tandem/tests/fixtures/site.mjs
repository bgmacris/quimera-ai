// site.mjs — fixture site for tests/e2e.sh: the cases a capture must get right (POST→302 with Set-Cookie,
// JSON XHR, a link to a new tab). Usage: node tests/fixtures/site.mjs <port>
import { createServer } from 'node:http';
const port = +process.argv[2];
createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/submit') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      res.writeHead(302, { Location: `/done?saved=${new URLSearchParams(body).get('name')}`, 'Set-Cookie': 'sid=abc123; Path=/' });
      res.end();
    });
    return;
  }
  if (u.pathname === '/api') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"n":3}'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (u.pathname === '/') {
    res.end(`<h1>Home</h1><form method="post" action="/submit"><input name="name" placeholder="Name"><button>Save</button></form>
      <a href="/newtab" target="_blank">Open new tab</a><script>fetch('/api')</script>`);
  } else res.end(`<h1>${u.pathname}</h1>`);
}).listen(port, '127.0.0.1');
