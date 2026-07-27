# Documentation index

A guide to what's in this folder and where to look first, depending on
what you're trying to do.

## I want to use Pear-to-Pear

- **[USAGE.md](USAGE.md)**: every feature explained, getting a code,
  bonding, sending, receiving, limits, and a troubleshooting section for
  when something doesn't behave as expected.

## I want to understand how it works

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the full technical picture,
  the bonding protocol, the direct-P2P-with-relay-fallback design, the
  wire format, and, in detail, the end-to-end encryption scheme.
  Start here if you're auditing the crypto or the protocol.
- **[SECURITY.md](SECURITY.md)**: the threat model stated precisely,
  what's protected, what isn't, and how to report a vulnerability.
- **[PRIVACY.md](PRIVACY.md)**: exactly what data exists, however
  briefly, and who can see it. Written to be precise rather than
  reassuring.

## I want to run my own instance

- **[DEPLOY.md](DEPLOY.md)**: self-hosting, generically. Docker,
  systemd, reverse proxies (Caddy/nginx), environment variables, and
  optional GitHub-Webhook auto-deployment.

## I want to contribute

- **[CONTRIBUTING.md](CONTRIBUTING.md)**: dev environment setup, coding
  conventions, how to test a change by hand, and the PR process.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**: community standards for
  any project space (issues, PRs, discussions).

## Policies for the public instance

- **[TERMS.md](TERMS.md)**: terms of service.
- **[PRIVACY.md](PRIVACY.md)**: see above, doubles as the privacy
  policy for the public instance.

---

Something missing, unclear, or out of date? Docs issues are held to a
lower bar than code, see [CONTRIBUTING.md](CONTRIBUTING.md#ways-to-contribute-beyond-code).
