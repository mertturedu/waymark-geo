import { createHash, timingSafeEqual } from 'node:crypto';

export type ApiKey = { id: string; secret: string; rps?: number };

export type Guard = {
  authenticate(header: Record<string, string | string[] | undefined>): ApiKey | null;
  allow(id: string): number;
  failed(remote: string): boolean;
};

export const DEFAULT_RPS = 30;
export const BURST_SECONDS = 2;
export const FAIL_LIMIT = 10;
export const FAIL_WINDOW_MS = 60_000;
const MAX_TRACKED = 10_000;

const digest = (text: string): Buffer => createHash('sha256').update(text).digest();

export function createGuard(keys: readonly ApiKey[], now: () => number = Date.now): Guard {
  const hashed = keys.map((key) => ({ key, hash: digest(key.secret) }));
  const buckets = new Map<string, { tokens: number; at: number }>();
  const failures = new Map<string, { count: number; since: number }>();

  const tokenOf = (header: Record<string, string | string[] | undefined>): string => {
    const direct = header['x-api-key'];
    if (typeof direct === 'string') return direct;
    const auth = header.authorization;
    return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  };

  return {
    authenticate(header) {
      const token = tokenOf(header);
      if (token === '') return null;
      const given = digest(token);
      let found: ApiKey | null = null;
      for (const entry of hashed) if (timingSafeEqual(given, entry.hash)) found = entry.key;
      return found;
    },
    allow(id) {
      const key = keys.find((k) => k.id === id);
      const rate = key?.rps ?? DEFAULT_RPS;
      const capacity = rate * BURST_SECONDS;
      const t = now();
      const bucket = buckets.get(id) ?? { tokens: capacity, at: t };
      bucket.tokens = Math.min(capacity, bucket.tokens + ((t - bucket.at) / 1000) * rate);
      bucket.at = t;
      buckets.set(id, bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return 0;
      }
      return Math.ceil((1 - bucket.tokens) / rate);
    },
    failed(remote) {
      const t = now();
      if (failures.size > MAX_TRACKED) failures.clear();
      const known = failures.get(remote);
      const entry = known && t - known.since < FAIL_WINDOW_MS ? known : { count: 0, since: t };
      entry.count += 1;
      failures.set(remote, entry);
      return entry.count > FAIL_LIMIT;
    },
  };
}
