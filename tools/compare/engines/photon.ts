import { cached } from '../cache';
import { NONE, type Engine, type Level } from '../types';

type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> };

const LEVELS: Record<string, Level> = { house: 'building', street: 'street', locality: 'hood', district: 'district', city: 'district', county: 'district', state: 'province' };

export function photon(base = 'http://127.0.0.1:2322'): Engine {
  return {
    name: 'photon',
    query: (text) =>
      cached('photon', text, async () => {
        const started = performance.now();
        const response = await fetch(`${base}/api?${new URLSearchParams({ q: text, limit: '1', lang: 'default' })}`);
        const ms = performance.now() - started;
        if (!response.ok) return { ...NONE, ms };
        const feature = ((await response.json()) as { features: Feature[] }).features[0];
        if (!feature) return { ...NONE, ms };
        const p = feature.properties;
        return {
          found: true,
          point: feature.geometry.coordinates,
          level: p.housenumber ? 'building' : (LEVELS[p.type ?? ''] ?? 'street'),
          parts: { province: p.state, district: p.city ?? p.county, hood: p.district, street: p.street ?? (p.type === 'street' ? p.name : undefined), number: p.housenumber, place: p.type === 'house' || p.type === 'street' ? undefined : p.name },
          ms,
        };
      }),
  };
}
