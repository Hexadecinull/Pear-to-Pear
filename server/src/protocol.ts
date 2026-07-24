/**
 * Control-message protocol spoken over the WebSocket connection.
 *
 * This file MUST stay in sync with client/src/lib/protocol.ts — the two
 * are intentionally not shared via a package because the project is meant
 * to stay simple to self-host (see docs/ARCHITECTURE.md for why).
 *
 * Every message here is sent as a JSON text frame. Binary frames (the
 * actual encrypted file chunks) are never parsed by the server as JSON —
 * see relay.ts for the binary chunk header layout.
 */

export type ClientMessage =
  | { type: 'regenerate' }
  | { type: 'bond'; code: string }
  | { type: 'unbond' }
  | { type: 'signal'; payload: unknown }
  | { type: 'manifest'; fileCount: number; totalBytes: number; fileSizes: number[] }
  | { type: 'receive-ready' }
  | { type: 'cancel'; reason?: string }
  | { type: 'transfer-complete' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'welcome'; code: string; limits: TransferLimits }
  | { type: 'code'; code: string }
  | { type: 'bonded'; role: 'initiator' | 'responder' }
  | { type: 'bond-failed'; reason: string }
  | { type: 'peer-disconnected' }
  | { type: 'signal'; payload: unknown }
  | { type: 'manifest'; fileCount: number; totalBytes: number; fileSizes: number[] }
  | { type: 'ready-to-receive' }
  | { type: 'transfer-complete' }
  | { type: 'cancelled'; by: 'sender' | 'receiver' | 'server'; reason?: string }
  | { type: 'limit-exceeded'; detail: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

export interface TransferLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxInflightBytes: number;
}

/** 64 lowercase-hex characters = 256 bits of entropy. */
export const PEER_CODE_LENGTH = 64;
export const PEER_CODE_PATTERN = /^[0-9a-f]{64}$/;
