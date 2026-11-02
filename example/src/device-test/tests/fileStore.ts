import { File, FileMode, type FileHandle } from 'expo-file-system';
import type { Store } from '../../../../scripts/spikes/resume-download';

export class FileStore implements Store {
  private handle: FileHandle | null = null;
  private length: number;

  constructor(readonly file: File) {
    if (!file.exists) file.create({ intermediates: true });
    this.length = file.size;
  }

  private open(): FileHandle {
    if (!this.handle) this.handle = this.file.open(FileMode.ReadWrite);
    return this.handle;
  }

  async size(): Promise<number> {
    return this.length;
  }

  async append(chunk: Uint8Array): Promise<void> {
    const handle = this.open();
    handle.offset = this.length;
    handle.writeBytes(chunk);
    this.length += chunk.length;
  }

  async truncate(): Promise<void> {
    this.close();
    if (this.file.exists) this.file.delete();
    this.file.create({ intermediates: true });
    this.length = 0;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const handle = this.open();
    handle.offset = offset;
    return handle.readBytes(length);
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
  }
}

export class CuttingStore implements Store {
  private cut = false;
  private written = 0;

  constructor(
    private readonly inner: Store,
    private readonly failAfterBytes: number,
  ) {}

  get interrupted(): boolean {
    return this.cut;
  }

  size() {
    return this.inner.size();
  }

  async append(chunk: Uint8Array): Promise<void> {
    this.written += chunk.length;
    if (!this.cut && this.written > this.failAfterBytes) {
      this.cut = true;
      throw new Error('simulated connection reset');
    }
    await this.inner.append(chunk);
  }

  truncate() {
    return this.inner.truncate();
  }

  read(offset: number, length: number) {
    return this.inner.read(offset, length);
  }
}
