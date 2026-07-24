import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { config, isOriginAllowed } from './config.js';
import { PeerRegistry } from './peerRegistry.js';
import { attachConnection } from './signaling.js';
import { RateLimiter } from './rateLimit.js';

const registry = new PeerRegistry();
const connectionLimiter = new RateLimiter(config.rateLimitPerMinute);

const staticRoot = config.staticDir ? resolve(process.cwd(), config.staticDir) : null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const httpServer = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }

  if (!staticRoot) {
    res.writeHead(404).end('Not found');
    return;
  }

  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(staticRoot, safePath === '/' ? 'index.html' : safePath);

    let fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || fileStat.isDirectory()) {
      // Single-page app: unknown routes fall back to index.html.
      filePath = join(staticRoot, 'index.html');
      fileStat = await stat(filePath).catch(() => null);
      if (!fileStat) {
        res.writeHead(404).end('Not found');
        return;
      }
    }

    const body = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? 'application/octet-stream';
    // Vite fingerprints its JS/CSS assets, so those are safe to cache
    // forever; index.html itself must always be revalidated.
    const cacheControl = filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl }).end(body);
  } catch {
    res.writeHead(500).end('Internal error');
  }
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    socket.destroy();
    return;
  }

  const ip = clientIp(req);
  if (!connectionLimiter.allow(ip)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    attachConnection(ws, ip, registry);
  });
});

function clientIp(req: import('node:http').IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first) return first.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

httpServer.listen(config.port, () => {
  console.log(`Pear-to-Pear signaling/relay server listening on :${config.port}`);
  if (staticRoot) console.log(`Serving static client from ${staticRoot}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
