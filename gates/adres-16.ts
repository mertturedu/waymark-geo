import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string };

async function measureServer(run: GateContext['run'], check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-server.ts', '--check', check]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const serverGate = (id: string, title: string, threshold: string, check: string, extra?: string[]): Gate => ({
  id,
  phase: 16,
  title,
  kind: 'auto',
  threshold,
  async measure({ run }) {
    const result = await measureServer(run, check);
    if (!result) return { status: 'fail', measured: `${check} ölçümü çalışmadı` };
    let tail = '';
    if (extra) {
      const unit = await run('npx', ['jest', ...extra]);
      tail = ` | ${unit.out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? ''}`;
      if (unit.code !== 0) return { status: 'fail', measured: `${result.measured}${tail}` };
    }
    return { status: result.pass ? 'pass' : 'fail', measured: `${result.measured}${tail}` };
  },
});

export const adres16Gates: Gate[] = [
  serverGate('A16.1', 'Sunucu cevabı çekirdek aramayla birebir (geocode, validate, autocomplete, reverse, places; 5 il, G2 metinleri)', 'tüm istekler birebir aynı; sunucu, istemci ve uç testleri geçiyor', 'parity', ['test/server', 'test/geo/client.test.ts']),
  serverGate('A16.2', 'Sunucu hızı: geocode p95 ≤ 50 ms, autocomplete p95 ≤ 20 ms (ısınmış, il ipucuyla)', 'geocode p95 ≤ 50 ms ve autocomplete p95 ≤ 20 ms', 'speed'),
  serverGate('A16.3', 'Bellek ve disk raporu (81 il art arda, iki tur; açılmış ve sıkıştırılmış paket boyutu)', 'rapor var; tepe bellek ≤ 4 GB', 'resources'),
  serverGate('A16.4', 'Günlükte kişisel veri 0 bulgu (adres metni, telefon, e-posta, kimlik no, ad, anahtar)', '0 bulgu', 'privacy'),
  {
    id: 'A16.5',
    phase: 16,
    title: 'Telefonda çevrimiçi yedek: il kurulu değilken arama sunucudan gelir, il kurulunca telefonda çözülenle aynıdır (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-online pass',
    async measure({ reportDir }) {
      const ios = deviceEntry(reportDir, 'sdk.addr-online', true);
      const android = deviceEntry(reportDir, 'sdk.addr-online', false);
      const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 220)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A16.6',
    phase: 16,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme, sunucu)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real, test/scripts, test/server, test/geo geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts', 'test/server', 'test/geo']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
