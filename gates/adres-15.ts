import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string };

async function measureArrive(run: GateContext['run'], check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-arrive.ts', '--check', check]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const deviceGate = (id: string, title: string, threshold: string): Gate => ({
  id,
  phase: 15,
  title,
  kind: 'device',
  threshold,
  async measure({ reportDir }) {
    const ios = deviceEntry(reportDir, 'sdk.addr-arrive', true);
    const android = deviceEntry(reportDir, 'sdk.addr-arrive', false);
    const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 200)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
    if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
    return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
  },
});

export const adres15Gates: Gate[] = [
  {
    id: 'A15.1',
    phase: 15,
    title: 'Rota varışı doğru sokak zincirinde: sentetik vakalar %100 (birim testi), gerçek il paketlerinde ≥ %99',
    kind: 'auto',
    threshold: 'sentetik zincir, taraf ve giriş testleri geçiyor; 5 ilde sürülebilir yolu olan kapıların ≥ %99\'unda rota zincirde bitiyor',
    async measure({ run }) {
      const unit = await run('npx', ['jest', 'test/route/arrival.test.ts', 'test/address/arrival.test.ts', 'test/plan/arrival.test.ts', 'test/geo/create-geo-route.test.ts']);
      const tail = unit.out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      const real = await measureArrive(run, 'chain');
      if (!real) return { status: 'fail', measured: 'chain ölçümü çalışmadı' };
      return { status: unit.code === 0 && real.pass ? 'pass' : 'fail', measured: `${tail}; ${real.measured}` };
    },
  },
  {
    id: 'A15.2',
    phase: 15,
    title: 'Yanlış sokağa varış azaldı, kapıya uzaklık artmadı (G0 gelince hedef ile doğru nokta arası ortancası yeniden)',
    kind: 'auto',
    threshold: 'eski yöntemin yanlış sokağa vardığı kapıların ≥ %80\'i düzelir; kapı-varış ortancası ≤ +5 m; süre p95 ≤ 15 ms',
    async measure({ run }) {
      const chain = await measureArrive(run, 'chain');
      const speed = await measureArrive(run, 'speed');
      if (!chain || !speed) return { status: 'fail', measured: 'ölçüm çalışmadı' };
      const m = /başka sokağa vardığı (\d+) kapının (\d+)/.exec(chain.measured);
      const fixed = m ? Number(m[2]) / Math.max(1, Number(m[1])) : 0;
      const entrance = await measureArrive(run, 'entrance');
      return { status: chain.pass && speed.pass && fixed >= 0.8 ? 'pass' : 'fail', measured: `${chain.measured} | ${speed.measured} | ${entrance?.measured ?? 'giriş ölçümü yok'}` };
    },
  },
  {
    id: 'A15.3',
    phase: 15,
    title: 'Rota ve plan testleri gerilemedi',
    kind: 'auto',
    threshold: 'test/route, test/plan, test/geo, test/address, test/i18n geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/route', 'test/plan', 'test/geo', 'test/address', 'test/i18n', 'test/scripts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  deviceGate('A15.4', 'Telefonda 40 rota: zincire varış, varış tarafı yazılı ve Node ile aynı (iPhone ve Android)', 'iki platformda sdk.addr-arrive pass'),
];
