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

const measured = (check: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-learning.ts', '--check', check]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: lastJson(out)?.measured ?? tail(out) };
};

const tests = (files: string[]) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['jest', ...files]);
  const summary = /Tests:\s+(.*)/.exec(out)?.[1];
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: summary ?? tail(out) };
};

const auto = (id: string, title: string, threshold: string, measure: Gate['measure']): Gate => ({ id, phase: 4, title, kind: 'auto', threshold, measure });

export const phase4Gates: Gate[] = [
  auto('K4.1', 'Bir teslimat onayından sonra hata', 'ortanca en çok 16 m', measured('delivery1')),
  auto('K4.2', 'Üç teslimat onayından sonra hata', 'ortanca en çok 10 m, yüzde 90lık dilim en çok 22 m', measured('delivery3')),
  auto('K4.3', 'Beş teslimat onayından sonra hata', 'ortanca en çok 8 m', measured('delivery5')),
  auto('K4.4', 'Aykırı değer dayanıklılığı', 'vakaların en az yüzde 99unda fark en çok 3 m', measured('outlier')),
  auto('K4.4b', 'Tek pin onayından sonra hata', 'ortanca en çok 6 m', measured('pin')),
  auto('K4.5', 'Seyrek il simülasyonu', 'ortanca en çok 25 m ve sokak düzeyi yedeğe göre en az yüzde 50 iyileşme', measured('sparse')),
  auto('K4.6', 'Güven kuralı', 'tek teslimat asla kesin değil; pin ya da yakın iki onay kesin', tests(['test/learn/trust.test.ts'])),
  auto('K4.7', 'Kalıcılık', 'yeniden başlama, paket değişimi ve şema göçünde öğrenilen veri korunur', tests(['test/learn/persistence.test.ts'])),
  auto('K4.8', 'Dışa aktar, içe aktar, düzeltme katmanı', 'aynı noktalar ve aynı sonuçlar', tests(['test/learn/corrections.test.ts', 'test/scripts/corrections.test.ts'])),
  auto('K4.9', 'Kayıt şeması', 'yalnızca izinli alanlar', tests(['test/learn/privacy.test.ts'])),
  auto('K4.10', 'Mutasyon ve kapsam', 'öğrenme çekirdeğinde mutasyon en az yüzde 80; satır kapsamı en az yüzde 90, dal kapsamı en az yüzde 85', async ({ run }) => {
    const mutation = await run('npx', ['stryker', 'run', '--mutate', 'src/core/learn/**/*.ts']);
    const score = /All files\s*\|\s*([\d.]+)/.exec(mutation.out)?.[1];
    const coverage = await run('npx', ['jest', '--coverage', '--silent']);
    const status = mutation.code === 0 && coverage.code === 0 ? ('pass' as const) : ('fail' as const);
    return { status, measured: `mutasyon ${score ?? tail(mutation.out)}; kapsam eşikleri ${coverage.code === 0 ? 'geçti' : 'tutmadı'}` };
  }),
];
