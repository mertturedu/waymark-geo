import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Group = { n: number; street: number; answered: number; exact: number; within2: number; onRightStreet: { n: number; answered: number; exact: number; within2: number } };
type Hide = { anchored: Group; sparse: Group; precisions: Record<string, number> };
type Inside = { n: number; right: number; knownDoor: number };
type Versus = { sdk: { n: number; street: number; exact: number; within2: number }; nominatim: { n: number; street: number; exact: number; within2: number } };

const entryOf = (reportDir: string, ios: boolean): { outcome: string; value: number } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-reverse')).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.addr-reverse');
  return { outcome: entry?.outcome ?? 'yok', value: Number(entry?.value ?? NaN) };
};

export const adres10Gates: Gate[] = [
  {
    id: 'A10.1',
    phase: 10,
    title: 'Gizle-ters ara (çapalı sokaklarda): tam numara ≥ %60, ±2 ≥ %85',
    kind: 'auto',
    threshold: 'tam ≥ %60 ve ±2 ≥ %85 (OSM kapısı gizli, komşu kapılar etiketli)',
    async measure() {
      const m = read<Hide>('a10_hide');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const a = m.anchored;
      return { status: a.exact >= 60 && a.within2 >= 85 ? 'pass' : 'fail', measured: `çapalı ${a.n} nokta: sokak %${a.street}, numara verilen %${a.answered}, tam %${a.exact}, ±2 %${a.within2}; sokak doğru olanlarda (${a.onRightStreet.n}) tam %${a.onRightStreet.exact}, ±2 %${a.onRightStreet.within2}; seyrek ${m.sparse.n} nokta: tam %${m.sparse.exact}, ±2 %${m.sparse.within2}` };
    },
  },
  {
    id: 'A10.1b',
    phase: 10,
    title: 'OSM\'de olmayan işletme kapılarında Nominatim\'den ≥ +20 puan (tam numara)',
    kind: 'auto',
    threshold: '≥ +20 puan (G0 gelince gerçek vakalarla yeniden)',
    allowOpen: true,
    async measure() {
      const m = read<Versus>('a10_nominatim');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const gain = Math.round((m.sdk.exact - m.nominatim.exact) * 10) / 10;
      return { status: gain >= 20 ? 'pass' : 'fail', measured: `${m.sdk.n} işletme kapısı: tam numara SDK %${m.sdk.exact}, Nominatim %${m.nominatim.exact} (${gain >= 0 ? '+' : ''}${gain}); ±2 %${m.sdk.within2} / %${m.nominatim.within2}; sokak %${m.sdk.street} / %${m.nominatim.street}` };
    },
  },
  {
    id: 'A10.2',
    phase: 10,
    title: 'Bina içi noktada doğru bina ≥ %98',
    kind: 'auto',
    threshold: '≥ %98',
    async measure() {
      const m = read<Inside>('a10_inside');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.right >= 98 ? 'pass' : 'fail', measured: `${m.n} nokta (4 il): doğru bina %${m.right}` };
    },
  },
  {
    id: 'A10.3',
    phase: 10,
    title: 'Cihazda nokta → adres (iPhone) p95 ≤ 30 ms',
    kind: 'device',
    threshold: 'p95 ≤ 30 ms (Hermes CLI sqlite çalıştıramadığı için cihazda)',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      if (ios.outcome === 'yok') return { status: 'open', measured: 'iPhone raporu yok' };
      return { status: Number.isFinite(ios.value) && ios.value <= 30 ? 'pass' : 'fail', measured: `iPhone p95 ${ios.value} ms` };
    },
  },
  {
    id: 'A10.4',
    phase: 10,
    title: 'Telefonda sdk.addr-reverse (iki ilde 40 dokunma) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `iPhone ${ios.outcome}${Number.isFinite(ios.value) ? ` (p95 ${ios.value} ms)` : ''}, Android ${android.outcome}${Number.isFinite(android.value) ? ` (p95 ${android.value} ms)` : ''}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A10.5',
    phase: 10,
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
