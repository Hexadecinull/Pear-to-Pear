# Self-Deployment Guide

This is the general-purpose guide to running your own Pear-to-Pear
instance, on any host, using either Docker or a plain Node.js install.
If you specifically want to deploy behind **Cloudflare Tunnel** with
step-by-step clicks in the Cloudflare dashboard, that's a narrower,
more opinionated walkthrough than what belongs in this repository —
this document instead covers the general shape that any hosting setup
follows, plus two ready-to-adapt reverse proxy examples (Caddy and
nginx) in [`deploy/`](../deploy/).

## What you need

- A machine (VPS, home server, container host — anything) that can run
  Node.js 20+ or Docker.
- A domain name, if you want this reachable over the public internet.
- A way to terminate TLS in front of it: a reverse proxy (Caddy, nginx,
  Cloudflare Tunnel, or similar). **Don't expose the Node process
  directly to the internet over plain HTTP** — WebSocket traffic
  carrying encryption keys and control messages should be wrapped in
  TLS (`wss://`) the same as any other sensitive traffic, and every
  example below assumes something in front of it handles that.

## Option A: Docker (recommended for most people)

The fastest path. This repository includes a multi-stage `Dockerfile`
that builds both the client and server into one slim runtime image, and
a `docker-compose.yml` to run it.

```bash
git clone https://github.com/Hexadecinull/Pear-to-Pear.git
cd Pear-to-Pear
cp server/.env.example .env   # optional — see below
docker compose up -d --build
```

By default this binds the app to `127.0.0.1:8787` on the host (see the
comment in `docker-compose.yml`) — it's deliberately **not** exposed
directly to the internet. Put a reverse proxy in front of it for TLS;
see "Reverse proxy / TLS" below.

To pass environment variables (see the full reference in
[`server/.env.example`](../server/.env.example)), either edit the
`environment:` block in `docker-compose.yml` directly, or point Compose
at an env file:

```yaml
services:
  pear-to-pear:
    build: .
    env_file: .env
    # ...
```

To update after pulling new changes:

```bash
git pull
docker compose up -d --build
```

## Option B: Plain Node.js (systemd)

For running directly on a host without Docker.

### 1. Build both halves

```bash
git clone https://github.com/Hexadecinull/Pear-to-Pear.git /opt/pear-to-pear
cd /opt/pear-to-pear

cd client
npm ci
npm run build          # outputs client/dist
cd ../server
npm ci
npm run build           # outputs server/dist
cp .env.example .env
```

Edit `/opt/pear-to-pear/server/.env` and set at minimum:

```bash
STATIC_DIR=../client/dist
ALLOWED_ORIGINS=https://your-domain.example
TRUST_PROXY=true
```

(`TRUST_PROXY=true` is correct as long as you're actually running behind
a reverse proxy that sets `X-Forwarded-For` — which every option in
this guide is. Don't set it to `true` if the Node process is somehow
reachable directly, or clients could spoof their own rate-limit
identity.)

### 2. Create a dedicated user (optional but recommended)

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin pear-to-pear
sudo chown -R pear-to-pear:pear-to-pear /opt/pear-to-pear
```

### 3. Install the systemd service

A ready-to-adapt unit file is at
[`deploy/pear-to-pear.service`](../deploy/pear-to-pear.service):

```bash
sudo cp deploy/pear-to-pear.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pear-to-pear
sudo systemctl status pear-to-pear
```

Check it's actually listening:

```bash
curl http://127.0.0.1:8787/healthz   # should print: ok
```

### Updating

```bash
cd /opt/pear-to-pear
git pull
cd client && npm ci && npm run build
cd ../server && npm ci && npm run build
sudo systemctl restart pear-to-pear
```

## Reverse proxy / TLS

Whichever option above you used, something needs to terminate TLS and
forward both normal HTTP requests and WebSocket upgrades to port 8787.
Two ready-to-adapt examples are in [`deploy/`](../deploy/):

- **[`deploy/Caddyfile.example`](../deploy/Caddyfile.example)** — Caddy
  auto-provisions a Let's Encrypt certificate and handles WebSocket
  upgrades with zero extra configuration. This is the simplest option if
  you don't already have a preferred proxy.
- **[`deploy/nginx.conf.example`](../deploy/nginx.conf.example)** — for
  nginx, which (unlike Caddy) needs the `Upgrade`/`Connection` headers
  forwarded explicitly, plus generous timeouts since a transfer can hold
  a connection open for a while.

If you'd rather use **Cloudflare Tunnel**, it fills the same role as
either of the above (TLS termination + forwarding to your local port)
without needing to open any inbound firewall port at all — you run
`cloudflared` on your host and point a "public hostname" at
`http://localhost:8787` in the Cloudflare dashboard. That's the whole
integration surface; Cloudflare Tunnel proxies the WebSocket upgrade
transparently once the hostname is configured.

## Environment variables

Full reference with defaults and explanations is in
[`server/.env.example`](../server/.env.example) — copy it to `.env` and
adjust. The ones most people will want to touch:

| Variable | What it controls |
|---|---|
| `PORT` | Which port the Node process listens on |
| `STATIC_DIR` | Where the built client lives (unset it if you're hosting the frontend separately) |
| `ALLOWED_ORIGINS` | Which origins may open a WebSocket connection — set this to your real domain in production |
| `TRUST_PROXY` | Whether to trust `X-Forwarded-For` for the client's real IP (yes, if you're behind any reverse proxy) |
| `MAX_FILES_PER_TRANSFER`, `MAX_TOTAL_BYTES` | The hard, server-enforced batch limits |
| `MAX_INFLIGHT_BYTES_PER_SESSION` | The relay's bounded-memory window per session — see [ARCHITECTURE.md](ARCHITECTURE.md#the-relay-bounded-memory-regardless-of-file-size) |
| `RATE_LIMIT_MAX_CONNECTIONS_PER_MINUTE` | Basic per-IP connection-spam protection |

The client also has a small set of **build-time** variables in
[`client/.env.example`](../client/.env.example) — these get baked into
the static JS at `npm run build` time, so you need to rebuild the
client after changing them, not just restart a server.

## Firewall / ports

Only one inbound port needs to be reachable: whatever your reverse
proxy listens on (typically 443 for HTTPS). The Node process itself
(port 8787 by default) should only be reachable from that proxy, not
from the public internet directly — the Docker Compose file and the
systemd + reverse-proxy setup above both already reflect this (bound to
`127.0.0.1`). If you're using Cloudflare Tunnel, you don't need to open
any inbound port at all — the tunnel makes an outbound-only connection
from your host to Cloudflare.

## Automatic deployment via GitHub Webhooks (optional)

If you'd rather not run `git pull` by hand every time you push a
change, this repository includes a small, optional auto-deploy setup in
[`deploy/webhook/`](../deploy/webhook/): GitHub sends a webhook on every
push, a tiny listener verifies it's genuinely from GitHub, and — only on
a push to your deploy branch — it triggers a script that pulls and
rebuilds for you.

**Why this is a separate process, not a route on the main server:** the
main app is designed to have as small an attack surface as possible
(see [SECURITY.md](SECURITY.md#dependency-footprint)) and, if you're
running it in Docker, it's isolated inside a container that has no
business reaching out to `git`/`docker` on the host. The webhook
listener runs on the host itself instead, with exactly the access it
needs to redeploy, and nothing more.

### 1. Generate a secret and configure the listener

```bash
cd /opt/pear-to-pear/deploy/webhook
openssl rand -hex 32   # copy this value
cp .env.example .env
nano .env
```

Set at minimum:

```
WEBHOOK_SECRET=<the value you just generated>
REPO_DIR=/opt/pear-to-pear
DEPLOY_MODE=docker        # or: systemd, if you're not using Docker
```

### 2. If you're using `DEPLOY_MODE=systemd`

The listener needs permission to restart the app service without a
password prompt (it runs unattended). A ready-to-adapt sudoers snippet
is at
[`deploy/webhook/sudoers-pear-to-pear-deploy.example`](../deploy/webhook/sudoers-pear-to-pear-deploy.example):

```bash
sudo cp deploy/webhook/sudoers-pear-to-pear-deploy.example /etc/sudoers.d/pear-to-pear-deploy
sudo chmod 440 /etc/sudoers.d/pear-to-pear-deploy
sudo visudo -c
```

If you're using `DEPLOY_MODE=docker` instead, the user running the
listener just needs to be in the `docker` group (see Option A's setup
above) — no sudoers changes needed.

### 3. Install the listener as a service

```bash
sudo cp deploy/webhook/pear-to-pear-webhook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pear-to-pear-webhook
sudo systemctl status pear-to-pear-webhook
```

### 4. Expose it to GitHub

GitHub needs to reach this listener's port over the internet. You do
**not** need a whole new subdomain for this — reuse the domain you
already have:

- **Cloudflare Tunnel:** in the same tunnel's **Public Hostname** tab,
  add another entry with the *same* hostname you already use, but set a
  **Path** (e.g. `webhook`) pointing at `http://localhost:9000` (or
  whatever `WEBHOOK_PORT` you set). Cloudflare matches the more specific
  path rule first, falling through to your main app for everything
  else. Your webhook URL is then
  `https://your-domain.example/webhook`.
- **Caddy/nginx:** add a second `location`/path block in your existing
  config, proxying that one path to `127.0.0.1:9000` instead of 8787.

### 5. Add the webhook on GitHub

Repository → **Settings → Webhooks → Add webhook**:

- **Payload URL:** the URL from step 4.
- **Content type:** `application/json`
- **Secret:** the same value you put in `WEBHOOK_SECRET`.
- **Which events:** "Just the push event."
- **Active:** checked.

Save it, and GitHub immediately sends a `ping` — the listener responds
`pong` to it and does *not* trigger a deploy (only real `push` events
do). Check the "Recent Deliveries" tab on the webhook's GitHub settings
page to confirm it got a `200`/`202` back.

From then on, every push to your configured branch triggers a pull +
rebuild + restart automatically. Watch it happen with:

```bash
sudo journalctl -u pear-to-pear-webhook -f
```

## A note on scaling horizontally

This server intentionally keeps all state — peer codes, bonded
sessions, in-flight relay bookkeeping — in a single process's memory
(see [ARCHITECTURE.md](ARCHITECTURE.md)), which is exactly what makes it
so simple to run. The tradeoff: **you can't run multiple replicas of the
server behind a plain load balancer** and expect two different people's
browsers to find each other, since a normal load balancer has no reason
to route two unrelated new connections to the same replica.

In practice, one modern server can comfortably handle a large number of
concurrent sessions — the whole point of the bounded-memory relay design
is that per-session cost is small and fixed, not proportional to file
size. Scale vertically (a bigger machine) long before you'd need to
think about this. If you do eventually need multiple replicas, that
requires adding a shared coordination layer (e.g. Redis pub/sub for
bonding + relay routing across processes), which is a real architecture
change beyond what this project takes on by default.

## Troubleshooting a deploy

**Client loads but never bonds / stays on "Connecting…"**
Almost always a reverse-proxy WebSocket issue. Confirm your proxy is
actually forwarding the `Upgrade` header (see the nginx example above if
you're not using Caddy) and that `ALLOWED_ORIGINS` in the server's `.env`
includes the exact origin (scheme + host) the client is served from.

**Behind Cloudflare (proxied DNS or Tunnel) specifically: the page loads
fine, but the WebSocket fails with something like
`NS_ERROR_WEBSOCKET_CONNECTION_REFUSED` (Firefox) or a generic
connection-refused error (other browsers)**
This is almost always one specific zone-level setting: **Cloudflare
dashboard → your zone → Network → WebSockets** must be turned **on**.
It's off by default on some accounts and isn't part of the normal
Tunnel setup flow, so it's easy to miss. If regular page loads work but
only the WebSocket fails, this is the first thing to check — before
assuming anything is wrong with the app or the tunnel itself. Also
double-check the DNS record for your hostname is **Proxied** (orange
cloud), not DNS-only, since Cloudflare Tunnel requires that.

**"429 Too Many Requests" while testing from your own machine**
You've hit `RATE_LIMIT_MAX_CONNECTIONS_PER_MINUTE` from rapid
reconnects during testing — this is expected abuse mitigation, not a
bug. Wait a minute, or raise the limit temporarily in `.env` while
developing.

**Direct P2P never connects, always falls back to Relayed**
This is expected on some networks (symmetric NAT, restrictive corporate
firewalls) and isn't a deploy problem — see
[ARCHITECTURE.md](ARCHITECTURE.md#why-not-turn). The relay fallback path
is fully functional and still end-to-end encrypted; if you want direct
connections to succeed more often, that requires infrastructure (a TURN
server) explicitly outside this project's scope, for the reasons
explained there.

**`healthz` works locally but the public domain doesn't load anything**
Check your reverse proxy's own logs first — this is almost always a
DNS or proxy configuration issue rather than anything in the Node
process itself.
