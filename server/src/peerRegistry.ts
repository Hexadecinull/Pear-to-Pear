import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { config } from './config.js';
import { PEER_CODE_LENGTH } from './protocol.js';

export function generateCode(): string {
  // 32 random bytes -> 64 lowercase hex chars = 256 bits of entropy.
  return randomBytes(PEER_CODE_LENGTH / 2).toString('hex');
}

export interface Session {
  id: string;
  initiator: Peer;
  responder: Peer;
  createdAt: number;
  /** Bytes the sender has handed to the relay but the receiver hasn't
   *  acknowledged yet. Bounded by config.maxInflightBytesPerSession, the
   *  whole "don't buffer the whole file" mechanism. */
  inflightBytes: number;
  /** Running total across the session, checked against config.maxTotalBytes
   *  regardless of what any single client-side manifest claims. */
  totalBytesRelayed: number;
  fileCount: number;
  senderRole: 'initiator' | 'responder' | null;
}

export class Peer {
  code: string;
  session: Session | null = null;
  idleTimer: NodeJS.Timeout | null = null;
  /** Someone entered my code and is waiting for me to accept or decline. */
  pendingRequestFrom: Peer | null = null;
  /** I entered someone else's code and am waiting for their decision. */
  pendingRequestTo: Peer | null = null;
  pendingRequestTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly socket: WebSocket,
    public readonly ip: string,
  ) {
    this.code = generateCode();
  }
}

export class PeerRegistry {
  /** Codes currently waiting to be bonded (not yet paired). */
  private waiting = new Map<string, Peer>();
  private sessions = new Set<Session>();

  register(peer: Peer): void {
    this.waiting.set(peer.code, peer);
    this.armIdleTimeout(peer);
  }

  regenerate(peer: Peer): string {
    this.waiting.delete(peer.code);
    peer.code = generateCode();
    this.waiting.set(peer.code, peer);
    this.armIdleTimeout(peer);
    return peer.code;
  }

  /**
   * `requester` entered `code`. Rather than bonding immediately, this
   * flags the code's owner as having a pending decision to make. A code
   * can never be truly kept secret from everyone (it can be mistyped,
   * shoulder-surfed, or forwarded by accident), so the owner gets the
   * final say before anything is shared with whoever holds it.
   */
  requestBond(requester: Peer, code: string): { target: Peer } | { error: string } {
    if (requester.session) return { error: 'You are already bonded to a peer.' };
    if (requester.pendingRequestTo) return { error: 'You already have a request pending.' };
    if (code === requester.code) return { error: 'You cannot bond to your own code.' };

    const target = this.waiting.get(code);
    if (!target) return { error: 'That code is not active. Ask your peer for a fresh one.' };
    if (target.session) return { error: 'That code is already bonded to someone else.' };
    if (target.pendingRequestFrom) {
      return { error: 'That code already has a pending connection request.' };
    }

    target.pendingRequestFrom = requester;
    requester.pendingRequestTo = target;
    return { target };
  }

  /** Clears whatever pending request `target` is sitting on (if any) and
   *  returns the requester who was waiting, so the caller can notify them. */
  resolvePendingRequest(target: Peer): Peer | null {
    const requester = target.pendingRequestFrom;
    target.pendingRequestFrom = null;
    if (target.pendingRequestTimer) {
      clearTimeout(target.pendingRequestTimer);
      target.pendingRequestTimer = null;
    }
    if (requester) requester.pendingRequestTo = null;
    return requester;
  }

  /** Finalize a bond after the code owner has accepted. */
  bond(requester: Peer, code: string): { session: Session } | { error: string } {
    if (requester.session) return { error: 'You are already bonded to a peer.' };
    if (code === requester.code) return { error: 'You cannot bond to your own code.' };

    const target = this.waiting.get(code);
    if (!target) return { error: 'That code is not active. Ask your peer for a fresh one.' };
    if (target.session) return { error: 'That code is already bonded to someone else.' };

    this.waiting.delete(requester.code);
    this.waiting.delete(target.code);
    this.clearIdleTimeout(requester);
    this.clearIdleTimeout(target);

    const session: Session = {
      id: `${target.code.slice(0, 8)}-${requester.code.slice(0, 8)}`,
      initiator: target, // the peer whose code was entered drives the WebRTC offer
      responder: requester,
      createdAt: Date.now(),
      inflightBytes: 0,
      totalBytesRelayed: 0,
      fileCount: 0,
      senderRole: null,
    };
    requester.session = session;
    target.session = session;
    this.sessions.add(session);
    return { session };
  }

  /** Tear down a session, freeing both peers back to an unbonded state. */
  endSession(session: Session): void {
    this.sessions.delete(session);
    for (const peer of [session.initiator, session.responder]) {
      if (peer.session === session) peer.session = null;
    }
  }

  /** Fully remove a peer (socket closed) from whatever state it's in.
   *  Returns anyone who needs to be notified as a result, since sending
   *  messages isn't this module's job. */
  remove(peer: Peer): { pendingRequester: Peer | null; pendingTarget: Peer | null } {
    this.clearIdleTimeout(peer);
    this.waiting.delete(peer.code);
    if (peer.session) this.endSession(peer.session);

    // Someone was waiting on a decision from me; they need to know I'm gone.
    const pendingRequester = peer.pendingRequestFrom;
    if (pendingRequester) pendingRequester.pendingRequestTo = null;
    peer.pendingRequestFrom = null;
    if (peer.pendingRequestTimer) {
      clearTimeout(peer.pendingRequestTimer);
      peer.pendingRequestTimer = null;
    }

    // I was waiting on someone else's decision; clear their side too.
    const pendingTarget = peer.pendingRequestTo;
    if (pendingTarget) {
      pendingTarget.pendingRequestFrom = null;
      if (pendingTarget.pendingRequestTimer) {
        clearTimeout(pendingTarget.pendingRequestTimer);
        pendingTarget.pendingRequestTimer = null;
      }
    }
    peer.pendingRequestTo = null;

    return { pendingRequester, pendingTarget };
  }

  private armIdleTimeout(peer: Peer): void {
    this.clearIdleTimeout(peer);
    peer.idleTimer = setTimeout(() => {
      if (!peer.session && peer.socket.readyState === peer.socket.OPEN) {
        peer.socket.close(4000, 'idle timeout');
      }
    }, config.codeIdleTimeoutMs);
    peer.idleTimer.unref?.();
  }

  private clearIdleTimeout(peer: Peer): void {
    if (peer.idleTimer) {
      clearTimeout(peer.idleTimer);
      peer.idleTimer = null;
    }
  }
}
