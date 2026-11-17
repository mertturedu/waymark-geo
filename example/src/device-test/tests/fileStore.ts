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
