import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import queries from '../../../../fixtures/spike-queries.json';
import { searchStreets, fold, type Driver } from '../../../../scripts/spikes/street-query';
import { streetVerdict, summarise, type Sample, type StreetQuery } from '../../../../scripts/spikes/street-queries';
import type { DeviceTest } from '../types';

const P95_LIMIT_MS = 150;
const FIRST_MIN_PERCENT = 90;

const directoryOf = (uri: string): string => decodeURI(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');

const streetSearch = (id: string, title: string, fileName: string, gated: boolean): DeviceTest => ({
  id,
  title,
  kind: 'auto',
  async run(ctx) {
    const dbFile = new File(`${ctx.packsDir.replace(/\/$/, '')}/${fileName}`);
    if (!dbFile.exists) return { outcome: 'fail', note: `${fileName} yok, önce paketleri indir` };
    const db = await SQLite.openDatabaseAsync(fileName, { useNewConnection: true }, directoryOf(ctx.packsDir));
    try {
      const driver: Driver = { all: async (sql, params) => (await db.getAllAsync(sql, params)) as Record<string, string | number | null>[] };
      const list = queries as StreetQuery[];
      const samples: Sample[] = [];
      for (const query of list) {
        const started = performance.now();
        const hits = await searchStreets(driver, query.q, 5);
        const ms = performance.now() - started;
        const want = fold(query.name);
        samples.push({ ms, firstOk: hits[0]?.fold === want, topFiveOk: hits.some((h) => h.fold === want) });
      }
      const all = summarise(samples);
      const typo = summarise(samples.filter((_, i) => (list[i] as StreetQuery).typo));
      const note = `p50 ${all.p50.toFixed(0)} ms, p99 ${all.p99.toFixed(0)} ms, ilk sıra %${all.firstPercent}, ilk 5 %${all.topFivePercent}, yazım hatalıda ilk sıra %${typo.firstPercent}`;
      return { outcome: !gated ? 'info' : streetVerdict(all, P95_LIMIT_MS, FIRST_MIN_PERCENT), value: all.p95.toFixed(0), unit: 'ms (p95)', threshold: gated ? `≤ ${P95_LIMIT_MS} ms ve ilk sıra ≥ %${FIRST_MIN_PERCENT} (geçici)` : `kayıt amaçlı (karşılaştırma, eşik ${P95_LIMIT_MS})`, note };
    } finally {
      await db.closeAsync();
    }
  },
});

export const d2StreetSearch = streetSearch('d2.street-search', 'Sokak arama, tam veritabanı (97.710 satır, 42 MB)', 'istanbul-streets.db', false);
export const d2StreetSearchUnique = streetSearch('d2.street-search-unique', 'Sokak arama, yinelenmeyen adlar (30.925 satır, 13 MB)', 'istanbul-streets-unique.db', true);
