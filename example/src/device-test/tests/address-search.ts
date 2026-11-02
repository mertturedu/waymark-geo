import * as SQLite from 'expo-sqlite';
import golden from '../../../../fixtures/address-golden/34.json';
import { createSearch } from '../../../../src/core/address/search';
import type { PackStore, SqlDb } from '../../../../src/core/ports';
import { parseManifest } from '../../../../src/core/region/manifest';
import { expoSqlDb } from '../../spikes/expoSqliteDb';
import { isHit, osmCode, pickQueries, timingNote, type ExpectedRow, type GoldenEntry } from '../address-search-helpers';
import { nextTurn } from '../ui-yield';
import type { DeviceTest, TestContext } from '../types';
import { installFile, packFile } from './pack-download';

const COUNT = 200;
const PLATE = '34';
const REPORT_P95_MS = 150;

const splitPath = (file: { uri: string }): { dir: string; name: string } => {
  const path = decodeURI(file.uri.replace(/^file:\/\//, ''));
  const at = path.lastIndexOf('/');
  return { dir: path.slice(0, at), name: path.slice(at + 1) };
};

const openFile = async (ctx: TestContext, path: string): Promise<SqlDb> => {
  const { dir, name } = splitPath(packFile(ctx, path));
  return expoSqlDb(await SQLite.openDatabaseAsync(name, { useNewConnection: true }, dir));
};

export const addressSearch: DeviceTest = {
  id: 'address.search',
  title: 'Adres arama: İstanbul paketiyle 200 altın sorgu',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/manifest-v1.json`);
    if (!response.ok) return { outcome: 'fail', note: `manifest-v1.json HTTP ${response.status}; sunucu dist/packs klasörünü sunmalı` };
    const region = parseManifest(await response.text()).regions.find((r) => r.id === PLATE);
    const addressFile = region?.files.find((f) => f.kind === 'address');
    if (!region || !addressFile) return { outcome: 'fail', note: 'manifestte İstanbul adres paketi yok' };
    const buildingsFile = region.files.find((f) => f.kind === 'buildings');
    for (const file of [addressFile, ...(buildingsFile ? [buildingsFile] : [])]) await installFile(ctx, file);

    const address = await openFile(ctx, addressFile.path);
    const part = buildingsFile ? await openFile(ctx, buildingsFile.path) : null;
    const store: PackStore = { installed: async () => [PLATE], open: async () => address, openPart: async () => part };
    const search = createSearch({ store, borders: { provinceAt: () => PLATE, provinceBounds: () => region.bbox, plates: () => [PLATE], nearBorder: () => [] } });
    try {
      const queries = pickQueries((golden as { queries: GoldenEntry[] }).queries, COUNT);
      const times: number[] = [];
      let hits = 0;
      for (const [index, q] of queries.entries()) {
        const rows = await address.all<{ id: number; number: string; lon: number; lat: number }>('SELECT id, number, lon, lat FROM address WHERE osm = ? AND number = ?', [osmCode(q.expect.osm), q.expect.number ?? '']);
        const expected: ExpectedRow[] = rows.map((r) => ({ id: r.id, number: r.number, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
        const started = performance.now();
        const result = await search.resolve(q.text, { hints: { city: 'İstanbul' } });
        times.push(performance.now() - started);
        const first = result.status === 'region_missing' ? undefined : result.status === 'resolved' ? result.best : result.candidates[0];
        if (first && isHit(first, PLATE, expected)) hits += 1;
        if (index % 20 === 0) await nextTurn();
      }
      const { p50, p95, max } = timingNote(times);
      const note = `${queries.length} sorgu, ilk sırada ${hits} (%${Math.round((100 * hits) / queries.length)}); p50 ${p50.toFixed(1)} ms, en uzun ${max.toFixed(0)} ms; bina parçası ${part ? 'kurulu' : 'yok'}`;
      return { outcome: 'info', value: p95.toFixed(0), unit: 'ms (p95)', threshold: `kayıt amaçlı, Faz 5 hedefi ≤ ${REPORT_P95_MS} ms`, note };
    } finally {
      await address.close();
      await part?.close();
    }
  },
};
