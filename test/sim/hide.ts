import { copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Rand } from './random';
import { shuffle } from './random';

export type DoorRow = { id: number; streetId: number; districtId: number; hoodId: number | null; number: string; nkey: string; num: number | null; parity: number | null; lng: number; lat: number };

const CHUNK = 500;

export function readDoors(file: string): DoorRow[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, street_id, district_id, hood_id, number, nkey, num, parity, lon, lat FROM address WHERE street_id IS NOT NULL ORDER BY id').all() as {
      id: number; street_id: number; district_id: number; hood_id: number | null; number: string; nkey: string; num: number | null; parity: number | null; lon: number; lat: number;
    }[];
    return rows.map((r) => ({ id: r.id, streetId: r.street_id, districtId: r.district_id, hoodId: r.hood_id, number: r.number, nkey: r.nkey, num: r.num, parity: r.parity, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
  } finally {
    db.close();
  }
}

export function chooseHidden(doors: readonly DoorRow[], fraction: number, rand: Rand): Set<number> {
  const count = Math.min(doors.length, Math.max(0, Math.round(doors.length * fraction)));
  return new Set(shuffle(doors, rand).slice(0, count).map((d) => d.id));
}

export function hidePack(src: string, dest: string, hide: ReadonlySet<number>): number {
  copyFileSync(src, dest);
  const db = new DatabaseSync(dest);
  try {
    const ids = [...hide];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      db.prepare(`DELETE FROM address WHERE id IN (${slice.map(() => '?').join(',')})`).run(...slice);
    }
    return (db.prepare('SELECT COUNT(*) AS n FROM address').get() as { n: number }).n;
  } finally {
    db.close();
  }
}
