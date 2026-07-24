# Pear-to-Pear

Send files directly to another browser \u2014 no accounts, no cloud storage,
no size-gouging, no ads. Two people, a pair of 64-character codes, and an
end-to-end encrypted connection between them.

```
   YOU                                    PEER
 ┌─────────────┐                     ┌─────────────┐
 │ your code   │╌╌╌╌╌ bond ╌╌╌╌╌╌╌╌╌╌│ their code  │
 └─────────────┘                     └─────────────┘
        │                                    │
        └──────── encrypted transfer ────────┘
          (direct when possible, streamed
           through the relay when it isn't)
```

## What it does

- **One page, one action.** Load the site and you get a fresh 64-character
  code. Give it to someone (or paste theirs in) and you're bonded.
- **Send up to 500 files, 10 GB total, per batch.** No folders \u2014 drop
  individual files. Send another batch right after if you need to.
- **End-to-end encrypted.** Every file chunk is encrypted in your browser
  with a key your peer's browser derives independently. The server never
  sees a key, a filename, or a byte of plaintext \u2014 see
  [docs/SECURITY.md](docs/SECURITY.md).
- **Real peer-to-peer when your networks allow it.** The app tries a
  direct WebRTC connection first, so in the best case your files never
  touch the server at all. When a direct route isn't possible, it falls
  back to a streaming relay that never buffers more than a small, fixed
  window of a transfer \u2014 see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Nothing stored.** No database, no file ever touches a disk on the
  server, no accounts, no logs of who sent what to whom \u2014 see
  [docs/PRIVACY.md](docs/PRIVACY.md).
- **Free and open source**, licensed [GPL-3.0](LICENSE). Run the public
  instance or self-host your own \u2014 see [docs/DEPLOY.md](docs/DEPLOY.md).

## How it works, in short

1. Load the page. The server hands you a random 64-character code and
   holds a WebSocket connection open for you.
2. Give your code to someone, or type in theirs. Whoever's code gets
   entered by the other person, both sides get notified they're bonded.
3. Both browsers generate a one-time encryption keypair, swap public keys
   through the server (which never sees the private halves), and attempt
   a direct WebRTC connection.
4. Pick files, hit Send. Your peer sees an incoming-transfer prompt and
   hits Receive. Bytes start flowing \u2014 encrypted, chunked, and either
   straight between your browsers or streamed through the relay.
5. Refresh the page, close the tab, or lose your connection, and the bond
   is gone. Nothing persisted; nothing to clean up.

For the full technical picture \u2014 the wire protocol, the encryption
scheme, why chunking and backpressure exist, and the deliberate tradeoffs
\u2014 read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
pear-to-pear/
├── client/     Svelte + TypeScript + Vite single-page frontend
├── server/     Node.js + TypeScript signaling & relay server
└── docs/       Everything below
```

## Quickstart (local development)

Requires Node.js 20 or newer.

```bash
# terminal 1 — signaling/relay server
cd server
npm install
cp .env.example .env
npm run dev            # http://localhost:8787

# terminal 2 — frontend
cd client
npm install
cp .env.example .env    # point VITE_SIGNALING_URL at the server above
npm run dev              # http://localhost:5173
```

Open two browser windows (or a normal window plus a private one) at
`http://localhost:5173` to try bonding two "peers" against yourself.

## Building for production

```bash
cd client && npm install && npm run build   # outputs client/dist
cd ../server && npm install && npm run build # outputs server/dist
cd server && STATIC_DIR=../client/dist npm start
```

(Or, as a shortcut from the repo root: `npm run install:all && npm run build`.)

The server can serve the built client itself (as above) or you can host
the static `client/dist` output separately (a CDN, static hosting, etc.)
and point it at the signaling server via `VITE_SIGNALING_URL`. Full,
detailed self-hosting instructions \u2014 including Docker, systemd, and
reverse-proxy configuration \u2014 are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Documentation

| Document | Covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system works end to end: protocol, encryption, relay design, limits |
| [docs/USAGE.md](docs/USAGE.md) | How to actually use the app, feature by feature, plus troubleshooting |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Self-hosting: Docker, systemd, reverse proxies, environment variables |
| [docs/SECURITY.md](docs/SECURITY.md) | The security model, its limits, and how to report a vulnerability |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Exactly what is and isn't seen or stored, and by whom |
| [docs/TERMS.md](docs/TERMS.md) | Terms of service for the public instance |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to contribute code, docs, or bug reports |
| [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md) | Community standards |

## License

[GPL-3.0](LICENSE). Pear-to-Pear is free software: you can redistribute
it and/or modify it under the terms of the GNU General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
