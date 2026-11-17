import type { Gate } from './engine';
import { deviceEntry, measureCheck } from './adres-13';

const deviceGate = (id: string, title: string, threshold: string): Gate => ({
  id,
  phase: 14,
  title,
  kind: 'device',
  threshold,
  async measure({ reportDir }) {
    const ios = deviceEntry(reportDir, 'sdk.addr-stops', true);
    const android = deviceEntry(reportDir, 'sdk.addr-stops', false);
    const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 160)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
    if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
    return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
  },
});

export const adres14Gates: Gate[] = [
  {
    id: 'A14.1',
    phase: 14,
    title: 'Durma noktası, iğneyle uyuşan kayıtlarda onay GPS\'inden ≥ %30 daha yakın (veri gelince; o zamana kadar yürüyüş benzetimi)',
    kind: 'auto',
    threshold: 'ortanca hata ≥ %30 az; birleşik noktada kural v2 v1\'den kötü değil',
    async measure({ run }) {
      const result = await measureCheck(run, 'stops');
      return result ? { status: result.pass ? 'pass' : 'fail', measured: result.measured } : { status: 'fail', measured: 'stops ölçümü çalışmadı' };
    },
  },
  deviceGate('A14.2', 'Teslim akışı süresi değişmedi: durma noktası hesabı teslim anında cihazda ≤ 5 ms (p95); Kargoio uygulaması bu fazda değişmedi', 'sdk.addr-stops iki platformda pass (p95 ≤ 5 ms)'),
  {
    id: 'A14.3',
    phase: 14,
    title: 'İz paketlere ve çıktıya girmiyor: iz yalnız durma noktasına indirgenir, zaman yalnız teslimden önceki saniye olarak kabul edilir',
    kind: 'auto',
    threshold: 'kayıt, durma ve gizlilik testleri geçiyor (iz örnek değerleri pakette yok, mutlak zaman reddediliyor)',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/real', 'test/learned', 'test/pipeline/learned.test.ts', 'test/pipeline/learned-stops.test.ts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  deviceGate('A14.4', 'Telefonda 120 yürüyüş izi: durma noktası Node ile birebir ve onay GPS\'inden yakın (iPhone ve Android)', 'iki platformda sdk.addr-stops pass'),
  {
    id: 'A14.5',
    phase: 14,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real, test/scripts geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
