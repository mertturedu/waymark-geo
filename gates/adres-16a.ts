import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string };

async function measureShapes(run: GateContext['run']): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-shapes.ts']);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.5;

export const adres16aGates: Gate[] = [
  {
    id: 'A16A.1',
    phase: PHASE,
    title: 'Her sokak sonucunda çizgi var, bbox sonuç noktasını içeriyor, mahalle ve ilçe sınırı var (çok parçalı ve çok uzun sokaklar dahil, nokta üst sınırı aşılmıyor)',
    kind: 'auto',
    threshold: 'çizgili sokak sonucu %100, bbox ≥ %99,5, sınırı olan mahalle ve ilçe %100, nokta ≤ 1500; sadeleştirme, geometri ve görünüm testleri geçiyor',
    async measure({ run }) {
      const unit = await run('npx', ['jest', 'test/geo/simplify.test.ts', 'test/address/geometry.test.ts', 'test/native/geometry-view.test.ts', 'test/server/api.test.ts']);
      const tail = unit.out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      const real = await measureShapes(run);
      if (!real) return { status: 'fail', measured: 'shapes ölçümü çalışmadı' };
      return { status: unit.code === 0 && real.pass ? 'pass' : 'fail', measured: `${tail}; ${real.measured}` };
    },
  },
  {
    id: 'A16A.2',
    phase: PHASE,
    title: 'Geometri hesabı ve boyutu makul: sokak çizgisi JSON p95 ≤ 20 KB, alan sınırı p95 ≤ 50 KB, hesap p95 ≤ 50 ms (Node)',
    kind: 'auto',
    threshold: 'sokak p95 ≤ 20 KB, alan p95 ≤ 50 KB, süre p95 ≤ 50 ms',
    async measure({ run }) {
      const real = await measureShapes(run);
      if (!real) return { status: 'fail', measured: 'shapes ölçümü çalışmadı' };
      const street = /boyut p50 [\d.]+ KB, p95 ([\d.]+) KB/.exec(real.measured);
      const area = /sınır \(boyut p95 ([\d.]+) KB\)/.exec(real.measured);
      const time = /geometri süresi p50 [\d.]+ ms, p95 ([\d.]+) ms/.exec(real.measured);
      if (!street || !area || !time) return { status: 'fail', measured: real.measured };
      const ok = Number(street[1]) <= 20 && Number(area[1]) <= 50 && Number(time[1]) <= 50;
      return { status: ok ? 'pass' : 'fail', measured: `sokak p95 ${street[1]} KB, alan p95 ${area[1]} KB, süre p95 ${time[1]} ms` };
    },
  },
  {
    id: 'A16A.3',
    phase: PHASE,
    title: 'Telefonda 60 sorgu: sokak çizgisi, mahalle ve ilçe sınırı, bbox Node ile birebir (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-shapes pass',
    async measure({ reportDir }) {
      const ios = deviceEntry(reportDir, 'sdk.addr-shapes', true);
      const android = deviceEntry(reportDir, 'sdk.addr-shapes', false);
      const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 200)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A16A.4',
    phase: PHASE,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme, sunucu, harita mantığı)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real, test/scripts, test/server, test/geo, test/native geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts', 'test/server', 'test/geo', 'test/native']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
