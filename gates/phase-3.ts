import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

const check = (name: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-address.ts', '--check', name]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: lastJson(out)?.measured ?? tail(out) };
};

const auto = (id: string, title: string, threshold: string, name: string): Gate => ({ id, phase: 3, title, kind: 'auto', threshold, measure: check(name) });

export const phase3Gates: Gate[] = [
  auto('K3.1', 'Doğru yazılmış tam adres', 'altın kümede ilk sırada en az yüzde 99', 'full'),
  auto('K3.2', 'Aksansız, küçük harfli ya da kısaltmalı yazım', 'ilk sırada en az yüzde 98', 'folded'),
  auto('K3.3', 'Sokak adında bir harf hatası', 'ilk sırada en az yüzde 90, ilk 5te en az yüzde 97', 'typo'),
  auto('K3.4', 'Numaralı sokak kuralı', 'sayısı tutmayan sokak sıfır kez döner', 'numbered'),
  auto('K3.5', 'Numara tahmini', 'hiçbir il tabandan kötü değil, 12 il toplamı ortanca en çok 20 m', 'predict'),
  auto('K3.6', 'Ters arama', '10.000 noktada kahinle yüzde 100 aynı', 'reverse'),
  auto('K3.7', 'Gerçek nokta etiketi', '100 bin sorguda gerçek nokta olmayan sonuç adres ve kesin etiketi almaz', 'label'),
  auto('K3.8', 'Yer arama', '120 yerde ilk 3te en az yüzde 95', 'places'),
  auto('K3.9', 'Diller', 'en ve de ilk sırada yüzde 95, ru ve el ilk 5te yüzde 85, ar ilk sırada yüzde 90', 'languages'),
  auto('K3.10', 'Dizinli arama ve kahin', '5.000 sorguda görünür fark sıfır', 'oracle'),
  auto('K3.11', 'Hız (Node, İstanbul)', 'resolve p95 en çok 15 ms, autocomplete p95 en çok 10 ms', 'speed'),
  auto('K3.12', 'Bozuk girdi', '100 bin girdide sıfır hata, sonuç biçimi geçerli', 'fuzz'),
  {
    id: 'K3.13',
    phase: 3,
    title: 'Mapbox ile toplu karşılaştırma',
    kind: 'decision',
    threshold: 'yalnızca raporlanır (kapı değil)',
    allowOpen: true,
    async measure({ reportDir }) {
      const report = join(reportDir, 'faz-3-mapbox-karsilastirma.md');
      return existsSync(report) ? { status: 'pass', measured: 'rapor yazıldı' } : { status: 'open', measured: 'henüz koşulmadı (onay bekliyor)' };
    },
  },
  auto('K3.14', '81 ilin paketi', 'her paket açılır, 20 örnekte ilk sırada en az yüzde 95, 200 bozuk girdi hatasız', 'regions-all'),
];
