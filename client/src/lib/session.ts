import { SignalingClient, resolveSignalingUrl } from './signaling';
import { RelayChannel } from './channel';
import { attemptDirectConnection } from './webrtc';
import { generateKeyPair, exportPublicKey, SecureChannel, type KeyPair } from './crypto';
import { appState, liveConnection } from './stores';
import { PEER_CODE_PATTERN } from './protocol';
import { setupIncomingTransferListener, resetTransferState } from './transfer';

const DIRECT_CONNECTION_TIMEOUT_MS = 4000;
const NEGOTIATION_TIMEOUT_MS = 15_000;

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let signaling: SignalingClient | null = null;
let myKeys: KeyPair | null = null;
let peerPublicKeyB64: string | null = null;

function stunUrls(): string[] {
  const raw = (import.meta.env.VITE_STUN_URLS as string | undefined) ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function startSession(): Promise<void> {
  signaling = new SignalingClient();

  signaling.on('close', () => {
    appState.update((s) => ({ ...s, connection: 'disconnected' }));
    resetBond('Connection to the server was lost.');
  });

  signaling.on('welcome', (msg) => {
    appState.update((s) => ({
      ...s,
      connection: 'connected',
      myCode: msg.code,
      limits: msg.limits,
    }));
  });

  signaling.on('code', (msg) => {
    appState.update((s) => ({ ...s, myCode: msg.code }));
  });

  signaling.on('bond-failed', (msg) => {
    appState.update((s) => ({
      ...s,
      bond: 'idle',
      bondError: msg.reason,
      incomingBondRequest: false,
    }));
  });

  signaling.on('bond-pending', () => {
    appState.update((s) => ({ ...s, bond: 'pending-response' }));
  });

  signaling.on('bond-request', () => {
    appState.update((s) => ({ ...s, incomingBondRequest: true }));
  });

  signaling.on('bond-request-cancelled', () => {
    appState.update((s) => ({ ...s, incomingBondRequest: false }));
  });

  signaling.on('bonded', (msg) => {
    appState.update((s) => ({
      ...s,
      bond: 'bonded',
      bondError: null,
      incomingBondRequest: false,
      peerRole: msg.role,
      channel: 'negotiating',
    }));
    void negotiateChannel(msg.role);
  });

  signaling.on('peer-disconnected', () => {
    resetBond('Your peer disconnected.');
  });

  signaling.on('limit-exceeded', (msg) => {
    appState.update((s) => ({
      ...s,
      transfer: { ...s.transfer, phase: 'error', error: msg.detail },
    }));
  });

  try {
    await signaling.connect(resolveSignalingUrl());
  } catch {
    // The 'close' listener above already updates appState to reflect
    // this (WebSocket connection failures fire both 'error' and
    // 'close'); this catch exists purely so the rejection doesn't
    // surface as an unhandled promise rejection in the console.
    return;
  }

  // Keep the signaling connection alive through idle NAT/proxy timeouts.
  setInterval(() => signaling?.send({ type: 'ping' }), 25_000);

  void pollOnlineCount();
  setInterval(() => void pollOnlineCount(), 7_000);
}

async function pollOnlineCount(): Promise<void> {
  try {
    const res = await fetch('/stats', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { online?: unknown };
    if (typeof data.online === 'number') {
      appState.update((s) => ({ ...s, onlineCount: data.online as number }));
    }
  } catch {
    // Non-critical: just skip this tick and try again on the next one.
  }
}

async function negotiateChannel(role: 'initiator' | 'responder'): Promise<void> {
  if (!signaling) return;

  try {
    await withTimeout(negotiateChannelInner(role), NEGOTIATION_TIMEOUT_MS);
  } catch {
    // Whatever failed (a hung step, a thrown exception, or the timeout
    // above), the person should never be left staring at "Securing
    // connection…" forever with no way out. Tear the bond down
    // properly on both sides and surface a plain, actionable message.
    abortBond('Connection setup failed or timed out. Please try again.');
  }
}

async function negotiateChannelInner(role: 'initiator' | 'responder'): Promise<void> {
  if (!signaling) return;

  myKeys = await generateKeyPair();
  const myPub = await exportPublicKey(myKeys.publicKey);

  const keyExchange = new Promise<string>((resolve) => {
    const unsub = signaling!.on('signal', (msg) => {
      if (msg.payload.kind === 'key') {
        unsub();
        resolve(msg.payload.publicKey);
      }
    });
  });
  signaling.send({ type: 'signal', payload: { kind: 'key', publicKey: myPub } });

  const [peerPub, direct] = await Promise.all([
    keyExchange,
    attemptDirectConnection(signaling, role, stunUrls(), DIRECT_CONNECTION_TIMEOUT_MS),
  ]);
  peerPublicKeyB64 = peerPub;

  liveConnection.channel = direct ?? new RelayChannel(signaling);
  liveConnection.secure = await SecureChannel.establish(myKeys, peerPublicKeyB64, role);
  const verificationCode = await liveConnection.secure.verificationCode;

  setupIncomingTransferListener();

  appState.update((s) => ({
    ...s,
    channel: 'ready',
    channelIsDirect: liveConnection.channel!.isDirect,
    verificationCode,
  }));
}

export function regenerateCode(): void {
  signaling?.send({ type: 'regenerate' });
}

export function bondWithCode(rawCode: string): void {
  const code = rawCode.trim().toLowerCase();
  if (!PEER_CODE_PATTERN.test(code)) {
    appState.update((s) => ({ ...s, bondError: 'That code should be 64 characters (0–9, a–f).' }));
    return;
  }
  appState.update((s) => ({ ...s, bond: 'bonding', bondError: null }));
  signaling?.send({ type: 'bond', code });
}

export function leaveBond(): void {
  signaling?.send({ type: 'unbond' });
  resetBond(null);
}

export function respondToBondRequest(accept: boolean): void {
  signaling?.send({ type: 'bond-response', accept });
  appState.update((s) => ({ ...s, incomingBondRequest: false }));
}

function abortBond(reason: string): void {
  // Same server-side cleanup as leaveBond (properly ends the session so
  // the other side is freed too, not just our own local state), but for
  // an internal failure rather than a deliberate user action.
  signaling?.send({ type: 'unbond' });
  resetBond(reason);
}

function resetBond(reason: string | null): void {
  liveConnection.channel?.close();
  liveConnection.channel = null;
  liveConnection.secure = null;
  peerPublicKeyB64 = null;
  resetTransferState();
  appState.update((s) => ({
    ...s,
    bond: 'idle',
    bondError: reason,
    incomingBondRequest: false,
    peerRole: null,
    channel: null,
    channelIsDirect: null,
    verificationCode: null,
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
  }));
}

export function getSignaling(): SignalingClient | null {
  return signaling;
}
