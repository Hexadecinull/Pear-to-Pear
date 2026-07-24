# Architecture

This document explains how Pear-to-Pear actually works: the rendezvous
protocol, the encryption scheme, the relay's memory model, and why each
piece was built the way it was. If you're planning to contribute, audit
the security model, or just satisfy your own curiosity, start here.

## Goals, and the tensions between them

The project has five requirements that pull in different directions:

1. **Peer-to-peer** \u2014 the name should mean something; files should go
   directly between browsers when possible.
2. **A server is still involved** \u2014 for rendezvous at minimum, and as a
   fallback data path when a direct connection can't be made.
3. **The server must never be a storage bottleneck** \u2014 it should be able
   to relay thousands of simultaneous transfers without buffering whole
   files, or even large fractions of them, in memory.
4. **Private and encrypted even from the server operator** \u2014 a full
   compromise of the server should expose no file content.
5. **Trivial to self-host** \u2014 a single Node.js process, deployable
   behind an ordinary HTTPS reverse proxy or tunnel, no UDP ports, no TURN
   infrastructure required to get a working (if not always direct) setup.

Everything below is the result of resolving those five constraints
against each other.

## Component overview

```
┌────────────────────┐         WebSocket (signaling: JSON)        ┌────────────────────┐
│                    │◄──────────────────────────────────────────►│                    │
│   Browser A        │                                              │   Server           │
│   (client/)        │         WebRTC DataChannel (best effort)    │   (server/)        │
│                    │◄╌╌╌╌╌╌╌╌╌╌╌╌╌╌ direct, if it connects ╌╌╌╌╌►│                    │
│                    │                                              │                    │
│                    │         WebSocket (binary relay, fallback)  │                    │
│                    │◄──────────────────────────────────────────►│                    │
└────────────────────┘                                              └────────┬───────────┘
                                                                              │
                                                                    WebSocket (same as above)
                                                                              │
                                                                    ┌─────────▼──────────┐
                                                                    │   Browser B        │
                                                                    │   (client/)        │
                                                                    └────────────────────┘
```

The server never runs application logic beyond bonding two sockets
together and, in the fallback path, piping bytes from one to the other.
It holds no database and writes nothing to disk.

## Rendezvous: peer codes and bonding

On connection, the server generates a 64-character lowercase-hex string
(32 random bytes \u2014 256 bits of entropy, via Node's `crypto.randomBytes`)
and sends it to the client as that client's **peer code**. The code:

- Exists only as a key in an in-memory `Map` on the server, pointing at
  that specific WebSocket connection.
- Is invalidated the instant the socket closes (refresh, network loss,
  tab close) \u2014 there is nothing to time out or garbage-collect beyond an
  idle timer for codes that are never used (`CODE_IDLE_TIMEOUT_MS`,
  default 30 minutes).
- Can be regenerated on demand (the `regenerate` message), which simply
  swaps the map key.

When someone enters a code they received, their client sends
`{ type: 'bond', code }`. The server looks the code up; if it's active
and not already bonded to someone else, both sockets are linked into a
**session** and the code is removed from the waiting pool (so it can't
be reused by a third party mid-handshake). There is deliberately no
"accept" step on the other side \u2014 receiving someone's code out-of-band
(you had to be given it directly) is treated as sufficient authorization
to bond, matching how the product is meant to feel: you and one other
specific person, nothing more.

Bonding assigns one side the WebRTC `initiator` role (whoever's code was
entered \u2014 they'll create the SDP offer) and the other `responder`. This
role only matters for the connection-negotiation handshake described
below; either side can subsequently act as the file **sender** or
**receiver** for a given transfer.

## Establishing the actual data channel

Once bonded, both browsers:

1. Generate an ephemeral ECDH keypair (P-256) purely for this session.
2. Exchange public keys through the server, wrapped as an opaque
   `signal` message the server relays without inspecting.
3. **Simultaneously**, attempt a direct WebRTC connection: the initiator
   creates an `RTCDataChannel` and an SDP offer; the responder answers.
   ICE candidates are exchanged the same way, through the same opaque
   `signal` relay. A single public STUN server (configurable) helps each
   side discover its own reachable address; STUN never sees file data,
   only helps with NAT traversal, and only reveals to that STUN provider
   what any WebRTC application would reveal (see docs/PRIVACY.md).
4. If the DataChannel reaches `open` within ~4 seconds, that's the
   transport for this session \u2014 file bytes now go **directly** between
   the two browsers and the server is no longer involved in the data
   path at all.
5. If it doesn't (symmetric NAT, restrictive corporate firewall, etc.),
   the client falls back to using the existing signaling WebSocket
   itself as the transport: binary frames sent to the server get piped
   straight to the other socket. See "The relay" below for how that stays
   memory-safe at scale.

Both paths present an identical interface to the rest of the client code
(`DataChannelLike` in `client/src/lib/channel.ts`) \u2014 the chunking,
encryption, and UI code has no idea which one it's using, other than to
display a "Direct P2P" vs. "Relayed" badge.

### Why not TURN?

A conventional way to make WebRTC "always work" is to add a TURN server
as a relay of last resort. We deliberately don't, for two reasons:

- **Self-hosting simplicity.** TURN needs its own long-lived UDP (and
  often TCP) listener with rotating credentials \u2014 real infrastructure to
  run and secure, on top of the main server. That directly conflicts
  with goal 5 above.
- **It wouldn't survive the deployment path we optimized for anyway.**
  This project's reference deployment (see docs/DEPLOY.md) uses
  Cloudflare Tunnel, which proxies HTTP/WebSocket traffic but isn't a
  good fit for arbitrary UDP relaying. A WebSocket-based fallback needs
  nothing but the HTTPS/WSS connection that's already there.

So instead of "always-on relay via TURN," the design is "best-effort
direct connection, with a relay fallback that's just as private and
still fast, over the transport we already have."

## Wire protocol

### Control messages (JSON, one per WebSocket text frame)

Defined once per side, kept manually in sync
(`server/src/protocol.ts` / `client/src/lib/protocol.ts`):

| Client \u2192 Server | Purpose |
|---|---|
| `regenerate` | Ask for a new peer code (only while unbonded) |
| `bond` | Attempt to bond to a given code |
| `unbond` | Leave the current session voluntarily |
| `signal` | Opaque WebRTC/key-exchange payload, relayed as-is |
| `manifest` | Declare an outgoing batch: file count, total bytes, per-file sizes |
| `receive-ready` | "I've accepted the incoming transfer, start sending" |
| `cancel` | Abort the current transfer |
| `transfer-complete` | Sender's confirmation that the batch finished |
| `ping` | Keepalive, to survive idle proxy timeouts |

| Server \u2192 Client | Purpose |
|---|---|
| `welcome` | Initial code + the active server-side limits |
| `code` | New code, after a regenerate or unbond |
| `bonded` | Bond succeeded; carries your `initiator`/`responder` role |
| `bond-failed` | Bad/unknown/already-bonded code |
| `peer-disconnected` | The other side's socket closed |
| `signal` | Opaque payload forwarded from your peer |
| `manifest` | Forwarded batch metadata (sizes only \u2014 see below) |
| `ready-to-receive` | Your peer accepted; start streaming |
| `transfer-complete` | Forwarded completion notice |
| `cancelled` | Transfer aborted, by which side |
| `limit-exceeded` | Server-side quota violation; session terminated |
| `error` | Generic error |
| `pong` | Keepalive reply |

### Why the manifest is split into two parts

The plaintext `manifest` control message carries **only** file *count*
and *sizes*, never filenames. This is the minimum information the
server needs to enforce the 500-file / 10 GB caps server-side (so a
modified client can't just skip client-side validation) and to let the
receiver's UI show a progress bar before a single byte of file data has
arrived. Filenames are considered content, not metadata that must be
visible for the relay to function \u2014 so they travel separately, as the
very first *encrypted* frame on the real data channel (direct or
relayed), indistinguishable from file data to the server. See
`client/src/lib/transfer.ts`, the reserved `fileIndex = 0xffff` sentinel
frame.

### Binary chunk framing

Every chunk \u2014 whether it goes over the direct DataChannel or the relay
\u2014 is one binary WebSocket/DataChannel message shaped like this:

```
byte 0-1   fileIndex     (uint16, big-endian) — which file in the batch
byte 2-5   chunkIndex    (uint32, big-endian) — sequence within that file
byte 6     flags         bit 0 = last chunk of this file
byte 7-18  nonce         12-byte AES-GCM nonce
byte 19+   ciphertext    AES-256-GCM ciphertext, tag appended (16 bytes)
```

`fileIndex = 0xffff` is reserved for the one-off encrypted filename
manifest described above; real files are indexed `0..499`.

The server (in the relay-fallback path) only ever reads the first 7
bytes, purely for bookkeeping (see "The relay" below) \u2014 it forwards
everything, including the nonce and ciphertext, as opaque bytes.

Chunks are a fixed 64 KiB of plaintext before encryption
(`CHUNK_SIZE` in `protocol.ts`), a conservative size comfortably under
every current browser's WebRTC DataChannel message-size limits, small
enough to keep progress bars smooth and backpressure fine-grained.

## Encryption

Implemented in `client/src/lib/crypto.ts`. All primitives are the
browser's native WebCrypto (`crypto.subtle`) \u2014 no custom cryptography,
no third-party crypto library.

1. **Key agreement.** Both sides generate an ephemeral ECDH keypair
   (P-256) when a bond is established and exchange only the public
   halves, via the signaling relay. Neither private key ever leaves its
   browser.
2. **Shared secret \u2192 directional keys.** Each side independently computes
   the same ECDH shared secret, then HKDF-expands it (SHA-256) into
   **two separate** AES-256-GCM keys \u2014 one for initiator\u2192responder
   traffic, one for responder\u2192initiator \u2014 using distinct HKDF `info`
   strings. This means the two possible senders in a session never share
   a nonce space, even though only one direction is normally active for
   any given transfer.
3. **Per-chunk nonces.** Each directional key uses a 12-byte nonce built
   from a monotonic counter (4 zero bytes + an 8-byte big-endian counter,
   starting at 0 for the first chunk ever sent with that key). Because
   each key is freshly derived per bonded session and used by exactly
   one sender, the counter can never repeat within that key's lifetime.
4. **Per-chunk AEAD.** Every chunk is encrypted independently with
   AES-256-GCM, which gives both confidentiality and integrity \u2014 a
   tampered chunk fails to decrypt rather than silently corrupting data.
5. **Verification code.** A short 6-digit number is derived (via a
   separate HKDF `info` string, independent of the transfer keys) from a
   hash of both sides' public keys, sorted so both browsers compute the
   same value regardless of role. It's shown to both people so they can
   read it to each other over any other channel. If it matches, the
   connection wasn't tampered with in transit \u2014 see docs/SECURITY.md for
   what this does and doesn't protect against.

The server, in every configuration, only ever has access to: both
public keys (useless without a private key), ciphertext, and the tiny
plaintext header needed for flow control and quota bookkeeping. It never
sees plaintext file content or filenames, with or without a direct P2P
connection.

## The relay: bounded memory regardless of file size

This is the mechanism behind the "won't take up all the storage even if
this gets popular" requirement. It lives in `server/src/relay.ts`.

The relay never writes anything to disk, and it's built so that no
single session can hold more than a small, fixed amount of data in
process memory \u2014 whether the file being sent is 10 MB or the full 10 GB
cap:

1. Every chunk arrives as one binary WebSocket frame. The server reads
   only the 7-byte header (for bookkeeping) and immediately calls
   `.send()` on the *other* peer's socket with the rest of the bytes,
   unmodified.
2. Before forwarding, it checks the receiving socket's `bufferedAmount`
   \u2014 how much data has been handed to the OS to send but not yet
   delivered. If that backlog exceeds `MAX_INFLIGHT_BYTES_PER_SESSION`
   (16 MiB by default), the server **pauses** reading from the sender's
   socket (`ws`'s `.pause()`, which stops consuming from the underlying
   TCP connection).
3. A short interval checks the receiver's backlog every 40ms; once it
   drops to half the threshold (hysteresis, to avoid rapid pause/resume
   thrashing), the sender's socket is resumed.
4. Pausing a `ws` socket's reads causes genuine TCP backpressure all the
   way back to the sending browser \u2014 it isn't a server-side illusion.
   The sender's `send()` calls naturally slow down because the OS socket
   buffer on *their* end fills up too.

The net effect: sender \u2192 relay \u2192 receiver behaves like a bounded pipe.
At most `MAX_INFLIGHT_BYTES_PER_SESSION` bytes are ever "in the system"
for one session, independent of total transfer size, and that number is
a deliberate operator-tunable knob (lower it on memory-constrained
hosts; raise it on fast, high-memory ones).

The same class of flow control exists in the direct WebRTC path, using
`RTCDataChannel.bufferedAmount` / `bufferedAmountLowThreshold` \u2014 the
sender-side code in `client/src/lib/transfer.ts` waits for the local
buffer to drain before reading and encrypting the next chunk, regardless
of which transport is in use.

## Quotas and enforcement

Two independent layers enforce the 500-files / 10 GB limits:

- **Client-side**, before anything is sent (`validateSelection` in
  `transfer.ts`) \u2014 purely for immediate user feedback.
- **Server-side**, at `manifest` time and again as a running tally during
  the actual relay (`config.maxFiles`, `config.maxTotalBytes` in
  `server/src/config.ts`) \u2014 this is the layer that actually matters,
  since it doesn't trust the client. A manifest that declares too many
  files or too many bytes ends the session immediately, before a single
  chunk is relayed; a session that somehow relays more raw bytes than
  the hard cap (e.g. a modified client lying in its manifest) is cut off
  mid-transfer.

Neither layer ever inspects filenames or file content to do this \u2014 only
the plaintext sizes/counts described above.

## Multi-file delivery on the receiving end

Handled in `client/src/lib/fileWriter.ts`. Two strategies, chosen at the
moment the person clicks **Receive** (which has to happen synchronously
enough to count as a user gesture, since the browser APIs involved
require one):

- **Streaming to disk**, where the File System Access API is available
  (Chromium-based browsers, as of this writing): a single file uses
  `showSaveFilePicker`; a batch of more than one uses
  `showDirectoryPicker` once and creates a writable stream per file
  inside it. Bytes are written as they arrive and each file's stream is
  closed the moment its last chunk lands \u2014 the browser never holds more
  than one in-flight chunk of any file in memory.
- **Buffer-then-download**, the fallback for browsers without that API
  (Firefox and Safari, as of this writing): each file's decrypted chunks
  accumulate in memory as a `Blob`, and a normal download is triggered
  once it's complete. The UI doesn't hide this tradeoff \u2014 it's simply
  what "receive" means on those browsers today.

## Why the client and server aren't a monorepo

`protocol.ts` is intentionally duplicated between `client/src/lib/` and
`server/src/`, rather than factored into a shared package with npm
workspaces or similar. Two reasons:

1. **Self-deploy simplicity.** Anyone can `npm install && npm run build`
   in `server/` and `client/` completely independently, with no
   workspace tooling, no monorepo-aware package manager version, and no
   build-order dependency between them.
2. **The two copies are small and change rarely.** The tradeoff of
   occasionally having to update both files in the same PR is, in this
   project's judgment, worth it for the deployment simplicity. If you're
   contributing a protocol change, update both and say so in your PR \u2014
   see docs/CONTRIBUTING.md.

## Known simplifications

Being upfront about what this design does *not* do, so nobody is
surprised:

- **One active transfer per bond at a time.** The protocol doesn't
  support two simultaneous batches in flight between the same pair. Send
  one, let it finish (or cancel it), then send the next.
- **No resumable transfers.** Losing the connection mid-transfer ends
  it; there's no checkpointing to resume a partial file. Re-bond and
  send again.
- **No offline delivery.** Both people need to be online, bonded, and
  present (or at least have a tab open) at the same time \u2014 this is a
  direct handoff tool, not a mailbox.
- **STUN, not TURN, for NAT traversal help.** A direct connection isn't
  guaranteed; see "Why not TURN?" above. When it fails, you get the relay
  path automatically \u2014 slower in theory, but still encrypted, still fast
  in practice, and it requires no extra infrastructure to self-host.
