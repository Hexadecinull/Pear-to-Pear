import type { WebSocket, RawData } from 'ws';
import { config } from './config.js';
import { Peer, PeerRegistry } from './peerRegistry.js';
import { PEER_CODE_PATTERN, type ClientMessage, type ServerMessage } from './protocol.js';
import { handleBinaryChunk, RelayLimitExceeded } from './relay.js';

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function attachConnection(socket: WebSocket, ip: string, registry: PeerRegistry): void {
  const peer = new Peer(socket, ip);
  registry.register(peer);

  send(socket, {
    type: 'welcome',
    code: peer.code,
    limits: {
      maxFiles: config.maxFiles,
      maxTotalBytes: config.maxTotalBytes,
      maxInflightBytes: config.maxInflightBytesPerSession,
    },
  });

  socket.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        onBinary(peer, data);
      } else {
        onControl(peer, registry, data);
      }
    } catch (err) {
      if (err instanceof RelayLimitExceeded) {
        notifyBothAndEnd(peer, registry, 'server', err.message);
      } else {
        send(socket, { type: 'error', code: 'internal', message: 'Something went wrong.' });
      }
    }
  });

  socket.on('close', () => {
    const session = peer.session;
    registry.remove(peer);
    if (session) {
      const other = session.initiator === peer ? session.responder : session.initiator;
      send(other.socket, { type: 'peer-disconnected' });
    }
  });
}

function onBinary(peer: Peer, data: RawData): void {
  if (!peer.session) return; // no bond, no relay
  handleBinaryChunk(peer.session, peer, data);
}

function onControl(peer: Peer, registry: PeerRegistry, raw: RawData): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw.toString('utf-8'));
  } catch {
    return;
  }

  switch (msg.type) {
    case 'ping':
      send(peer.socket, { type: 'pong' });
      return;

    case 'regenerate': {
      if (peer.session) {
        send(peer.socket, { type: 'error', code: 'bonded', message: 'Unbond before regenerating.' });
        return;
      }
      const code = registry.regenerate(peer);
      send(peer.socket, { type: 'code', code });
      return;
    }

    case 'bond': {
      const code = msg.code?.trim().toLowerCase();
      if (!code || !PEER_CODE_PATTERN.test(code)) {
        send(peer.socket, { type: 'bond-failed', reason: 'That code doesn\u2019t look right.' });
        return;
      }
      const result = registry.bond(peer, code);
      if ('error' in result) {
        send(peer.socket, { type: 'bond-failed', reason: result.error });
        return;
      }
      const { session } = result;
      send(session.initiator.socket, { type: 'bonded', role: 'initiator' });
      send(session.responder.socket, { type: 'bonded', role: 'responder' });
      return;
    }

    case 'unbond': {
      const session = peer.session;
      if (!session) return;
      const other = session.initiator === peer ? session.responder : session.initiator;
      registry.endSession(session);
      registry.register(peer);
      registry.register(other);
      send(peer.socket, { type: 'code', code: peer.code });
      send(other.socket, { type: 'peer-disconnected' });
      return;
    }

    case 'signal': {
      const other = peerOf(peer);
      if (!other) return;
      send(other.socket, { type: 'signal', payload: msg.payload });
      return;
    }

    case 'manifest': {
      const session = peer.session;
      const other = peerOf(peer);
      if (!session || !other) return;

      if (msg.fileCount < 1 || msg.fileCount > config.maxFiles) {
        notifyBothAndEnd(peer, registry, 'server', `Batches are limited to ${config.maxFiles} files.`);
        return;
      }
      if (msg.totalBytes < 0 || msg.totalBytes > config.maxTotalBytes) {
        notifyBothAndEnd(peer, registry, 'server', 'Transfer exceeds the 10 GB limit.');
        return;
      }

      session.fileCount = msg.fileCount;
      session.senderRole = session.initiator === peer ? 'initiator' : 'responder';
      send(other.socket, {
        type: 'manifest',
        fileCount: msg.fileCount,
        totalBytes: msg.totalBytes,
        fileSizes: msg.fileSizes,
      });
      return;
    }

    case 'receive-ready': {
      const other = peerOf(peer);
      if (other) send(other.socket, { type: 'ready-to-receive' });
      return;
    }

    case 'transfer-complete': {
      const other = peerOf(peer);
      if (other) send(other.socket, { type: 'transfer-complete' });
      if (peer.session) resetSessionByteCounters(peer);
      return;
    }

    case 'cancel': {
      const session = peer.session;
      if (!session) return;
      const other = session.initiator === peer ? session.responder : session.initiator;
      const by = session.senderRole === (session.initiator === peer ? 'initiator' : 'responder')
        ? 'sender'
        : 'receiver';
      send(other.socket, { type: 'cancelled', by, reason: msg.reason });
      resetSessionByteCounters(peer);
      return;
    }
  }
}

function peerOf(peer: Peer): Peer | null {
  const session = peer.session;
  if (!session) return null;
  return session.initiator === peer ? session.responder : session.initiator;
}

function resetSessionByteCounters(peer: Peer): void {
  const session = peer.session;
  if (!session) return;
  session.inflightBytes = 0;
  session.totalBytesRelayed = 0;
  session.fileCount = 0;
  session.senderRole = null;
}

function notifyBothAndEnd(
  peer: Peer,
  registry: PeerRegistry,
  by: 'server',
  reason: string,
): void {
  const session = peer.session;
  if (!session) return;
  for (const p of [session.initiator, session.responder]) {
    send(p.socket, { type: 'limit-exceeded', detail: reason });
    p.socket.close(4009, 'limit exceeded');
  }
  registry.endSession(session);
}
