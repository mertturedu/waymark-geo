export type FsPort = {
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number | null>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  readText(path: string): Promise<string | null>;
  append(path: string, bytes: Uint8Array): Promise<void>;
  truncate(path: string): Promise<void>;
  writeAtomic(path: string, text: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  freeBytes(): Promise<number>;
};

export type NetResponse = { status: number; body: AsyncIterable<Uint8Array> };

export type NetPort = {
  get(url: string, options?: { rangeStart?: number; signal?: AbortSignal }): Promise<NetResponse>;
  getText(url: string, options?: { signal?: AbortSignal }): Promise<{ status: number; text: string }>;
};

export type HashPort = {
  sha256File(path: string): Promise<string>;
  sha256Blocks?(path: string, blockSize: number): Promise<string[]>;
};

export type ClockPort = { now(): number; sleep(ms: number): Promise<void> };

export type ConnectionKind = 'wifi' | 'cellular' | 'none';

export type ConnectivityPort = {
  kind(): Promise<ConnectionKind>;
  onChange?(listener: (kind: ConnectionKind) => void): () => void;
};
