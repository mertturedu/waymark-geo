import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { readHoodIndex } from '../pipeline/build/hood-index';
import { parseAddress } from '../src/core/text';
import { streetKey } from '../src/core/text/street';
import { hoodGaps, isBare, reportDir, type HoodGap } from './gap-map';
import { repoRoot } from './addr-sets';

export type Evidence = { sid: string; texts: number; streets: number; top: [string, number][] };

const work = join(repoRoot, 'dist', 'work', '261028');

export function evidenceForPlate(plate: string, bare: HoodGap[]): Evidence[] {
  const addressFile = join(work, 'packs', plate, 'address.sqlite');
  const rowsFile = join(work, 'overture', `${plate}.rows.jsonl`);
  if (bare.length === 0 || !existsSync(rowsFile)) return [];
  const db = new DatabaseSync(addressFile, { readOnly: true });
  const ids = new Map((db.prepare('SELECT id, sid FROM neighbourhood').all() as { id: number; sid: string | null }[]).map((r) => [r.id, r.sid]));
  db.close();
  const wanted = new Set(bare.map((h) => h.sid));
  const index = readHoodIndex(addressFile);
  const by = new Map<string, Map<string, number>>();
  const texts = new Map<string, number>();
  for (const line of readFileSync(rowsFile, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line) as { addr: string | null; lon: number; lat: number };
    if (!r.addr || r.addr.trim().length < 4) continue;
    const hood = index.at(r.lon, r.lat);
    const sid = hood === null ? null : (ids.get(hood) ?? null);
    if (!sid || !wanted.has(sid)) continue;
    const street = parseAddress(r.addr).street;
    texts.set(sid, (texts.get(sid) ?? 0) + 1);
    if (!street || street.text.trim() === '' || street.number !== null) continue;
    const key = streetKey(street.text).key;
    if (key === '') continue;
    const map = by.get(sid) ?? new Map<string, number>();
    map.set(key, (map.get(key) ?? 0) + 1);
    by.set(sid, map);
  }
  return [...wanted].flatMap((sid) => (sid ? [{ sid, texts: texts.get(sid) ?? 0, streets: by.get(sid)?.size ?? 0, top: [...(by.get(sid) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3) }] : []));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plates = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const all: Evidence[] = [];
  let bareHoods = 0;
  for (const plate of plates) {
    const bare = hoodGaps(plate).filter(isBare);
    bareHoods += bare.length;
    all.push(...evidenceForPlate(plate, bare));
  }
  writeFileSync(join(reportDir(), 'kanit.json'), JSON.stringify(all));
  const has = (n: number): number => all.filter((e) => e.streets >= n).length;
  console.log(JSON.stringify({ bareHoods, measured: all.length, withAnyText: all.filter((e) => e.texts > 0).length, streets1: has(1), streets2: has(2), streets3: has(3), streets5: has(5) }));
}
