import golden from '../../../../fixtures/text-golden.json';
import unicode from '../../../../fixtures/text-unicode.json';
import { foldText, nameKey } from '../../../../src/core/text/fold';
import { parseAddress } from '../../../../src/core/text/parse';
import { runCase, type GoldenCase } from '../../../../test/text/helpers/golden';
import { nextTurn } from '../ui-yield';
import type { DeviceTest } from '../types';

const SPEED_CALLS = 3000;

export const textGolden: DeviceTest = {
  id: 'text.golden',
  title: 'Metin çekirdeği: altın tablo ve Unicode kontrolleri',
  kind: 'auto',
  async run() {
    const cases = golden.cases as unknown as GoldenCase[];
    let failed = 0;
    const examples: string[] = [];
    for (let i = 0; i < cases.length; i++) {
      const entry = cases[i] as GoldenCase;
      if (!runCase(entry).ok) {
        failed++;
        if (examples.length < 3) examples.push(entry.text.slice(0, 60));
      }
      if (i % 250 === 0) await nextTurn();
    }
    const differences = (unicode.cases as [string, string, string][]).filter(([text, fold, key]) => foldText(text) !== fold || nameKey(text) !== key).length;
    const times: number[] = [];
    for (let i = 0; i < SPEED_CALLS; i++) {
      const start = performance.now();
      parseAddress((cases[i % cases.length] as GoldenCase).text);
      times.push(performance.now() - start);
      if (i % 500 === 0) await nextTurn();
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(0.99 * times.length)] as number;
    const note = `Unicode ${unicode.cases.length} kontrol, ${differences} fark; ${SPEED_CALLS} çağrıda p99 ${p99.toFixed(2)} ms, en uzun ${(times[times.length - 1] as number).toFixed(2)} ms${examples.length ? `; hatalı: ${examples.join(' | ')}` : ''}`;
    return { outcome: failed === 0 && differences === 0 ? 'pass' : 'fail', value: `${cases.length - failed}/${cases.length}`, unit: 'vaka', threshold: 'hepsi doğru, Unicode farkı yok', note };
  },
};
