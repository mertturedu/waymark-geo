import type { Search } from '../../../src/core/address/search';
import type { Place, Precision } from '../../../src/core/address/types';
import { parseAddress } from '../../../src/core/text';
import { NONE, type Engine, type Level } from '../types';

const LEVELS: Record<Precision, Level> = { address: 'building', interpolated: 'building', street: 'street', neighbourhood: 'hood', district: 'district', province: 'province', poi: 'building' };

export function sdk(search: Search, hints?: { city?: string }): Engine {
  return {
    name: 'sdk',
    async query(text) {
      const started = performance.now();
      const result = await search.resolve(text, hints ? { hints } : {});
      const ms = performance.now() - started;
      const best: Place | undefined = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      if (!best) return { ...NONE, ms };
      const c = best.components;
      const parsed = parseAddress(text);
      return {
        found: true,
        point: best.coordinate,
        level: LEVELS[best.precision],
        parts: { province: c.province, district: c.district, hood: c.neighbourhood, street: c.street, number: c.houseNumber, block: parsed.block ?? undefined, floor: parsed.floor ?? undefined, door: parsed.door ?? undefined, place: c.poiName },
        ms,
      };
    },
  };
}
