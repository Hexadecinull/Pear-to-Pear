import type { ClientMessage, ServerMessage, TransferLimits } from './protocol';

type Listener<T> = (payload: T) => void;

/** Every ServerMessage variant, keyed by its `type`, for typed `.on()`. */
type EventMap = {
  [M in ServerMessage as M['type']]: M;
} & { open: void; close: void; binary: ArrayBuffer };

export class SignalingClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<keyof EventMap, Set<Listener<unknown>>>();
  limits: TransferLimits | null = null;

  connect(url: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.emit('open', undefined);
        resolvePromise();
      });
      socket.addEventListener('close', () => this.emit('close', undefined));
      socket.addEventListener('error', () => reject(new Error('Could not reach the server.')));
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          this.handleControl(event.data);
        } else {
          this.emit('binary', event.data as ArrayBuffer);
        }
      });
    });
  }

  private handleControl(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'welcome') this.limits = msg.limits;
    this.emit(msg.type, msg);
  }

  on<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const set = this.listeners.get(type)!;
    set.add(listener as Listener<unknown>);
    return () => set.delete(listener as Listener<unknown>);
  }

  private emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) listener(payload);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  sendBinary(data: ArrayBuffer): void {
    this.socket?.send(data);
  }

  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/** Derives the signaling WS URL from the current page unless overridden. */
export function resolveSignalingUrl(): string {
  const override = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (override) return override;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/`;
}
