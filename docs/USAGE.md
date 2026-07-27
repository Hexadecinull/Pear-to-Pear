# Using Pear-to-Pear

This is a guide to the product itself: what every part of the page does,
what the limits are, and what to try when something doesn't work. For how
it's built, see [ARCHITECTURE.md](ARCHITECTURE.md). To run your own copy,
see [DEPLOY.md](DEPLOY.md).

## The basics

Pear-to-Pear is one page. There are no accounts, no sign-in, and nothing
to configure before you start.

### Getting your code

The moment the page loads, you're given a 64-character code under **You**.
That code identifies *this browser tab, right now*, nothing more. Share
it with whoever you want to send files to or receive files from, using
whatever channel you'd normally use to talk to them (chat, a phone call,
in person).

- **Copy code** puts it on your clipboard.
- **Regenerate** throws away the current code and issues a new one. Use
  this if you shared a code with the wrong person, or just want a clean
  one. You can't regenerate while already bonded to someone, disconnect
  first.
- Refreshing the page, or losing your connection, also gets you a brand
  new code automatically. Codes are never reused.

### Bonding with someone

Paste the code they gave you into the **Peer** field and hit **Connect**
(or press Enter). If it's valid and still active, you'll both see
**Connected**. From that point on:

- A badge tells you whether you're connected **Direct P2P** (files will
  go straight between your two browsers, never through the server) or
  **Relayed · encrypted** (a direct route couldn't be found, so the
  server is streaming encrypted chunks between you, still private, just
  one extra hop).
- A **security code** (six digits) appears for both of you. It's
  optional to check, but if you want to be extra sure nobody tampered
  with the connection, read it to each other over voice or a separate
  chat. If the numbers match, you're really talking to each other.

If bonding fails, you'll see why: the code was mistyped, it's expired
(the other person refreshed or closed their tab), or it's already
bonded to somebody else. Ask for a fresh code and try again.

**Disconnect** ends the bond on purpose, from either side, and gets you
a new code to start over with.

### Sending files

Once bonded, drop files onto the page (or click to browse). A few rules:

- Up to **500 files** and **10 GB total** per batch.
- **Folders aren't accepted**. If you drag one in, it's skipped and
  you'll see a note about it. Select the individual files inside it
  instead.
- You can remove individual files from the list before sending, or
  **Clear** to start over.

Hit **Send N files** when you're ready. Your peer sees an incoming-
transfer prompt with the file list and total size; nothing moves until
they hit **Receive**. If they **Decline**, you'll be told your transfer
was declined.

### Receiving files

When someone sends you a batch, you'll see **Incoming transfer** with
the file count and size. Hitting **Receive** will, depending on your
browser:

- **Chromium-based browsers (Chrome, Edge, Brave, etc.):** prompt you to
  pick a save location: a single file gets a normal "save as" dialog, a
  batch of more than one asks you to pick a destination folder once.
  Files are written directly to disk as they arrive.
- **Firefox / Safari:** these browsers don't yet expose the API needed
  to stream straight to disk, so each file is held in memory and
  downloaded normally once it's finished. For very large batches this
  uses more memory than the Chromium path. Keep that in mind if you're
  receiving close to the 10 GB limit on one of these browsers.

### During a transfer

You'll see an overall progress bar, current speed, an ETA, and a
per-file list with individual progress. **Cancel transfer** stops it
immediately on both ends. When it finishes, you'll see a completion
screen. Hit **Done** to go back to the file picker and send or receive
again without leaving the bond.

## Limits, precisely

| Limit | Value |
|---|---|
| Files per batch | 500 |
| Total size per batch | 10 GB |
| Folders | Not supported, select individual files |
| Simultaneous transfers per bond | 1 (finish or cancel one before starting another) |
| Accounts | None, nothing to sign up for |

These are enforced both in your browser and on the server, so they can't
be bypassed by a modified client, see
[ARCHITECTURE.md](ARCHITECTURE.md#quotas-and-enforcement).

## Troubleshooting

**"That code doesn't look right."**
Peer codes are exactly 64 characters, using only `0-9` and `a-f`. Check
for a missing character or an accidental space at either end.

**"That code is not active."**
The person who owns that code has since refreshed, closed their tab, or
their connection dropped. Ask them for a current code.

**"That code is already bonded to someone else."**
Someone else connected to that code first. Ask for a fresh one.

**Stuck on "Securing connection…"**
This should resolve in a few seconds. If it doesn't, one side likely has
a very restrictive network (corporate proxy, strict firewall) blocking
both the direct attempt and, unusually, the fallback too. Try a
different network, or check that WebSocket connections to the site
aren't being blocked outright.

**Transfer seems slow**
If the badge says **Relayed**, your data is going through one extra hop
compared to a direct connection. This is expected on networks where a
direct WebRTC route can't be established (symmetric NAT, some corporate
networks, some mobile carriers). It's still end-to-end encrypted and
still streamed, just not direct.

**The receiver's browser asks to download instead of picking a folder**
That means it's Firefox or Safari, which fall back to the download-based
path described above, not a bug, just a current browser capability gap.

**I refreshed by accident mid-transfer**
The bond and the transfer are both gone. Refreshing tears down the
WebSocket connection, and there's no reconnect-and-resume by design (see
[ARCHITECTURE.md](ARCHITECTURE.md#known-simplifications)). Re-bond and
send again.

**Something else went wrong and I got a generic error**
Hit **Back**, re-check your connection, and try again. If it keeps
happening, it may be worth checking whether you're hitting the file
count or size limits, or filing an issue, see
[CONTRIBUTING.md](CONTRIBUTING.md).
