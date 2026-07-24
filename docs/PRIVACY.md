# Privacy Policy

This document describes what Pear-to-Pear does and doesn't do with your
data, as precisely as we can put it. The short version: **practically no
data is stored anywhere, and your files never leave your and your
peer's devices except as encrypted bytes neither the server nor anyone
watching it can read.** The rest of this document is the detailed,
honest version of that claim \u2014 including the handful of things that
are technically visible in transit, because a privacy policy that hides
those to sound more impressive isn't one we're willing to write.

This policy describes the software's behavior, which applies the same
way to the public instance and to anyone's self-hosted copy. If you're
using someone else's self-hosted instance, they may be able to add
their own logging \u2014 the guarantees below describe what the unmodified
software does.

## What we never see or store

- **File contents.** Every file is encrypted in your browser before it
  ever leaves it, with a key derived independently by your peer's
  browser. The server \u2014 including the operator of any instance \u2014 only
  ever handles ciphertext, and only in the fallback relay path (see
  below). When a direct connection is used, your files never touch the
  server's process at all.
- **Filenames.** Names travel as part of the encrypted payload, not the
  plaintext metadata the server uses for quota checks. The server never
  learns what any file in a transfer is called.
- **Accounts, identities, or profiles.** There's nothing to sign up for
  and nothing tying a peer code to a person, email address, or account.
- **A history of who transferred what to whom.** There is no database.
  Peer codes and session state live in server process memory only, for
  as long as a connection is open, and disappear the moment it closes.
- **Files on disk, ever \u2014 even temporarily.** The server has no upload
  directory, no temp-file staging, no object storage integration. In the
  relay fallback path, each chunk is forwarded from one WebSocket
  connection to the other in memory and is never written anywhere.

## What is technically visible, and to whom

Being precise about the parts that aren't invisible:

- **IP addresses.** Like any web service, the server's WebSocket
  connection sees the IP address of both people while they're connected
  \u2014 used only for the connection itself and for basic abuse-mitigation
  rate limiting (see [SECURITY.md](SECURITY.md)), never logged to disk
  in the reference implementation. If a direct WebRTC connection is
  attempted, a STUN server (by default, a public one; self-hosters can
  point this at their own) also observes each side's public IP address,
  exactly as it would for any other WebRTC application \u2014 this is an
  inherent part of how NAT traversal works, not something specific to
  this project. STUN never sees file data.
- **File sizes and count \u2014 not names or content.** To enforce the
  500-file / 10 GB limits server-side (so they can't be bypassed by a
  modified client) and to show a receiver their progress bar before any
  data arrives, the total byte count and per-file sizes of a batch are
  sent to the server in plain text. Filenames and file contents are not
  part of this message \u2014 see [ARCHITECTURE.md](ARCHITECTURE.md#why-the-manifest-is-split-into-two-parts).
- **That a transfer of a given size happened, while it's happening.**
  An operator watching server memory or network traffic in real time
  could observe that two connections relayed some number of encrypted
  bytes at some point in time. Nothing about this observation is
  retained after the connection closes, and it reveals nothing about
  what was sent.
- **Standard web server access patterns.** Loading the page involves an
  ordinary HTTP request for static files, which is subject to whatever
  logging your reverse proxy, CDN, or hosting provider does by default
  \u2014 the same as loading any website. This is outside the application's
  own control; if you self-host, see [DEPLOY.md](DEPLOY.md) for guidance
  on keeping proxy logs minimal if that matters to you.

## Cookies and tracking

None. No cookies, no analytics scripts, no third-party trackers, no
fonts or assets loaded from third-party CDNs at runtime. The only
network connections the page makes are to the signaling server (to
bond and, if needed, relay) and, transiently, to a STUN server if a
direct connection is attempted.

## Data retention

There is nothing to retain. Server-side state \u2014 peer codes, session
pairings, in-flight relay bookkeeping \u2014 lives in process memory and is
discarded the instant a connection closes or a transfer ends. Restarting
the server clears everything. There are no backups of something that
was never stored in the first place.

## Children's privacy

Pear-to-Pear doesn't collect personal information from anyone,
including children, because it doesn't collect personal information
from anyone.

## Changes to this policy

If the software's behavior changes in a way that affects this policy,
this document will be updated alongside that change in the same
repository, with the history visible in version control.

## Questions

This is open-source software \u2014 the most precise privacy policy is the
code itself, in `server/src/` and `client/src/lib/`. If anything in this
document seems inconsistent with what the code actually does, please
open an issue; that would be a bug in either the code or the docs, and
we'd want to fix whichever one is wrong.
