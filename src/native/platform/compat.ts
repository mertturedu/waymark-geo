export type ByteHandle = {
  offset: number | null;
  readBytes(length: number): Uint8Array | Promise<Uint8Array>;
  writeBytes(bytes: Uint8Array): void | Promise<void>;
  readBytesSync?: (length: number) => Uint8Array;
  writeBytesSync?: (bytes: Uint8Array) => void;
};

export async function readBytes(handle: ByteHandle, length: number): Promise<Uint8Array> {
  if (typeof handle.readBytesSync === 'function') return handle.readBytesSync(length);
  return await handle.readBytes(length);
}

export async function writeBytes(handle: ByteHandle, bytes: Uint8Array): Promise<void> {
  if (typeof handle.writeBytesSync === 'function') {
    handle.writeBytesSync(bytes);
    return;
  }
  await handle.writeBytes(bytes);
}
