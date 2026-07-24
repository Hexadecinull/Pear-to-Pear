import {
  CHUNK_SIZE,
  CHUNK_HEADER_BYTES,
  encodeChunkHeader,
  decodeChunkHeader,
} from './protocol';
import type { DataChannelLike } from './channel';
import type { SecureChannel } from './crypto';
import { liveConnection, appState } from './stores';
import { getSignaling } from './session';
import { createOutputSink, type OutputSink } from './fileWriter';
import { formatBytes } from './format';

/** Reserved fileIndex that marks a frame as the encrypted filename
 *  manifest rather than real file bytes. Real files are indexed 0..499. */
const MANIFEST_FRAME_INDEX = 0xffff;
const BUFFER_HIGH_WATER = 1 << 20; // 1 MiB
const BUFFER_POLL_MS = 15;

// --- Receiver-side state, alive for the lifetime of one bonded session ---
let pendingNames: string[] | null = null;
let expectedSizes: number[] = [];
let sink: OutputSink | null = null;
let manifestListenerAttached = false;
let cancelledFlag = false;

export function resetTransferState(): void {
  pendingNames = null;
  expectedSizes = [];
  sink = null;
  cancelledFlag = false;
}

/** Call once, right after a channel becomes ready. Safe to call from
 *  either bonded peer — whoever didn't initiate a send will use this to
 *  detect and surface an incoming one. Also safe to call again after a
 *  re-bond: the signaling listener attaches only once for the lifetime
 *  of the page, but the channel message handler is rebound every time
 *  because a fresh channel object is created on every bond. */
export function setupIncomingTransferListener(): void {
  if (!manifestListenerAttached) {
    manifestListenerAttached = true;
    const signaling = getSignaling();
    signaling?.on('manifest', (msg) => {
      expectedSizes = msg.fileSizes;
      pendingNames = null;
      appState.update((s) => ({
        ...s,
        transfer: {
          role: 'receiver',
          phase: 'awaiting-peer',
          files: msg.fileSizes.map((size) => ({ name: 'Untitled file', size, bytesDone: 0 })),
          activeFileIndex: -1,
          totalBytes: msg.totalBytes,
          bytesDone: 0,
          startedAt: null,
          error: null,
        },
      }));
    });

    signaling?.on('cancelled', (msg) => {
      cancelledFlag = true;
      void sink?.abort();
      appState.update((s) => ({
        ...s,
        transfer: { ...s.transfer, phase: 'cancelled', error: msg.reason ?? null },
      }));
    });

    signaling?.on('transfer-complete', () => {
      appState.update((s) =>
        s.transfer.role === 'receiver' ? { ...s, transfer: { ...s.transfer, phase: 'done' } } : s,
      );
    });
  }

  liveConnection.channel?.onMessage((frame) => void handleIncomingFrame(frame));
}

async function handleIncomingFrame(frame: ArrayBuffer): Promise<void> {
  const secure = liveConnection.secure;
  if (!secure) return;

  const header = decodeChunkHeader(frame);
  const payload = frame.slice(CHUNK_HEADER_BYTES);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await secure.decrypt(payload);
  } catch {
    appState.update((s) => ({
      ...s,
      transfer: { ...s.transfer, phase: 'error', error: 'A chunk failed integrity verification and was rejected.' },
    }));
    return;
  }

  if (header.fileIndex === MANIFEST_FRAME_INDEX) {
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { names: string[] };
    pendingNames = parsed.names;
    appState.update((s) => ({
      ...s,
      transfer: {
        ...s.transfer,
        files: s.transfer.files.map((f, i) => ({ ...f, name: parsed.names[i] ?? f.name })),
      },
    }));
    return;
  }

  if (!sink) return; // chunk arrived before the receiver accepted — drop it

  await sink.write(header.fileIndex, plaintext);
  appState.update((s) => {
    const files = s.transfer.files.slice();
    const f = files[header.fileIndex];
    if (f) files[header.fileIndex] = { ...f, bytesDone: f.bytesDone + plaintext.byteLength };
    return {
      ...s,
      transfer: {
        ...s.transfer,
        files,
        bytesDone: s.transfer.bytesDone + plaintext.byteLength,
        activeFileIndex: header.fileIndex,
      },
    };
  });

  if (header.isLastChunkOfFile) {
    await sink.closeFile(header.fileIndex);
    appState.update((s) => {
      const allDone = s.transfer.bytesDone >= s.transfer.totalBytes;
      return { ...s, transfer: { ...s.transfer, phase: allDone ? 'done' : s.transfer.phase } };
    });
  }
}

/** Called from the "Receive" button. Must run inside the click's call
 *  stack (before any `await`) so the save-location picker still counts
 *  as triggered by a user gesture. */
export async function acceptIncoming(): Promise<void> {
  const signaling = getSignaling();
  if (!signaling) return;

  const names = pendingNames ?? expectedSizes.map((_, i) => `file-${i + 1}`);
  try {
    sink = await createOutputSink(names);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'idle' } }));
      return;
    }
    appState.update((s) => ({
      ...s,
      transfer: { ...s.transfer, phase: 'error', error: 'Could not prepare a place to save the files.' },
    }));
    return;
  }

  appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'transferring', startedAt: Date.now() } }));
  signaling.send({ type: 'receive-ready' });
}

export function declineIncoming(): void {
  getSignaling()?.send({ type: 'cancel', reason: 'Receiver declined the transfer.' });
  resetTransferState();
  appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'idle', role: null } }));
}

// ------------------------------- Sender -------------------------------

export function validateSelection(files: File[]): { ok: true } | { ok: false; error: string } {
  const limits = getSignaling()?.limits;
  const maxFiles = limits?.maxFiles ?? 500;
  const maxTotalBytes = limits?.maxTotalBytes ?? 10 * 1024 ** 3;

  if (files.length === 0) return { ok: false, error: 'Choose at least one file.' };
  if (files.length > maxFiles) return { ok: false, error: `You can send at most ${maxFiles} files at once.` };

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > maxTotalBytes) {
    return { ok: false, error: `That batch is ${formatBytes(total)} — the limit is ${formatBytes(maxTotalBytes)}.` };
  }
  return { ok: true };
}

export async function sendFiles(files: File[]): Promise<void> {
  const channel = liveConnection.channel;
  const secure = liveConnection.secure;
  const signaling = getSignaling();
  if (!channel || !secure || !signaling) {
    appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'error', error: 'Not connected to a peer.' } }));
    return;
  }

  const validation = validateSelection(files);
  if (!validation.ok) {
    appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'error', error: validation.error } }));
    return;
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  cancelledFlag = false;
  appState.update((s) => ({
    ...s,
    transfer: {
      role: 'sender',
      phase: 'awaiting-peer',
      files: files.map((f) => ({ name: f.name, size: f.size, bytesDone: 0 })),
      activeFileIndex: 0,
      totalBytes,
      bytesDone: 0,
      startedAt: null,
      error: null,
    },
  }));

  signaling.send({
    type: 'manifest',
    fileCount: files.length,
    totalBytes,
    fileSizes: files.map((f) => f.size),
  });

  const namesPayload = new TextEncoder().encode(
    JSON.stringify({ names: files.map((f) => f.name) }),
  ).buffer;
  await sendFrame(channel, secure, MANIFEST_FRAME_INDEX, 0, true, namesPayload);

  const cancelledEarly = await Promise.race([
    waitForEvent(signaling, 'ready-to-receive').then(() => false),
    waitForEvent(signaling, 'cancelled').then(() => true),
  ]);
  if (cancelledEarly) {
    appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'cancelled' } }));
    return;
  }

  appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'transferring', startedAt: Date.now() } }));

  fileLoop: for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    let offset = 0;
    let chunkIndex = 0;

    for (;;) {
      if (cancelledFlag) break fileLoop;
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const slice = await file.slice(offset, end).arrayBuffer();
      const isLast = end >= file.size;

      await sendFrame(channel, secure, fileIndex, chunkIndex, isLast, slice);
      if (cancelledFlag) break fileLoop;

      offset = end;
      chunkIndex++;
      const bytesThisSlice = slice.byteLength;
      appState.update((s) => {
        const filesProgress = s.transfer.files.slice();
        const f = filesProgress[fileIndex];
        if (f) filesProgress[fileIndex] = { ...f, bytesDone: f.bytesDone + bytesThisSlice };
        return {
          ...s,
          transfer: {
            ...s.transfer,
            files: filesProgress,
            bytesDone: s.transfer.bytesDone + bytesThisSlice,
            activeFileIndex: fileIndex,
          },
        };
      });

      if (isLast) break;
    }
  }

  if (cancelledFlag) return;

  signaling.send({ type: 'transfer-complete' });
  appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'done' } }));
}

export function cancelActiveTransfer(reason: string): void {
  getSignaling()?.send({ type: 'cancel', reason });
  resetTransferState();
  appState.update((s) => ({ ...s, transfer: { ...s.transfer, phase: 'cancelled' } }));
}

/** Clears a finished/cancelled/errored transfer back to the idle picker
 *  view without leaving the bond. */
export function returnToIdle(): void {
  resetTransferState();
  appState.update((s) => ({
    ...s,
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

async function sendFrame(
  channel: DataChannelLike,
  secure: SecureChannel,
  fileIndex: number,
  chunkIndex: number,
  isLast: boolean,
  plaintext: ArrayBuffer,
): Promise<void> {
  await waitForBufferLow(channel);
  const header = encodeChunkHeader({ fileIndex, chunkIndex, isLastChunkOfFile: isLast });
  const ciphertext = await secure.encrypt(plaintext);
  const frame = new Uint8Array(header.byteLength + ciphertext.byteLength);
  frame.set(header, 0);
  frame.set(new Uint8Array(ciphertext), header.byteLength);
  channel.send(frame.buffer);
}

function waitForBufferLow(channel: DataChannelLike): Promise<void> {
  if (channel.bufferedAmount <= BUFFER_HIGH_WATER) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (channel.bufferedAmount <= BUFFER_HIGH_WATER) resolve();
      else setTimeout(check, BUFFER_POLL_MS);
    };
    check();
  });
}

function waitForEvent<K extends 'ready-to-receive' | 'cancelled'>(
  signaling: NonNullable<ReturnType<typeof getSignaling>>,
  type: K,
): Promise<void> {
  return new Promise((resolve) => {
    const unsub = signaling.on(type, () => {
      unsub();
      resolve();
    });
  });
}
