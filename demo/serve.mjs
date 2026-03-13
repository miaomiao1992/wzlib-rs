/**
 * Minimal static file server for the demo.
 * Serves from the project root so WASM files are accessible.
 *
 * Usage: node demo/serve.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const PORT = 8080;
const ROOT = resolve(import.meta.dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.wasm': 'application/wasm',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ts':   'application/javascript',
};

const server = createServer(async (req, res) => {
  let urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (urlPath === '/') {
    res.writeHead(302, { Location: '/demo/' });
    res.end();
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = resolve(ROOT, '.' + urlPath);

  // Basic security: prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found: ' + urlPath);
  }
});

server.listen(PORT, () => {
  console.log(`\n  wzlib-rs demo server`);
  console.log(`  http://localhost:${PORT}\n`);
});
