#!/usr/bin/env node
/**
 * A minimal, dependency-free GitHub webhook receiver whose only job is:
 * verify the request really came from GitHub, check it's a push to the
 * configured branch, and if so, kick off deploy.sh and get out of the
 * way.
 *
 * This deliberately runs as its own process, separate from the main
 * Pear-to-Pear server, see docs/DEPLOY.md, "Automatic deployment via
 * GitHub Webhooks", for why. In short: if the app runs in Docker,
 * something has to live *outside* that container to rebuild and restart
 * it, and keeping deploy-triggering code out of the internet-facing
 * relay process is a smaller attack surface than folding it in.
 *
 * Required environment variables:
 *   WEBHOOK_SECRET      shared secret configured on the GitHub webhook
 * Optional:
 *   WEBHOOK_PORT        default 9000
 *   WEBHOOK_BRANCH_REF  default 'refs/heads/master'
 *   DEPLOY_SCRIPT        default './deploy.sh' next to this file
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.WEBHOOK_PORT ?? 9000);
const SECRET = process.env.WEBHOOK_SECRET;
const BRANCH_REF = process.env.WEBHOOK_BRANCH_REF ?? 'refs/heads/master';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT ?? join(__dirname, 'deploy.sh');

if (!SECRET) {
  console.error(
    '[webhook] WEBHOOK_SECRET is not set, refusing to start. ' +
      'Generate one with `openssl rand -hex 32` and see docs/DEPLOY.md.',
  );
  process.exit(1);
}

function verifySignature(rawBody, header) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  const provided = header.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Constant-time comparison: a naive `===` here would leak timing
  // information an attacker could use to forge a valid signature byte
  // by byte.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function runDeploy() {
  console.log(`[webhook] verified push to ${BRANCH_REF}, starting deploy: ${DEPLOY_SCRIPT}`);
  const child = spawn('/usr/bin/env', ['bash', DEPLOY_SCRIPT], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[deploy] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[deploy:err] ${chunk}`);
  });
  child.on('error', (err) => {
    console.error(`[webhook] failed to start deploy script: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    if (code === 0) {
      console.log('[webhook] deploy finished successfully');
    } else {
      console.error(`[webhook] deploy FAILED (exit code ${code}, signal ${signal})`);
    }
  });

  // Detached (not the same as unlogged): if DEPLOY_SCRIPT restarts a
  // container or service this listener itself depends on, the child
  // must survive independently of this process's own lifecycle. unref()
  // only affects whether the child keeps the parent's event loop alive;
  // the listeners above still fire normally for as long as this
  // long-running service process stays up, which is always.
  child.unref();
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain' }).end('Method not allowed');
    return;
  }

  const chunks = [];
  let size = 0;
  const MAX_BODY_BYTES = 5 * 1024 * 1024; // GitHub push payloads are small; 5MB is generous

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { 'content-type': 'text/plain' }).end('Payload too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (res.writableEnded) return;
    const rawBody = Buffer.concat(chunks);

    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifySignature(rawBody, signature)) {
      console.warn('[webhook] rejected request with invalid or missing signature');
      res.writeHead(401, { 'content-type': 'text/plain' }).end('Invalid signature');
      return;
    }

    const eventHeader = req.headers['x-github-event'];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (event === 'ping') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('pong');
      return;
    }
    if (event !== 'push') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`ignored: event was ${event}`);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Malformed JSON');
      return;
    }

    if (payload.ref !== BRANCH_REF) {
      res
        .writeHead(200, { 'content-type': 'text/plain' })
        .end(`ignored: ${payload.ref} is not ${BRANCH_REF}`);
      return;
    }

    runDeploy();
    res.writeHead(202, { 'content-type': 'text/plain' }).end('Deploy triggered');
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] listening on :${PORT}, deploying on push to ${BRANCH_REF}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
