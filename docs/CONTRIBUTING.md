# Contributing to Pear-to-Pear

Thanks for considering contributing. This project is small on purpose
(see [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning behind several
of its "why not do the more common thing" decisions), so contributions
that keep it that way — rather than growing its dependency footprint or
surface area — are especially welcome.

By participating, you're expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute, beyond code

- **Report a bug.** Even a clear, reproducible description without a
  fix is genuinely useful — see "Filing a good bug report" below.
- **Improve the documentation.** Found something in `docs/` that's
  unclear, outdated, or missing? Docs PRs are held to a lower bar than
  code PRs and are very welcome.
- **Test on a browser or platform we haven't.** WebRTC and the File
  System Access API behave differently across browsers; a report of
  "this doesn't work on X" with details is valuable even without a fix.
- **Review open pull requests.** A second pair of eyes on the wire
  protocol or crypto code especially is always worth having.
- **Answer questions in issues.** Helping other users/self-hosters is a
  contribution too.

## Filing a good bug report

Please include:

- What you did, what you expected, and what actually happened.
- Browser and OS (WebRTC/File-System-Access behavior is
  browser-specific — see [ARCHITECTURE.md](ARCHITECTURE.md)).
- Whether the connection badge showed **Direct P2P** or **Relayed** —
  this narrows down which code path is involved immediately.
- Console errors, if any (open devtools → Console before reproducing).
- Whether you're using the public instance or self-hosting (and if
  self-hosting, roughly how — Docker, systemd, etc., and whether it's
  behind Cloudflare Tunnel or something else).

## Security issues

**Do not file a public issue for a security vulnerability.** See
[SECURITY.md](SECURITY.md) for the private reporting process.

## Development setup

Requires Node.js 20+.

```bash
git clone https://github.com/Hexadecinull/Pear-to-Pear.git
cd Pear-to-Pear

cd server && npm install && cp .env.example .env && npm run dev &
cd ../client && npm install && cp .env.example .env
# set VITE_SIGNALING_URL=ws://localhost:8787 in client/.env for local dev
npm run dev
```

Open two browser windows against the client's dev URL to test bonding
against yourself.

Useful commands:

| Command | Where | Does |
|---|---|---|
| `npm run dev` | `client/`, `server/` | Dev server with hot reload / auto-restart |
| `npm run build` | `client/`, `server/` | Production build |
| `npm run check` | `client/` | Type-checks `.svelte` and `.ts` files (svelte-check) |
| `npx tsc --noEmit` | `server/` | Type-checks the server |
| `npm run lint` | `client/`, `server/` | ESLint |
| `npm run format` / `format:check` | `client/`, `server/` | Prettier — write or just verify |

CI (`.github/workflows/ci.yml`) runs `lint`, `format:check`, the
type-check, and `build` for both packages on every push and PR to
`master` — running them locally first saves a round trip.

There's currently no automated test suite beyond type-checking and
linting — see "Testing your changes" below for what to verify by hand,
and consider a test-infrastructure contribution if you'd like to change
that (see "What we'd love help with," below).

## Coding conventions

- **TypeScript everywhere, strict mode on.** Both `client/` and
  `server/` compile with `strict: true`. Don't add `any` or `@ts-ignore`
  to work around a type error — fix the type, or ask in your PR if
  you're stuck on one.
- **Minimal dependencies.** Before adding a package, check whether the
  browser/Node standard library already covers it (WebCrypto, the
  Streams API, and the File System Access API cover a lot of what you
  might reach for a library for). See
  [SECURITY.md](SECURITY.md#dependency-footprint) for why this matters
  here specifically.
- **No UI framework beyond Svelte itself.** Styling is hand-written CSS
  using the custom properties in `client/src/styles/app.css` — keep new
  UI consistent with that token system rather than introducing a new
  one.
- **Comments explain *why*, not *what*.** The existing source leans
  toward explaining non-obvious design decisions (especially around the
  crypto and relay flow-control code) rather than narrating what each
  line does. Match that style.
- **Keep `server/src/protocol.ts` and `client/src/lib/protocol.ts` in
  sync.** If your change touches the wire protocol, update both copies
  in the same PR and call that out explicitly in the PR description —
  see [ARCHITECTURE.md](ARCHITECTURE.md#why-the-client-and-server-arent-a-monorepo)
  for why they're separate files at all.

## Testing your changes by hand

Since there's no automated test suite for the full flow yet, please
verify manually before opening a PR:

1. Two browser windows/tabs, bond them to each other.
2. Send a small batch (a few small files) and confirm it completes.
3. If your change touches the transfer path, also test:
   - A file at or near the chunk boundary (a few MB) to catch off-by-one
     errors in the chunking loop.
   - Cancelling mid-transfer from both the sender's and the receiver's
     side.
   - What happens if one side refreshes mid-transfer (should cleanly
     reset both sides, not hang).
4. If your change touches signaling/relay code in `server/`, sanity
   check the server-side quota enforcement path too (a manifest that
   deliberately exceeds the configured limits should get rejected with
   `limit-exceeded` and close both sockets).
5. Run `npm run check` in `client/` and `npx tsc --noEmit` in `server/`
   — both should be clean. Also run `npm run lint` and
   `npm run format:check` in whichever package you touched — the same
   checks run in CI, so catching them locally saves a round trip.

## Pull request process

1. Fork the repository and create a branch off `master`.
2. Make your change, following the conventions above.
3. Update relevant docs in `docs/` if your change affects behavior
   described there — documentation drift is treated as a real bug here.
4. Open a PR with a clear description of *why*, not just *what* (the
   diff already shows what changed). If it touches the protocol or the
   encryption scheme, say so explicitly and explain the reasoning.
5. Be responsive to review feedback. Small, focused PRs get reviewed
   faster than large ones that bundle unrelated changes.

## What we'd love help with

Not an exhaustive roadmap, just genuinely useful areas if you're looking
for a place to start:

- **Automated end-to-end tests** for the transfer flow (e.g. driving two
  headless browser instances through a real bond + transfer).
- **Accessibility review** of the single-page UI — keyboard navigation,
  screen reader labeling, and color contrast beyond what's already been
  considered.
- **Additional locale support**, if there's interest — all UI strings
  currently live inline in `client/src/App.svelte`.
- **Deployment recipes** for platforms beyond what's documented in
  [DEPLOY.md](DEPLOY.md) (e.g. a particular hosting provider, a Helm
  chart, etc.) — as a doc contribution, not by adding deployment-specific
  code to the app itself.

## License

By contributing, you agree that your contributions will be licensed
under the project's [AGPL-3.0](LICENSE) license.
