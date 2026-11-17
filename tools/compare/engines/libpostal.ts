import { cached } from '../cache';
import { type Engine, type Parts } from '../types';

const ROLES: Record<string, keyof Parts> = { road: 'street', city_district: 'district', city: 'province', suburb: 'hood', level: 'floor', unit: 'door', house: 'place', state: 'province', state_district: 'district' };

const clean = (value: string): string => value.replace(/̇/g, '').trim();

export function libpostal(base = 'http://127.0.0.1:8087'): Engine {
  return {
    name: 'libpostal',
    query: (text) =>
      cached('libpostal', text, async () => {
        const started = performance.now();
        const response = await fetch(`${base}/parse?${new URLSearchParams({ q: text })}`);
        const pairs = (await response.json()) as [string, string][];
        const parts: Parts = {};
        for (const [value, role] of pairs) {
          if (role === 'house_number') {
            const digits = clean(value).replace(/^no\.?\s*/i, '');
            if (/^\d/.test(digits) && parts.number === undefined) parts.number = digits;
            continue;
          }
          const key = ROLES[role];
          if (key && parts[key] === undefined) parts[key] = clean(value);
        }
        return { found: true, point: null, level: 'none', parts, ms: performance.now() - started };
      }),
  };
}
