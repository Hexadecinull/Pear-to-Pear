import { writable } from 'svelte/store';
import type { DataChannelLike } from './channel';
import type { SecureChannel } from './crypto';
import type { TransferLimits } from './protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type BondStatus = 'idle' | 'bonding' | 'bonded';
export type ChannelState = 'negotiating' | 'ready' | null;
export type TransferRole = 'sender' | 'receiver' | null;
export type TransferPhase =
  'idle' | 'selecting' | 'awaiting-peer' | 'transferring' | 'done' | 'error' | 'cancelled';

export interface FileProgress {
  name: string;
  size: number;
  bytesDone: number;
}

export interface AppState {
  connection: ConnectionStatus;
  myCode: string;
  bond: BondStatus;
  bondError: string | null;
  peerRole: 'initiator' | 'responder' | null;
  channel: ChannelState;
  channelIsDirect: boolean | null;
  verificationCode: string | null;
  limits: TransferLimits;
  onlineCount: number | null;
  transfer: {
    role: TransferRole;
    phase: TransferPhase;
    files: FileProgress[];
    activeFileIndex: number;
    totalBytes: number;
    bytesDone: number;
    startedAt: number | null;
    error: string | null;
  };
}

export function initialState(): AppState {
  return {
    connection: 'connecting',
    myCode: '',
    bond: 'idle',
    bondError: null,
    peerRole: null,
    channel: null,
    channelIsDirect: null,
    verificationCode: null,
    limits: { maxFiles: 500, maxTotalBytes: 10 * 1024 ** 3, maxInflightBytes: 16 * 1024 * 1024 },
    onlineCount: null,
    transfer: {
      role: null,
      phase: 'idle',
      files: [],
      activeFileIndex: -1,
      totalBytes: 0,
      bytesDone: 0,
      startedAt: null,
      error: null,
    },
  };
}

export const appState = writable<AppState>(initialState());

/** Live handles for the active connection, kept outside the store since
 *  RTCPeerConnection/CryptoKey instances aren't plain data and don't
 *  need to trigger Svelte reactivity on their own. */
export const liveConnection: { channel: DataChannelLike | null; secure: SecureChannel | null } = {
  channel: null,
  secure: null,
};
