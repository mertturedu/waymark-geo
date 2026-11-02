import type { Gate, GateContext } from './engine';

const lastJson = (out: string): { measured?: string } | null => {
  for (const line of out.trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line) as { measured?: string };
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      continue;
    }
  }
  return null;
};

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

const measureCheck = (check: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-text.ts', '--check', check]);
  const measured = lastJson(out)?.measured ?? tail(out);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured };
};

export const phase1Gates: Gate[] = [
  { id: 'K1.1', phase: 1, title: 'Altın tablo', kind: 'auto', threshold: 'yüzde 100 geçer (en az 1.500 vaka)', measure: measureCheck('golden') },
  {
    id: 'K1.2',
    phase: 1,
    title: 'Özellik testleri',
    kind: 'auto',
    threshold: 'iki kez uygulanınca değişmez; harfli ve harfsiz yazım aynı; sayı korunur',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text/properties.test.ts']);
      const tests = /Tests:\s+(.*)/.exec(out)?.[1];
      return { status: code === 0 ? 'pass' : 'fail', measured: tests ?? tail(out) };
    },
  },
  {
    id: 'K1.3',
    phase: 1,
    title: 'Bozuk girdi ve hız',
    kind: 'auto',
    threshold: '100 bin girdide sıfır hata; yüzde 99 dilim < 2 ms, en uzun < 50 ms',
    async measure(ctx) {
      const speed = await measureCheck('speed')(ctx);
      const fuzz = await measureCheck('fuzz')(ctx);
      return { status: speed.status === 'pass' && fuzz.status === 'pass' ? 'pass' : 'fail', measured: `${fuzz.measured}; ${speed.measured}` };
    },
  },
  {
    id: 'K1.4',
    phase: 1,
    title: 'Mutasyon ve kapsam',
    kind: 'auto',
    threshold: 'mutasyon en az yüzde 80; satır kapsamı en az yüzde 90, dal kapsamı en az yüzde 85',
    async measure({ run }) {
      const mutation = await run('npm', ['run', 'mutation']);
      const score = /Final mutation score of ([\d.]+)/.exec(mutation.out)?.[1];
      const coverage = await run('npx', ['jest', '--coverage', '--silent']);
      const status = mutation.code === 0 && coverage.code === 0 ? 'pass' : 'fail';
      return { status, measured: `mutasyon ${score ?? tail(mutation.out)}; kapsam eşikleri ${coverage.code === 0 ? 'geçti' : 'tutmadı'}` };
    },
  },
  { id: 'K1.5', phase: 1, title: 'Ayrıştırma isabeti (12 il, 5.000 cümle)', kind: 'auto', threshold: 'en az yüzde 98', measure: measureCheck('k15') },
  {
    id: 'K1.6',
    phase: 1,
    title: 'Hermes eşliği (ek kapı)',
    kind: 'auto',
    threshold: 'altın tablo Hermes CLI içinde yüzde 100, Unicode kontrolleri Node ile aynı',
    async measure({ run }) {
      const { code, out } = await run('npx', ['tsx', 'scripts/hermes-golden.ts']);
      return { status: code === 0 ? 'pass' : 'fail', measured: lastJson(out)?.measured ?? tail(out) };
    },
  },
];
