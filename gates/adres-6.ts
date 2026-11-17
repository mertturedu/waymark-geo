import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Tier = { n: number; median: number; p90: number; within15: number; within30: number; baselineMedian: number; baselineP90: number; side: number; coverage: number };
type G3 = { plates: string[]; '1': Tier; '2': Tier; '99': Tier };
type Business = { count: number; within30: number; median: number };

const line = (t: Tier): string => `ortanca ${t.median} m (eski ${t.baselineMedian} m), p90 ${t.p90} m (eski ${t.baselineP90} m), ≤30 m %${t.within30}`;

export const adres6Gates: Gate[] = [
  {
    id: 'A6.1',
    phase: 6,
    title: '1 çapa (G3, kapı bilgisi sızdırılmadan): ortanca ≤ 12 m, p90 ≤ 45 m',
    kind: 'auto',
    threshold: 'ortanca ≤ 12 m ve p90 ≤ 45 m',
    async measure() {
      const g = read<G3>('a6_g3');
      if (!g) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: g['1'].median <= 12 && g['1'].p90 <= 45 ? 'pass' : 'fail', measured: `${g['1'].n} hedef, ${g.plates.join(', ')}: ${line(g['1'])}` };
    },
  },
  {
    id: 'A6.2',
    phase: 6,
    title: 'Çok çapa (≥ 3 kapı; işletme çapası ayrıca yok, OSM kapılarıyla vekil): ortanca ≤ 12 m, p90 ≤ 50 m, taraf ≥ %97',
    kind: 'auto',
    threshold: 'ortanca ≤ 12 m, p90 ≤ 50 m, taraf ≥ %97',
    async measure() {
      const g = read<G3>('a6_g3');
      if (!g) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const t = g['99'];
      return { status: t.median <= 12 && t.p90 <= 50 && t.side >= 97 ? 'pass' : 'fail', measured: `${t.n} hedef: ${line(t)}, taraf %${t.side}` };
    },
  },
  {
    id: 'A6.3',
    phase: 6,
    title: '2 çapa: ortanca ≤ 6 m',
    kind: 'auto',
    threshold: 'ortanca ≤ 6 m',
    async measure() {
      const g = read<G3>('a6_g3');
      if (!g) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: g['2'].median <= 6 ? 'pass' : 'fail', measured: `${g['2'].n} hedef: ${line(g['2'])}` };
    },
  },
  {
    id: 'A6.4',
    phase: 6,
    title: 'Kalibrasyon: yarıçap, ayrılmış sınama hedeflerinin %88-92\'sini kapsıyor',
    kind: 'auto',
    threshold: '%88 ile %92 arası',
    async measure() {
      const c = read<{ train: number; test: number; coverage: number }>('a6_calibration');
      if (!c) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: c.coverage >= 88 && c.coverage <= 92 ? 'pass' : 'fail', measured: `eğitim ${c.train}, sınama ${c.test} hedef: kapsama %${c.coverage}` };
    },
  },
  {
    id: 'A6.5',
    phase: 6,
    title: 'Kapısı bilinmeyen işletme kapıları: ≤ 30 m isabet tabana göre ≥ +20 puan',
    kind: 'auto',
    threshold: '≥ +20 puan (G1 gelince yeniden)',
    allowOpen: true,
    async measure() {
      const base = read<Business>('a6_business_taban');
      const now = read<Business>('a6_business_s5a');
      if (!base || !now) return { status: 'open', measured: 'ölçüm yok' };
      const gain = Math.round((now.within30 - base.within30) * 10) / 10;
      return { status: gain >= 20 ? 'pass' : 'fail', measured: `${now.count} işletme kapısı: ≤ 30 m %${base.within30} → %${now.within30} (${gain >= 0 ? '+' : ''}${gain} puan)` };
    },
  },
  {
    id: 'A6.6',
    phase: 6,
    title: 'Cihazda çözümleme (bina dizisi açıkken) p95 ≤ 150 ms',
    kind: 'device',
    threshold: 'p95 ≤ 150 ms',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-sequence'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      if (!ios) return { status: 'open', measured: 'iPhone raporu yok' };
      const entry = ios.entries.find((e) => e.id === 'sdk.addr-sequence');
      const p95 = Number(entry?.value ?? NaN);
      return { status: Number.isFinite(p95) && p95 <= 150 ? 'pass' : 'fail', measured: `iPhone p95 ${p95} ms` };
    },
  },
  {
    id: 'A6.7',
    phase: 6,
    title: 'Mevcut testler gerilemedi (metin, adres, hat)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A6.8',
    phase: 6,
    title: 'Telefonda kapı tahmini testi (sdk.addr-sequence) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-sequence'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-sequence')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return { status: outcome(ios) === 'pass' && outcome(android) === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
