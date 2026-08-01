/**
 * Control-message protocol spoken over the WebSocket connection.
 *
 * This file must stay in sync with server/src/protocol.ts. It's
 * duplicated rather than shared through a package on purpose, see
 * docs/ARCHITECTURE.md, "Why the client and server aren't a monorepo".
 */

export type ClientMessage =
  | { type: 'regenerate' }
  | { type: 'bond'; code: string }
  | { type: 'bond-response'; accept: boolean }
  | { type: 'unbond' }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'manifest'; fileCount: number; totalBytes: number; fileSizes: number[] }
  | { type: 'receive-ready' }
  | { type: 'cancel'; reason?: string }
  | { type: 'transfer-complete' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'welcome'; code: string; limits: TransferLimits }
  | { type: 'code'; code: string }
  | { type: 'bond-pending' }
  | { type: 'bond-request' }
  | { type: 'bond-request-cancelled' }
  | { type: 'bonded'; role: 'initiator' | 'responder' }
  | { type: 'bond-failed'; reason: string }
  | { type: 'peer-disconnected' }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'manifest'; fileCount: number; totalBytes: number; fileSizes: number[] }
  | { type: 'ready-to-receive' }
  | { type: 'transfer-complete' }
  | { type: 'cancelled'; by: 'sender' | 'receiver' | 'server'; reason?: string }
  | { type: 'limit-exceeded'; detail: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

/**
 * Everything the two browsers exchange to set up their own connection.
 * The server relays this opaquely: it never inspects `sdp`/`candidate`,
 * and the `key` payload is a public key that's only useful when combined
 * with the *other* side's private key, so a passive server operator
 * still can't decrypt the data that follows.
 */
export type SignalPayload =
  | { kind: 'key'; publicKey: string }
  | { kind: 'sdp'; description: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface TransferLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxInflightBytes: number;
}

export const PEER_CODE_LENGTH = 64;
export const PEER_CODE_PATTERN = /^[0-9a-f]{64}$/;

/** Size of one plaintext chunk before encryption, in bytes. */
export const CHUNK_SIZE = 64 * 1024;

/** Fixed binary header prepended to every chunk frame on the wire. */
export const CHUNK_HEADER_BYTES = 7;

export interface ChunkHeader {
  fileIndex: number;
  chunkIndex: number;
  isLastChunkOfFile: boolean;
}

export function encodeChunkHeader(h: ChunkHeader): Uint8Array {
  const buf = new Uint8Array(CHUNK_HEADER_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint16(0, h.fileIndex, false);
  view.setUint32(2, h.chunkIndex, false);
  view.setUint8(6, h.isLastChunkOfFile ? 1 : 0);
  return buf;
}

export function decodeChunkHeader(buf: ArrayBuffer): ChunkHeader {
  const view = new DataView(buf, 0, CHUNK_HEADER_BYTES);
  return {
    fileIndex: view.getUint16(0, false),
    chunkIndex: view.getUint32(2, false),
    isLastChunkOfFile: view.getUint8(6) === 1,
  };
}
