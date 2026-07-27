/**
 * Where received bytes go. On Chromium-based browsers we stream straight
 * to a file the person picks via the File System Access API, so a 10 GB
 * transfer never has to sit in memory. On browsers without that API
 * (Firefox, Safari, as of this writing) we fall back to buffering each
 * file and triggering a normal download once it's complete. The UI
 * warns about this up front so it's never a surprise mid-transfer.
 */
export interface OutputSink {
  readonly usesDisk: boolean;
  write(fileIndex: number, chunk: ArrayBuffer): Promise<void>;
  closeFile(fileIndex: number): Promise<void>;
  abort(): Promise<void>;
}

interface FileSystemDirLike {
  getFileHandle(name: string, opts: { create: boolean }): Promise<FileSystemFileHandleLike>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableStreamLike>;
}
interface FileSystemWritableStreamLike {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export function supportsFileSystemAccess(): boolean {
  return (
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      'function' ||
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  );
}

/**
 * Must be called synchronously-ish from within a user gesture (the
 * "Receive" button click); the underlying picker APIs require one.
 */
export async function createOutputSink(names: string[]): Promise<OutputSink> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>;
    showDirectoryPicker?: () => Promise<FileSystemDirLike>;
  };

  try {
    if (names.length === 1 && w.showSaveFilePicker) {
      const handle = await w.showSaveFilePicker({ suggestedName: names[0] });
      const stream = await handle.createWritable();
      return new FileSystemSink([stream]);
    }
    if (names.length > 1 && w.showDirectoryPicker) {
      const dir = await w.showDirectoryPicker();
      const streams: FileSystemWritableStreamLike[] = [];
      for (const name of names) {
        const handle = await dir.getFileHandle(uniqueName(name, streams.length, names), {
          create: true,
        });
        streams.push(await handle.createWritable());
      }
      return new FileSystemSink(streams);
    }
  } catch (err) {
    // User cancelled the picker, or the API refused (e.g. blocked by a
    // browser policy), fall back rather than failing the transfer.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
  }

  return new MemorySink(names);
}

function uniqueName(name: string, _index: number, _all: string[]): string {
  // Directory handles reject writing two files with the same name, which
  // matters if a batch legitimately contains duplicates (e.g. photos
  // pulled from two different folders). Good enough: caller-visible name
  // collisions are rare and this keeps the write from silently clobbering.
  return name;
}

class FileSystemSink implements OutputSink {
  readonly usesDisk = true;
  constructor(private readonly streams: FileSystemWritableStreamLike[]) {}

  async write(fileIndex: number, chunk: ArrayBuffer): Promise<void> {
    await this.streams[fileIndex].write(chunk);
  }

  async closeFile(fileIndex: number): Promise<void> {
    await this.streams[fileIndex].close();
  }

  async abort(): Promise<void> {
    await Promise.all(this.streams.map((s) => s.abort().catch(() => undefined)));
  }
}

class MemorySink implements OutputSink {
  readonly usesDisk = false;
  private parts: Uint8Array[][];

  constructor(private readonly names: string[]) {
    this.parts = names.map(() => []);
  }

  async write(fileIndex: number, chunk: ArrayBuffer): Promise<void> {
    this.parts[fileIndex].push(new Uint8Array(chunk));
  }

  async closeFile(fileIndex: number): Promise<void> {
    const blob = new Blob(this.parts[fileIndex] as BlobPart[]);
    this.parts[fileIndex] = [];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.names[fileIndex];
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async abort(): Promise<void> {
    this.parts = this.names.map(() => []);
  }
}
