import type { SignalingClient } from './signaling';

/**
 * Whatever actually carries the encrypted chunk bytes for a transfer.
 * Two implementations exist — a direct RTCDataChannel (true P2P, see
 * webrtc.ts) and this file's RelayChannel (streamed through the server
 * when a direct route can't be established). transfer.ts is written
 * against this interface and doesn't know or care which one it got.
 */
export interface DataChannelLike {
  readonly isDirect: boolean;
  readonly bufferedAmount: number;
  send(data: ArrayBuffer): void;
  onMessage(cb: (data: ArrayBuffer) => void): void;
  close(): void;
}

export class RelayChannel implements DataChannelLike {
  readonly isDirect = false;
  private handler: ((data: ArrayBuffer) => void) | null = null;
  private unsubscribe: () => void;

  constructor(private readonly signaling: SignalingClient) {
    this.unsubscribe = signaling.on('binary', (data) => this.handler?.(data));
  }

  get bufferedAmount(): number {
    return this.signaling.bufferedAmount;
  }

  send(data: ArrayBuffer): void {
    this.signaling.sendBinary(data);
  }

  onMessage(cb: (data: ArrayBuffer) => void): void {
    this.handler = cb;
  }

  close(): void {
    this.unsubscribe();
  }
}
