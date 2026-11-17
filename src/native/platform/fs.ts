import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import type { FsPort } from '../../core/packs/ports';
import { isPackError, packError } from '../../core/packs/types';
import { readBytes, writeBytes, type ByteHandle } from './compat';

const YIELD_EVERY_BYTES = 1024 * 1024;

type Writer = { handle: FileHandle; length: number };

export function createExpoFs(root: Directory): FsPort {
  const writers = new Map<string, Writer>();
  let sinceYield = 0;

  const fileAt = (path: string): File => new File(root, path);

  const release = (path: string): void => {
    const writer = writers.get(path);
    if (!writer) return;
    writers.delete(path);
    writer.handle.close();
  };

  const ensureParent = (file: File): void => {
    const parent = file.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
  };

  const walk = (dir: Directory, out: string[]): void => {
    for (const entry of dir.list()) {
      if (entry instanceof Directory) walk(entry, out);
      else out.push(decodeURI(entry.uri.slice(root.uri.length)));
    }
  };

  return {
    async exists(path) {
      return fileAt(path).exists;
    },
    async size(path) {
      const writer = writers.get(path);
      if (writer) return writer.length;
      const file = fileAt(path);
      return file.exists ? file.size : null;
    },
    async read(path, offset, length) {
      release(path);
      const file = fileAt(path);
      if (!file.exists) throw packError('storage', `missing: ${path}`);
      const handle = file.open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return await readBytes(handle as unknown as ByteHandle, length);
      } catch (error) {
        throw isPackError(error) ? error : packError('storage', error instanceof Error ? error.message : String(error));
      } finally {
        handle.close();
      }
    },
    async readText(path) {
      release(path);
      const file = fileAt(path);
      return file.exists ? file.text() : null;
    },
    async append(path, bytes) {
      let writer = writers.get(path);
      try {
        if (!writer) {
          const file = fileAt(path);
          ensureParent(file);
          if (!file.exists) file.create({ intermediates: true });
          writer = { handle: file.open(FileMode.ReadWrite), length: file.size };
          writers.set(path, writer);
        }
        writer.handle.offset = writer.length;
        await writeBytes(writer.handle as unknown as ByteHandle, bytes);
        writer.length += bytes.length;
      } catch (error) {
        release(path);
        if (Paths.availableDiskSpace < bytes.length * 2) throw packError('no-space');
        throw packError('storage', error instanceof Error ? error.message : String(error));
      }
      sinceYield += bytes.length;
      if (sinceYield >= YIELD_EVERY_BYTES) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    },
    async truncate(path) {
      release(path);
      const file = fileAt(path);
      ensureParent(file);
      if (file.exists) file.delete();
      file.create({ intermediates: true });
    },
    async writeAtomic(path, text) {
      release(path);
      const target = fileAt(path);
      ensureParent(target);
      const temporary = fileAt(`${path}.tmp`);
      if (temporary.exists) temporary.delete();
      temporary.create({ intermediates: true });
      try {
        temporary.write(text);
      } catch (error) {
        temporary.delete();
        if (Paths.availableDiskSpace < text.length * 3) throw packError('no-space');
        throw packError('storage', error instanceof Error ? error.message : String(error));
      }
      await temporary.move(target, { overwrite: true });
    },
    async move(from, to) {
      release(from);
      release(to);
      const source = fileAt(from);
      const target = fileAt(to);
      ensureParent(target);
      await source.move(target, { overwrite: true });
    },
    async remove(path) {
      release(path);
      const file = fileAt(path);
      if (file.exists) file.delete();
    },
    async list(dir) {
      const directory = new Directory(root, dir);
      if (!directory.exists) return [];
      const out: string[] = [];
      walk(directory, out);
      return out.sort();
    },
    async freeBytes() {
      return Paths.availableDiskSpace;
    },
  };
}
