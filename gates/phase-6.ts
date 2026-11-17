import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate, GateContext } from './engine';

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

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

const auto = (id: string, title: string, threshold: string, measure: Gate['measure']): Gate => ({ id, phase: 6, title, kind: 'auto', threshold, measure });

const check = async ({ run }: GateContext, name: string): Promise<{ pass: boolean; measured: string }> => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-route.ts', '--check', name]);
  return { pass: code === 0, measured: lastJson(out)?.measured ?? tail(out) };
};

const measure = (name: string) => async (ctx: GateContext) => {
  const got = await check(ctx, name);
  return { status: got.pass ? ('pass' as const) : ('fail' as const), measured: got.measured };
};

export const ROUTE_MUTATION_CONFIG = 'stryker.route.config.json';

export const phase6Gates: Gate[] = [
  auto('K6.1', 'Hızlandırılmış arama düz Dijkstra ile aynı', '12 il ve Kilis, il başına 20 bin çiftte tam sayı birimde birebir aynı süre (yüzde 100)', measure('exact')),
  auto('K6.2', 'Bağımsız referans (Python, networkx)', '3 bölgede 2.000 çift; süre farkı yol parçası başına yuvarlama payını aşmaz (yüzde 100)', measure('reference')),
  auto('K6.3', 'Tek yön', '20 bin yolun hiçbiri tek yön parçayı ters yönde geçmez', measure('oneway')),
  auto('K6.4', 'Dönüş yasakları', '12 ildeki bütün yasak kayıtları için dönüşü zorlayan sorgu; no_* dönüşü hiçbir yolda yok, only_* kuralına uyulur (düğümde ve yolda yüzde 100)', measure('turns')),
  auto('K6.5', 'Bağlılık ve oturtma', 'her ilde en büyük güçlü bileşen düğümlerin en az yüzde 97si; Adalar disconnected, açık deniz no_road, otoyol kenarı siteler yanındaki yola', async (ctx) => {
    const connected = await check(ctx, 'connectivity');
    const snapping = await check(ctx, 'snapping');
    return { status: connected.pass && snapping.pass ? 'pass' : 'fail', measured: `bağlılık: ${connected.measured}; oturtma: ${snapping.measured}` };
  }),
  {
    id: 'K6.6',
    phase: 6,
    title: 'Mapbox yön tarifiyle toplu karşılaştırma',
    kind: 'decision',
    allowOpen: true,
    threshold: '12 ilde 200 çift: SDK yolu Mapbox saatine göre kendi en iyi rotasından en çok yüzde 15 yavaş, çiftlerin en az yüzde 92sinde, ortanca yavaşlık en çok 1,02; yavaş çıkanlar tek tek açıklanır; yanıtlar saklanmaz',
    async measure({ reportDir }) {
      const file = join(reportDir, 'faz-6-mapbox-karsilastirma.md');
      if (!existsSync(file)) return { status: 'open', measured: 'koşu kullanıcı onayı bekliyor (yuksi/tools/geo-oracle, --confirm)' };
      const text = readFileSync(file, 'utf8');
      const pass = /SONUÇ: GEÇTİ/.test(text);
      return { status: pass ? 'pass' : 'fail', measured: /En çok yüzde 15 yavaş[^\n]*/.exec(text)?.[0] ?? 'rapor okunamadı' };
    },
  },
  auto('K6.7', 'Boyut', 'İstanbul rota paketi en çok 35 MB, 12 il toplamı en çok 200 MB', measure('sizes')),
  auto('K6.8', 'Hız (Node)', 'tek sorgu p95 en çok 5 ms, 50 x 50 matris en çok 300 ms', measure('speed')),
  auto('K6.8b', 'Matris hızı (Hermes)', '50 x 50 matris Hermes içinde en çok 2 sn', measure('hermes')),
  auto('K6.9', 'Bellek', 'İstanbul rota paketi yüklüyken heapUsed ile arrayBuffers toplamı en çok 80 MB artar', measure('memory')),
  auto('K6.10', 'Belirlenim, mutasyon, kapsam', 'üretim bayt bayt aynı (K2.1 rota paketlerini de kapsar); okuyucu ve aramada mutasyon en az yüzde 80; kapsam eşikleri', async ({ run }) => {
    const mutation = await run('npx', ['stryker', 'run', ROUTE_MUTATION_CONFIG]);
    const score = /All files\s*\|\s*([\d.]+)/.exec(mutation.out)?.[1];
    const coverage = await run('npx', ['jest', '--coverage', '--silent']);
    const status = mutation.code === 0 && coverage.code === 0 ? ('pass' as const) : ('fail' as const);
    return { status, measured: `rota mutasyonu ${score ?? tail(mutation.out)}; kapsam eşikleri ${coverage.code === 0 ? 'geçti' : 'tutmadı'}` };
  }),
];
