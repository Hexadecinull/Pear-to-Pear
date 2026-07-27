/**
 * Control-message protocol spoken over the WebSocket connection.
 *
 * This file must stay in sync with client/src/lib/protocol.ts. The two
 * are kept separate rather than shared via a package, see
 * docs/ARCHITECTURE.md.
 *
 * Every message here is a JSON text frame. Binary frames (the encrypted
 * file chunks) are never parsed as JSON; see relay.ts for that layout.
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
