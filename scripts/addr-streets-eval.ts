import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { streetKey } from '../src/core/text/street';
import { nominatim } from '../tools/compare/engines/nominatim';
import { recordMeasure } from '../tools/compare/measures';
import { evalText, openSearch } from './addr-eval';
import { provinceName } from '../src/core/text/admin';
import { readSet, repoRoot, type TextRecord } from './addr-sets';

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

type Derived = { name: string; district: string; evidence: { lon: number; lat: number; number: string }[] };

const pct = (n: number, total: number): number => Number(((100 * n) / Math.max(1, total)).toFixed(1));

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,16,35,06').split(',');
  const limit = Number(process.argv[3] ?? 400);
  const label = process.env.ADDR_PACKS ?? 'yayın';
  const search = await openSearch();
  const rival = nominatim();
  const counts = { total: 0, sdk: 0, rival: 0, both: 0, onlySdk: 0, onlyRival: 0 };
  const onlyRival: string[] = [];
  for (const plate of plates) {
    for (const r of readSet<TextRecord>('g2', plate).filter((x) => !x.ops.includes('street_typo')).slice(0, limit)) {
      const o = await evalText(search, r);
      const found = await rival.query(`${r.street} ${r.number}, ${r.district}, ${r.province}`);
      const rivalOk = found.parts.street !== undefined && streetKey(found.parts.street).key === streetKey(r.street).key;
      counts.total++;
      if (o.streetOk) counts.sdk++;
      if (rivalOk) counts.rival++;
      if (o.streetOk && rivalOk) counts.both++;
      else if (o.streetOk) counts.onlySdk++;
      else if (rivalOk) {
        counts.onlyRival++;
        if (onlyRival.length < 12) onlyRival.push(`${r.text} → ${r.street}`);
      }
    }
    search.invalidate(plate);
  }
  const named = { tried: 0, sdkFound: 0, rivalFound: 0 };
  const admin = new Map(lines<{ id: string; names: { tr?: string } }>(join(work, 'admin-full.jsonl')).map((r) => [r.id, r.names.tr ?? '']));
  for (const plate of plates) {
    for (const row of lines<Derived>(join(work, 'street-names', `${plate}.jsonl`)).slice(0, 150)) {
      const e = row.evidence[0];
      if (!e) continue;
      const text = `${row.name} ${e.number}, ${admin.get(row.district) ?? ''}, ${(provinceName(plate) ?? plate)}`;
      named.tried++;
      const res = await search.resolve(text);
      const best = res.status === 'resolved' ? res.best : res.status === 'ambiguous' ? res.candidates[0] : undefined;
      if (best && distanceM(best.coordinate, [e.lon, e.lat]) <= 80) named.sdkFound++;
      const found = await rival.query(text);
      if (found.point && distanceM(found.point, [e.lon, e.lat]) <= 80) named.rivalFound++;
    }
    search.invalidate(plate);
  }
  const result = { label, ...counts, sdkShare: pct(counts.sdk, counts.total), rivalShare: pct(counts.rival, counts.total), named: { ...named, sdkShare: pct(named.sdkFound, named.tried), rivalShare: pct(named.rivalFound, named.tried) }, onlyRival };
  console.log(`[${label}] sokak doğru: SDK %${result.sdkShare}, Nominatim (temiz) %${result.rivalShare} (${counts.total} kayıt); yalnız SDK ${counts.onlySdk}, yalnız Nominatim ${counts.onlyRival}`);
  console.log(`[${label}] adı işletmelerden öğrenilen yollar: SDK buldu %${result.named.sdkShare}, Nominatim %${result.named.rivalShare} (${named.tried} yol)`);
  console.log(onlyRival.join('\n'));
  recordMeasure(`a4_streets_${label}`, result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
