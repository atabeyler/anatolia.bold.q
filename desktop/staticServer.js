import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// Serves the already-built client/dist SPA over plain HTTP on loopback
// instead of loading it via file://. This matters because the existing
// Vite build (client/vite.config.js) has no `base` override and emits
// root-relative asset URLs (/assets/...) — those resolve fine against an
// http://127.0.0.1 origin exactly like the deployed web app, but break
// under file:// where there is no root to be relative to. Using a local
// server here means the web build config never has to change to
// accommodate Electron.
export function serveStaticDir(rootDir, { port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(rootDir, urlPath);

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || (stats.isDirectory() && !fs.existsSync(path.join(filePath, 'index.html')))) {
        // SPA fallback: any unmatched route serves index.html, same as the
        // server's own catch-all (server/src/index.js) does for the web.
        filePath = path.join(rootDir, 'index.html');
      } else if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, url: `http://${host}:${address.port}` });
    });
  });
}
