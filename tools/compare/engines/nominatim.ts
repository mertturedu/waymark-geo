import { cached } from '../cache';
import { NONE, type Engine, type EngineResult, type Level } from '../types';

type Hit = { lat: string; lon: string; addresstype?: string; address?: Record<string, string> };

const LEVELS: Record<string, Level> = {
  house: 'building', building: 'building', residential: 'street', road: 'street', street: 'street',
  suburb: 'hood', neighbourhood: 'hood', quarter: 'hood', city_district: 'district', county: 'district',
  town: 'district', municipality: 'district', state: 'province', city: 'province', province: 'province',
};

export function nominatim(base = 'http://127.0.0.1:8088'): Engine {
  const run = async (url: string): Promise<EngineResult> => {
    const started = performance.now();
    const response = await fetch(url);
    if (!response.ok) return { ...NONE, ms: performance.now() - started };
    const hits = (await response.json()) as Hit[];
    const ms = performance.now() - started;
    const hit = hits[0];
    if (!hit) return { ...NONE, ms };
    const a = hit.address ?? {};
    return {
      found: true,
      point: [Number(hit.lon), Number(hit.lat)],
      level: a.house_number ? 'building' : (LEVELS[hit.addresstype ?? ''] ?? 'street'),
      parts: {
        province: a.state ?? a.province,
        district: a.county ?? a.city_district ?? a.town,
        hood: a.suburb ?? a.neighbourhood ?? a.quarter,
        street: a.road,
        number: a.house_number,
      },
      ms,
    };
  };
  return {
    name: 'nominatim',
    query: (text) => cached('nominatim', text, () => run(`${base}/search?${new URLSearchParams({ q: text, format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'tr', 'accept-language': 'tr' })}`)),
  };
}

export type StructuredParts = { street?: string; county?: string; city?: string };

export function nominatimStructured(base = 'http://127.0.0.1:8088') {
  return async (parts: StructuredParts): Promise<EngineResult> => {
    const params: Record<string, string> = { format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'tr', 'accept-language': 'tr' };
    for (const [k, v] of Object.entries(parts)) if (v) params[k] = v;
    const key = `S:${JSON.stringify(parts)}`;
    return cached('nominatim', key, async () => {
      const started = performance.now();
      const response = await fetch(`${base}/search?${new URLSearchParams(params)}`);
      const hits = response.ok ? ((await response.json()) as Hit[]) : [];
      const hit = hits[0];
      const ms = performance.now() - started;
      if (!hit) return { ...NONE, ms };
      const a = hit.address ?? {};
      return { found: true, point: [Number(hit.lon), Number(hit.lat)], level: a.house_number ? 'building' : 'street', parts: { street: a.road, number: a.house_number }, ms };
    });
  };
}
