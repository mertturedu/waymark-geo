import { DatabaseSync } from 'node:sqlite';
import type { Place, StructuredQuery } from '../../src/core/address/types';
import type { Search } from '../../src/core/address/search';
import type { LngLat } from '../../src/core/geo/cells';
import { distanceM } from '../../src/core/geo/distance';
import type { Learning } from '../../src/core/learn/learning';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { provinceName } from '../../src/core/text/admin';
import type { DoorRow } from './hide';
import { deliveryNoise, pinNoise } from './noise';
import { shuffle, type Rand } from './random';
import { openSqlite } from '../../src/node/sqlite';

export type SimTarget = { door: DoorRow; plate: string; truth: LngLat; query: StructuredQuery; district: string; neighbourhood: string | null; street: string };
export type Probe = { place: Place; errorM: number };

const names = (db: DatabaseSync, table: 'street_name' | 'district' | 'neighbourhood'): Map<number, string> =>
  new Map((db.prepare(`SELECT id, name FROM ${table}`).all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));

export function targetsOf(file: string, plate: string, hidden: readonly DoorRow[], limit: number, rand: Rand): SimTarget[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const streets = names(db, 'street_name');
    const districts = names(db, 'district');
    const hoods = names(db, 'neighbourhood');
    const province = provinceName(plate) ?? plate;
    return shuffle(hidden, rand)
      .slice(0, Math.max(0, limit))
      .map((door) => {
        const street = streets.get(door.streetId) as string;
        const district = districts.get(door.districtId) as string;
        const neighbourhood = door.hoodId === null ? null : (hoods.get(door.hoodId) ?? null);
        const query: StructuredQuery = { province, district, ...(neighbourhood ? { neighbourhood } : {}), street, houseNumber: door.number };
        return { door, plate, truth: [door.lng, door.lat] as LngLat, query, district, neighbourhood, street };
      });
  } finally {
    db.close();
  }
}

export function simStore(base: PackStore, plate: string, file: string): PackStore {
  return {
    installed: async () => [plate],
    open: async (region: string): Promise<SqlDb | null> => (region === plate ? openSqlite(file) : null),
    openPart: base.openPart ? (region, kind) => (region === plate ? (base.openPart as NonNullable<PackStore['openPart']>)(region, kind) : Promise.resolve(null)) : undefined,
  };
}

export async function probe(search: Search, target: SimTarget): Promise<Probe | null> {
  const result = await search.resolve(target.query, { limit: 10 });
  if (result.status !== 'resolved' && result.status !== 'ambiguous') return null;
  const place = result.candidates.find((p) => p.components.district === target.district && p.components.street === target.street && (target.neighbourhood === null || p.components.neighbourhood === target.neighbourhood));
  return place ? { place, errorM: distanceM(target.truth, place.coordinate) } : null;
}

export async function confirmTarget(learning: Learning, place: Place, target: SimTarget, kind: 'delivery' | 'pin', rand: Rand, count: number, options: { outliers?: boolean } = {}): Promise<number> {
  let accepted = 0;
  for (let i = 0; i < count; i++) {
    const noisy = kind === 'pin' ? pinNoise(rand, target.truth) : deliveryNoise(rand, target.truth, options);
    const result = await learning.confirm({ place, houseNumber: target.door.number, point: noisy.point, source: kind, accuracyM: noisy.accuracyM });
    if (result.ok) accepted++;
  }
  return accepted;
}
