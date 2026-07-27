import type { WebSocket, RawData } from 'ws';
import { config } from './config.js';
import type { Peer, Session } from './peerRegistry.js';

/**
 * Streams encrypted chunks between two bonded peers without touching
 * disk and without holding more than a small, fixed window of a
 * transfer in memory, no matter the file size. Full design (the binary
 * frame layout and why the bound holds) is in docs/ARCHITECTURE.md.
 */

const HEADER_BYTES = 7;
const RESUME_CHECK_INTERVAL_MS = 40;

export function handleBinaryChunk(session: Session, from: Peer, data: RawData): void {
  const buf = toBuffer(data);
  if (buf.length < HEADER_BYTES) return; // malformed frame, drop silently

  const to = from === session.initiator ? session.responder : session.initiator;
  if (to.socket.readyState !== to.socket.OPEN) return;

  session.totalBytesRelayed += buf.length;
  if (session.totalBytesRelayed > config.maxTotalBytes) {
    throw new RelayLimitExceeded(
      `Transfer exceeds the ${formatBytes(config.maxTotalBytes)} limit.`,
    );
  }

  to.socket.send(buf);
  applyBackpressure(from.socket, to.socket);
}

function applyBackpressure(senderSocket: WebSocket, receiverSocket: WebSocket): void {
  if (receiverSocket.bufferedAmount <= config.maxInflightBytesPerSession) return;

  // pause()/resume() pause the underlying socket's flow, which is what
  // makes the sender's browser feel real backpressure instead of the
  // relay silently buffering an unbounded amount in process memory.
  senderSocket.pause?.();

  const check = setInterval(() => {
    if (
      receiverSocket.readyState !== receiverSocket.OPEN ||
      senderSocket.readyState !== senderSocket.OPEN
    ) {
      clearInterval(check);
      return;
    }
    // Hysteresis: wait for the backlog to drop to half the threshold
    // before resuming, so we don't thrash pause/resume at the boundary.
    if (receiverSocket.bufferedAmount <= config.maxInflightBytesPerSession / 2) {
      senderSocket.resume?.();
      clearInterval(check);
    }
  }, RESUME_CHECK_INTERVAL_MS);
  check.unref?.();
}

export class RelayLimitExceeded extends Error {}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return `${gib.toFixed(0)} GB`;
}
