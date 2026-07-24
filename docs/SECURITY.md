# Security Policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security
vulnerabilities. Instead:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
  on this repository (Security tab → "Report a vulnerability"), or
- Contact the maintainer listed on the repository's GitHub profile
  directly.

Please include what you found, the steps to reproduce it, and its
potential impact. We'll acknowledge reports as quickly as we can and
keep you updated as a fix is developed. If you're not sure whether
something qualifies, err on the side of reporting it privately — worst
case we'll ask you to open a normal issue instead.

We don't currently run a paid bug bounty program, but we're genuinely
grateful for responsible disclosure and will credit reporters (if
you'd like credit) in the release notes for the fix.

## The security model, precisely

Pear-to-Pear's core guarantee is: **file content and filenames are
readable only by the two bonded browsers, never by the server, even if
the server is fully compromised.** Here's exactly how that's achieved,
and — just as importantly — what it doesn't cover.

### What's protected, and how

- **Confidentiality of file content and filenames**, via AES-256-GCM
  with keys derived from an ephemeral ECDH exchange, entirely in-browser.
  See [ARCHITECTURE.md](ARCHITECTURE.md#encryption) for the full scheme.
  The server, whether relaying data or not, only ever has ciphertext and
  the two ECDH public keys — neither is useful without the matching
  private key, which never leaves the browser that generated it.
- **Integrity of every chunk.** AES-GCM is an authenticated cipher — a
  chunk that's been altered in transit (by a compromised relay, a buggy
  intermediary, anything) fails to decrypt rather than silently handing
  over corrupted data. The client treats a failed decryption as a fatal
  transfer error.
- **Forward secrecy per session.** Keys are generated fresh for every
  bond and never persisted anywhere, in memory or otherwise, past the
  life of that session. Compromising a later session tells you nothing
  about an earlier one.
- **Server-side quota enforcement independent of the client.** The
  500-file / 10 GB limits are enforced by the server itself, not just
  trusted from a client's own math — a modified or malicious client
  can't exceed them.
- **Basic connection-level abuse mitigation.** A per-IP token-bucket
  rate limit on new connections (`server/src/rateLimit.ts`) makes naive
  connection-spam or code-guessing scripts impractical; combined with
  256-bit peer codes, brute-forcing a code by guessing is not
  computationally feasible.

### What this does *not* protect against

Being direct about the edges of the model, because a security document
that only lists strengths isn't a useful one:

- **A server actively performing a man-in-the-middle attack at bond
  time.** The server relays both sides' ECDH public keys; it never sees
  the private keys, but a malicious server operator could in principle
  substitute its own keys on each side and sit in the middle of the
  "encrypted" channel, decrypting and re-encrypting transparently. This
  is exactly what the six-digit **verification code** shown to both
  peers is for: it's derived from both real public keys, so a
  substituted key changes it. If you don't trust the server operator (or
  are self-hosting for someone who might not trust you), read that code
  to each other over a separate channel before sending anything
  sensitive. We show it by default specifically because this is the one
  gap ECDH-over-an-untrusted-relay can't close on its own.
- **A compromised or malicious browser on either end.** If your peer's
  device is compromised, or your own browser has a malicious extension
  reading page memory, encryption in transit doesn't help — this is true
  of essentially any encrypted communication tool.
- **Metadata visible to the server or a network observer.** File sizes,
  file counts, connection timing, and IP addresses are not hidden from
  the server or from anyone positioned to observe its traffic — see
  [PRIVACY.md](PRIVACY.md) for the precise list. If traffic-analysis
  resistance (hiding that a transfer of a given size happened at all)
  is part of your threat model, this tool doesn't provide it.
- **Availability / denial of service.** Nothing here defends against a
  determined attacker simply flooding a self-hosted instance with
  connections beyond what the rate limiter and your infrastructure can
  absorb. Standard DoS mitigation (a CDN/proxy in front, rate limiting
  at that layer, etc.) is your responsibility as an operator — see
  [DEPLOY.md](DEPLOY.md).
- **Vulnerabilities in dependencies or the browser itself.** We use a
  deliberately small dependency footprint (see below), but we can't make
  guarantees about the browser's own WebRTC/WebCrypto implementations,
  the OS, or the network stack underneath all of it.
- **Physical or social engineering attacks.** If someone tricks your
  peer into bonding with the wrong code, or reads your screen, that's
  outside any software's ability to prevent.

## Dependency footprint

The server has exactly one runtime dependency (`ws`, for WebSocket
handling) plus TypeScript tooling for development. The client has no
runtime dependencies beyond Svelte itself — no UI framework, no crypto
library (we use the browser's native WebCrypto), no analytics SDK. This
is a deliberate choice: fewer dependencies means a smaller supply-chain
attack surface and less code to audit. If a contribution proposes adding
a new dependency, expect to be asked to justify it — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Optional: the GitHub webhook auto-deploy listener

[`deploy/webhook/`](../deploy/webhook/) is an optional, separate process
(see [DEPLOY.md](DEPLOY.md#automatic-deployment-via-github-webhooks-optional))
that lets a push to your deploy branch trigger an unattended rebuild and
restart. Being direct about what this adds to the security picture,
since "a thing that can trigger code execution on your server" deserves
scrutiny:

- It's **entirely opt-in** — the listener refuses to start at all
  unless you've explicitly set `WEBHOOK_SECRET`, and it's a separate
  process/service you have to deliberately install. A default
  Pear-to-Pear deployment doesn't run it.
- It **verifies every request's HMAC-SHA256 signature** against your
  secret using a constant-time comparison before doing anything else,
  and additionally checks the event type and target branch — a request
  without a valid signature never reaches any deploy logic, full stop.
- It **never executes anything derived from the webhook payload
  itself** — the command it runs (`deploy.sh`) and the paths it operates
  on (`REPO_DIR`) are fixed by *your* environment configuration, not by
  anything an attacker could put in a request body. A forged payload
  with a valid signature could at most trigger an out-of-schedule
  redeploy of whatever is already on your configured branch — it
  cannot make the listener run arbitrary commands.
- It **runs outside the main application process** specifically so that
  a security issue in the (much larger, internet-facing, file-relay)
  main server can't be leveraged to reach deploy tooling, and vice
  versa.
- The one real risk it introduces: **whoever holds `WEBHOOK_SECRET` can
  trigger a redeploy on demand.** Treat that value like a password —
  generate it with `openssl rand -hex 32`, don't commit it, and rotate
  it (update both the listener's `.env` and the GitHub webhook config)
  if you suspect it's leaked.

If this tradeoff isn't one you want, don't install the listener —
`git pull` by hand costs you nothing but a few seconds per deploy.

## Supported versions

As a self-hosted, rolling-release project without version branches,
security fixes are made against the `master` branch. If you're
self-hosting, keep an eye on the repository for updates and rebuild
periodically — see [DEPLOY.md](DEPLOY.md#updating).

## A note on the security code (six-digit verification)

Skipping it doesn't turn off encryption — your files are still
end-to-end encrypted either way. What it adds is protection against the
one specific attack encryption-over-an-untrusted-relay can't rule out by
itself: an active man-in-the-middle at connection time (see above). For
casual, low-stakes transfers between people who trust the server they're
using, it's fine to skip. For anything sensitive, or when using an
instance you don't personally control, take the ten seconds to read the
code to each other.
