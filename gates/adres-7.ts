import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Parse = { count: number; sdk: Record<string, number>; libpostal: Record<string, number> };
type Floor = { count: number; exact: number; within1: number; inRange: number };
type Notes = { consistent: number; falseRate: number; caughtRate: number; kinds: Record<string, number> };
type Block = { tried: number; clear: number; rate: number; ambiguous: number; ambiguousRate: number; sites: number };

const COMPONENTS = ['floor', 'door', 'block'];
const deviceOutcome = (reportDir: string, ios: boolean): { outcome: string; value: number } => {
  const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-unit'));
  const report = reports.find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.addr-unit');
  return { outcome: entry?.outcome ?? 'yok', value: Number(entry?.value ?? NaN) };
};

export const adres7Gates: Gate[] = [
  {
    id: 'A7.1',
    phase: 7,
    title: 'Birim ayrıştırma (G9, kat/daire/blok): F1 ≥ 0,95 ve libpostal\'dan iyi',
    kind: 'auto',
    threshold: 'F1 ≥ %95, libpostal\'ın üstünde',
    async measure() {
      const m = read<Parse>('a7_parse');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const ok = COMPONENTS.every((c) => (m.sdk[c] ?? 0) >= 95 && (m.sdk[c] ?? 0) > (m.libpostal[c] ?? 0));
      return { status: ok ? 'pass' : 'fail', measured: `${m.count} kayıt: SDK ${COMPONENTS.map((c) => `${c} %${m.sdk[c]}`).join(', ')}; libpostal ${COMPONENTS.map((c) => `${c} %${m.libpostal[c]}`).join(', ')}` };
    },
  },
  {
    id: 'A7.2',
    phase: 7,
    title: 'Kat tahmini (sentetik binalar, geçici): tam ≥ %55, ±1 ≥ %85',
    kind: 'auto',
    threshold: 'tam ≥ %55 ve ±1 ≥ %85 (G0 gelince gerçek çiftlerle yeniden)',
    allowOpen: true,
    async measure() {
      const m = read<Floor>('a7_floor');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.exact >= 55 && m.within1 >= 85 ? 'pass' : 'fail', measured: `${m.count} sentetik daire: tam %${m.exact}, ±1 %${m.within1}, aralık içinde %${m.inRange}` };
    },
  },
  {
    id: 'A7.3',
    phase: 7,
    title: 'Tutarsızlık notları: enjekte tutarsızlıkların ≥ %90\'ı yakalanır, tutarlı kayıtlarda yanlış not ≤ %2',
    kind: 'auto',
    threshold: 'yakalama ≥ %90, yanlış not ≤ %2',
    async measure() {
      const m = read<Notes>('a7_notes');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const kinds = Object.entries(m.kinds).map(([k, v]) => `${k} %${v}`).join(', ');
      return { status: m.caughtRate >= 90 && m.falseRate <= 2 ? 'pass' : 'fail', measured: `yakalama %${m.caughtRate} (${kinds}); ${m.consistent} tutarlı kayıtta yanlış not %${m.falseRate}` };
    },
  },
  {
    id: 'A7.4',
    phase: 7,
    title: 'Blok çözümleme: OSM\'de blok adlı binası olan sitelerde ≥ %90',
    kind: 'auto',
    threshold: '≥ %90 (aynı adlı komşusu olmayan kayıtlar)',
    async measure() {
      const m = read<Block>('a7_block');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.rate >= 90 ? 'pass' : 'fail', measured: `${m.clear} net kayıt, ${m.sites} küme: %${m.rate}; aynı adlı komşulu ${m.ambiguous} kayıtta %${m.ambiguousRate}` };
    },
  },
  {
    id: 'A7.5',
    phase: 7,
    title: 'Telefonda sdk.addr-unit iPhone ve Android\'de geçti, iPhone p95 ≤ 150 ms',
    kind: 'device',
    threshold: 'iki platformda pass, p95 ≤ 150 ms',
    async measure({ reportDir }) {
      const ios = deviceOutcome(reportDir, true);
      const android = deviceOutcome(reportDir, false);
      const measured = `iPhone ${ios.outcome}${Number.isFinite(ios.value) ? ` (p95 ${ios.value} ms)` : ''}, Android ${android.outcome}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' && ios.value <= 150 ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A7.6',
    phase: 7,
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
