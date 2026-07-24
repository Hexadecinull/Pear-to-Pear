import type { SignalingClient } from './signaling';
import type { DataChannelLike } from './channel';

const DATA_CHANNEL_LABEL = 'pear-transfer';
const BUFFERED_AMOUNT_LOW_THRESHOLD = 1 << 20; // 1 MiB

export class DirectChannel implements DataChannelLike {
  readonly isDirect = true;
  private handler: ((data: ArrayBuffer) => void) | null = null;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly dc: RTCDataChannel,
  ) {
    dc.onmessage = (event) => this.handler?.(event.data as ArrayBuffer);
  }

  get bufferedAmount(): number {
    return this.dc.bufferedAmount;
  }

  send(data: ArrayBuffer): void {
    this.dc.send(data);
  }

  onMessage(cb: (data: ArrayBuffer) => void): void {
    this.handler = cb;
  }

  close(): void {
    this.dc.close();
    this.pc.close();
  }
}

/**
 * Tries to establish a direct browser-to-browser DataChannel using the
 * signaling connection only to exchange SDP/ICE (a few hundred bytes of
 * text, never file data). Resolves `null` — never rejects — if a direct
 * route can't be found within `timeoutMs`, so the caller can fall back to
 * the relay without treating it as an error. This is expected and normal
 * on strict corporate networks or symmetric NATs; see ARCHITECTURE.md.
 */
export function attemptDirectConnection(
  signaling: SignalingClient,
  role: 'initiator' | 'responder',
  stunUrls: string[],
  timeoutMs: number,
): Promise<DirectChannel | null> {
  const pc = new RTCPeerConnection({
    iceServers: stunUrls.length ? [{ urls: stunUrls }] : [],
  });

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: DirectChannel | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribeSignal();
      resolve(result);
      if (!result) {
        pc.onconnectionstatechange = null;
        pc.close();
      }
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const unsubscribeSignal = signaling.on('signal', (msg) => {
      void handleSignal(msg.payload);
    });

    async function handleSignal(payload: import('./protocol').SignalPayload): Promise<void> {
      if (payload.kind === 'sdp') {
        if (payload.description.type === 'offer') {
          await pc.setRemoteDescription(payload.description);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.send({ type: 'signal', payload: { kind: 'sdp', description: answer } });
        } else if (payload.description.type === 'answer') {
          await pc.setRemoteDescription(payload.description);
        }
      } else if (payload.kind === 'ice') {
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch {
          // Late/duplicate candidates are common and harmless; ignore.
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({
          type: 'signal',
          payload: { kind: 'ice', candidate: event.candidate.toJSON() },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(null);
    };

    const wireDataChannel = (dc: RTCDataChannel) => {
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
      dc.onopen = () => finish(new DirectChannel(pc, dc));
    };

    if (role === 'initiator') {
      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
      wireDataChannel(dc);
      pc.createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          signaling.send({ type: 'signal', payload: { kind: 'sdp', description: offer } });
        })
        .catch(() => finish(null));
    } else {
      pc.ondatachannel = (event) => wireDataChannel(event.channel);
    }
  });
}
