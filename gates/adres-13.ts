import type { Gate, GateContext } from './engine';
import { uploadedReports } from './fix-0';

type Check = { check: string; pass: boolean; measured: string };

export async function measureCheck(run: GateContext['run'], check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-learned.ts', '--check', check]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

export const deviceEntry = (reportDir: string, id: string, ios: boolean): { outcome: string; note: string } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === id)).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === id);
  return { outcome: entry?.outcome ?? 'yok', note: entry?.note ?? '' };
};

const single = (id: string, title: string, threshold: string, ...checks: string[]): Gate => ({
  id,
  phase: 13,
  title,
  kind: 'auto',
  threshold,
  async measure({ run }) {
    const results: Check[] = [];
    for (const check of checks) {
      const result = await measureCheck(run, check);
      if (!result) return { status: 'fail', measured: `${check} ölçümü çalışmadı` };
      results.push(result);
    }
    return { status: results.every((r) => r.pass) ? 'pass' : 'fail', measured: results.map((r) => r.measured).join(' | ') };
  },
});

export const adres13Gates: Gate[] = [
  single('A13.1', 'Benzetimde birleşik nokta ≤ 15 m (kurye ve iğne gürültüsü, uzak GPS, yanlış iğne; OSM çatışması)', 'birleşik ortanca ≤ 15 m, p90 ≤ 40 m; OSM 60 m yanlışken 2 kaynakta OSM kalır, 3 kaynakta öğrenilmiş kazanır', 'merge', 'conflict'),
  {
    id: 'A13.2',
    phase: 13,
    title: 'G1 ≤ 30 m isabet artışı raporlandı (veri gelince; o zamana kadar benzetim)',
    kind: 'auto',
    threshold: 'benzetimde SDK sonucu ≤ 30 m isabeti öğrenmeyle artar; gerçek G1 gelince yeniden',
    async measure({ run }) {
      const result = await measureCheck(run, 'merge');
      if (!result) return { status: 'fail', measured: 'merge ölçümü çalışmadı' };
      const m = /≤ 30 m isabet %([\d.]+) → %([\d.]+)/.exec(result.measured);
      if (!m) return { status: 'fail', measured: result.measured };
      return { status: Number(m[2]) > Number(m[1]) ? 'pass' : 'fail', measured: `≤ 30 m isabet %${m[1]} → %${m[2]} (benzetim; gerçek kayıt yok, G1 gelince yeniden)` };
    },
  },
  single('A13.3', 'G9 kat tahmininde öğrenilmiş düzenle tam isabet ≥ +15 puan (benzetim; gerçek veriyle yeniden)', 'öğrenilmiş düzen − tahmin modeli ≥ +15 puan', 'floors'),
  single('A13.4', 'Paketlerde kişi ve zaman denetimi 0 bulgu (şema, metin ve kaynak kimliği sızıntısı)', '0 bulgu; ad ipuçları, bina düzeni ve giriş tabloları dolu pakette de', 'privacy'),
  single('A13.5', 'Haftalık yama tam parçanın ≤ %20\'si (haftada %5 yeni kayıt)', 'yama / tam parça ≤ %20', 'patch'),
  {
    id: 'A13.6',
    phase: 13,
    title: 'Telefonda iki cihaz senaryosu: A teslim eder, B ertesi katmanda kapıyı, yeni sokağı ve bina düzenini öğrenilmiş olarak bulur (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-learned pass (sonuçlar Node ile aynı)',
    async measure({ reportDir }) {
      const ios = deviceEntry(reportDir, 'sdk.addr-learned', true);
      const android = deviceEntry(reportDir, 'sdk.addr-learned', false);
      const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 120)})` : ''}, Android ${android.outcome}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A13.7',
    phase: 13,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
