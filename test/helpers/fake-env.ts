import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { ClockPort, ConnectionKind, ConnectivityPort, FsPort, HashPort, NetPort, NetResponse } from '../../src/core/packs/ports';
import { packError } from '../../src/core/packs/types';

export type Effect =
  | { kind: 'cut'; afterBytes: number }
  | { kind: 'status'; status: number }
  | { kind: 'no-range' }
  | { kind: 'offline' }
  | { kind: 'body'; bytes: Uint8Array };

export type Rule = { effect: Effect; times?: number; match?: (url: string) => boolean };

export type FakeEnv = {
  fs: FsPort & { files: Map<string, Uint8Array>; used(): number };
  net: NetPort;
  hash: HashPort;
  clock: ClockPort & { advance(ms: number): void };
  connectivity: ConnectivityPort & { set(kind: ConnectionKind): void };
  server: { put(url: string, bytes: Uint8Array): void; inject(rule: Rule): void; clear(): void; log: { url: string; rangeStart: number | null; signal?: AbortSignal }[] };
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export function createFakeEnv(options: { capacity?: number } = {}): FakeEnv {
  const capacity = options.capacity ?? Number.MAX_SAFE_INTEGER;
  const files = new Map<string, Uint8Array>();
  const used = (): number => {
    let total = 0;
    for (const bytes of files.values()) total += bytes.length;
    return total;
  };
  const fs: FakeEnv['fs'] = {
    files,
    used,
    async exists(path) {
      return files.has(path);
    },
    async size(path) {
      return files.get(path)?.length ?? null;
    },
    async read(path, offset, length) {
      const bytes = files.get(path);
      if (!bytes) throw packError('storage', `missing ${path}`);
      return bytes.slice(offset, offset + length);
    },
    async readText(path) {
      const bytes = files.get(path);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    async append(path, chunk) {
      const old = files.get(path) ?? new Uint8Array(0);
      if (used() + chunk.length > capacity) throw packError('no-space');
      const next = new Uint8Array(old.length + chunk.length);
      next.set(old);
      next.set(chunk, old.length);
      files.set(path, next);
    },
    async truncate(path) {
      files.set(path, new Uint8Array(0));
    },
    async writeAtomic(path, text) {
      const bytes = encode(text);
      const old = files.get(path)?.length ?? 0;
      if (used() - old + bytes.length > capacity) throw packError('no-space');
      files.set(path, bytes);
    },
    async move(from, to) {
      const bytes = files.get(from);
      if (!bytes) throw packError('storage', `missing ${from}`);
      files.set(to, bytes);
      files.delete(from);
    },
    async remove(path) {
      files.delete(path);
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((p) => p.startsWith(prefix));
    },
    async freeBytes() {
      return capacity - used();
    },
  };

  const served = new Map<string, Uint8Array>();
  const rules: Rule[] = [];
  const log: { url: string; rangeStart: number | null; signal?: AbortSignal }[] = [];

  const takeRule = (url: string): Effect | null => {
    for (const rule of rules) {
      if (rule.times !== undefined && rule.times <= 0) continue;
      if (rule.match && !rule.match(url)) continue;
      if (rule.times !== undefined) rule.times -= 1;
      return rule.effect;
    }
    return null;
  };

  async function* chunks(bytes: Uint8Array, cutAfter: number | null): AsyncGenerator<Uint8Array> {
    const step = 16 * 1024;
    let sent = 0;
    for (let at = 0; at < bytes.length; at += step) {
      const piece = bytes.slice(at, at + step);
      if (cutAfter !== null && sent + piece.length > cutAfter) {
        const rest = cutAfter - sent;
        if (rest > 0) yield piece.slice(0, rest);
        throw new Error('connection reset');
      }
      sent += piece.length;
      yield piece;
    }
    if (cutAfter !== null && cutAfter >= bytes.length) throw new Error('connection reset');
  }

  const net: NetPort = {
    async get(url, requestOptions = {}) {
      const rangeStart = requestOptions.rangeStart ?? null;
      log.push({ url, rangeStart, ...(requestOptions.signal ? { signal: requestOptions.signal } : {}) });
      const effect = takeRule(url);
      if (effect?.kind === 'offline') throw new Error('network down');
      if (effect?.kind === 'status') return { status: effect.status, body: chunks(new Uint8Array(0), null) } satisfies NetResponse;
      const content = effect?.kind === 'body' ? effect.bytes : served.get(url);
      if (!content) return { status: 404, body: chunks(new Uint8Array(0), null) };
      const honour = effect?.kind !== 'no-range' && rangeStart !== null;
      if (honour && rangeStart > content.length) return { status: 416, body: chunks(new Uint8Array(0), null) };
      const slice = honour ? content.slice(rangeStart) : content;
      return { status: honour ? 206 : 200, body: chunks(slice, effect?.kind === 'cut' ? effect.afterBytes : null) };
    },
    async getText(url) {
      log.push({ url, rangeStart: null });
      const effect = takeRule(url);
      if (effect?.kind === 'offline') throw new Error('network down');
      if (effect?.kind === 'status') return { status: effect.status, text: '' };
      const content = effect?.kind === 'body' ? effect.bytes : served.get(url);
      if (!content) return { status: 404, text: '' };
      return { status: 200, text: new TextDecoder().decode(content) };
    },
  };

  const hash: HashPort = {
    async sha256File(path) {
      const bytes = files.get(path);
      if (!bytes) throw packError('storage', `missing ${path}`);
      return bytesToHex(sha256(bytes));
    },
  };

  let time = 1_700_000_000_000;
  const clock: FakeEnv['clock'] = {
    now: () => time,
    async sleep(ms) {
      time += ms;
    },
    advance(ms) {
      time += ms;
    },
  };

  let kind: ConnectionKind = 'wifi';
  const listeners = new Set<(kind: ConnectionKind) => void>();
  const connectivity: FakeEnv['connectivity'] = {
    async kind() {
      return kind;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      kind = next;
      for (const listener of listeners) listener(next);
    },
  };

  return {
    fs,
    net,
    hash,
    clock,
    connectivity,
    server: {
      put: (url, bytes) => void served.set(url, bytes),
      inject: (rule) => void rules.push({ ...rule }),
      clear: () => void (rules.length = 0),
      log,
    },
  };
}
