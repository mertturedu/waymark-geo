import golden from '../../../../fixtures/address-golden/34.json';
import { profileDb, summarizeProfile } from '../../../../src/native/logic/profile';
import { speedQueries } from '../../../../src/native/logic/queries';
import { pickQueries, timingNote, type GoldenEntry } from '../../device-test/address-search-helpers';
import { nextTurn } from '../../device-test/ui-yield';
import type { DeviceTest } from '../../device-test/types';
import { ensureIstanbul } from '../sandbox';

const COUNT = 500;
const LIMIT_MS = 150;

export const sdkSearchSpeed: DeviceTest = {
  id: 'sdk.search-speed',
  title: 'Arama hızı: 500 sorgu, İstanbul paketi (p95 en çok 150 ms)',
  kind: 'auto',
  async run(ctx) {
    const profile = profileDb(() => performance.now());
    const { geo } = await ensureIstanbul(ctx, { wrapOpener: (open) => async (path) => profile.wrap(await open(path)) });
    try {
      const queries = speedQueries(pickQueries((golden as { queries: GoldenEntry[] }).queries, 100_000), COUNT);
      const times: number[] = [];
      let found = 0;
      for (const [index, query] of queries.entries()) {
        const started = performance.now();
        const result = await geo.search.resolve(query.text, { hints: { city: 'İstanbul' } });
        times.push(performance.now() - started);
        if (result.status === 'resolved' || result.status === 'ambiguous') found += 1;
        if (index % 20 === 0) await nextTurn();
      }
      const all = timingNote(times);
      const warm = timingNote(times.slice(100));
      const sum = times.reduce((a, b) => a + b, 0);
      const per = summarizeProfile(profile.stats(), queries.length, sum);
      const note = `${queries.length} sorgu, sonuç bulunan ${found}; ilk sorgu ${times[0]?.toFixed(0)} ms; p50 ${all.p50.toFixed(1)} ms, en uzun ${all.max.toFixed(0)} ms; ilk 100 hariç p95 ${warm.p95.toFixed(0)} ms; sorgu başına SQL çağrısı ${per.callsPerQuery.toFixed(1)}, SQL bekleme ${per.sqlMsPerQuery.toFixed(1)} ms, diğer ${per.otherMsPerQuery.toFixed(1)} ms, satır ${per.rowsPerQuery.toFixed(0)}`;
      return { outcome: all.p95 <= LIMIT_MS ? 'pass' : 'fail', value: all.p95.toFixed(0), unit: 'ms (p95)', threshold: `en çok ${LIMIT_MS} ms`, note };
    } finally {
      await geo.dispose();
    }
  },
};
