import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type G7 = { count: number; sdkFirst: number; sdkTop3: number; photonFirst: number; photonTop3: number; forms: Record<string, { n: number; sdkTop3: number; photonTop3: number }> };
type Osm = { count: number; sdkFirst: number; sdkTop3: number; photonFirst: number; photonTop3: number; nominatimFirst: number; nominatimTop3: number };
type Landmark = { count: number; near: number; opposite: { n: number; near: number; answered: number }; beside: { n: number; near: number; answered: number } };

const entryOf = (reportDir: string, ios: boolean): { outcome: string; value: number } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-places')).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.addr-places');
  return { outcome: entry?.outcome ?? 'yok', value: Number(entry?.value ?? NaN) };
};

export const adres8Gates: Gate[] = [
  {
    id: 'A8.1',
    phase: 8,
    title: 'G7 (rehber işletmeleri) ilk 3\'te ≥ %90 ve Photon\'dan ≥ eşit',
    kind: 'auto',
    threshold: 'SDK ilk 3 ≥ %90 ve ≥ Photon',
    async measure() {
      const g = read<G7>('a8_g7');
      if (!g) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const o = read<Osm>('a8_g7_osm');
      const osm = o ? `; OSM yerlerinde (adil kıyas, rehber kapalı, ${o.count} kayıt) ilk 3: SDK %${o.sdkTop3}, Photon %${o.photonTop3}, Nominatim %${o.nominatimTop3}` : '';
      return { status: g.sdkTop3 >= 90 && g.sdkTop3 >= g.photonTop3 ? 'pass' : 'fail', measured: `${g.count} kayıt: SDK ilk %${g.sdkFirst}, ilk 3 %${g.sdkTop3}; Photon ilk 3 %${g.photonTop3} (rehber verisi OSM'de yok)${osm}` };
    },
  },
  {
    id: 'A8.2',
    phase: 8,
    title: 'Yer işareti vakalarında (karşısı, yanı) ≤ 50 m ≥ %70 (kapı numarası vekili, geçici)',
    kind: 'auto',
    threshold: '≥ %70 (G0 gelince gerçek vakalarla yeniden)',
    allowOpen: true,
    async measure() {
      const m = read<Landmark>('a8_landmark');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.near >= 70 ? 'pass' : 'fail', measured: `${m.count} vaka: ≤50 m %${m.near} (karşısı %${m.opposite.near}, cevap verilen %${m.opposite.answered}; yanı %${m.beside.near}, cevap verilen %${m.beside.answered})` };
    },
  },
  {
    id: 'A8.3',
    phase: 8,
    title: 'Cihazda yer sorguları (iPhone) p95 ≤ 100 ms',
    kind: 'device',
    threshold: 'p95 ≤ 100 ms (Hermes CLI sqlite çalıştıramadığı için cihazda)',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      if (ios.outcome === 'yok') return { status: 'open', measured: 'iPhone raporu yok' };
      return { status: Number.isFinite(ios.value) && ios.value <= 100 ? 'pass' : 'fail', measured: `iPhone p95 ${ios.value} ms` };
    },
  },
  {
    id: 'A8.4',
    phase: 8,
    title: 'Telefonda sdk.addr-places iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `iPhone ${ios.outcome}, Android ${android.outcome}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A8.5',
    phase: 8,
    title: 'Mevcut testler gerilemedi (metin, adres, hat)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
