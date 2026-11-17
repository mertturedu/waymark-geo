import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const MIN_CHAIN = 95;
const MIN_SIDE = 95;
const MAX_HERMES_MS = 5;
const MAX_VILLAGE_M = 300;

type Quality = Record<string, { doors: number; reachableDoors: number; chainFirst: number; chainFirstOrSecond: number; chainTopThree: number; side: number; sideDoors: number; linked: number }>;
type Build = Record<string, { buildings: number; sizeMb: number; openMs: number; atP95Ms: number; entrances: number; settlements: number; floors: { sources: Record<string, number>; known: number; exact: number; within1: number; mae: number; bySource: Record<string, { n: number; within1: number }> } }>;

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

function weighted(values: { value: number; weight: number }[]): number {
  const total = values.reduce((s, v) => s + v.weight, 0);
  return total === 0 ? 0 : values.reduce((s, v) => s + v.value * v.weight, 0) / total;
}

export const adres5Gates: Gate[] = [
  {
    id: 'A5.1',
    phase: 5,
    title: 'Binanın bağlandığı zincirler (en yakın 3), kapısındaki addr:street ile uyuşuyor (aynı sokak yazımları eşdeğer)',
    kind: 'auto',
    threshold: `ilk üç aday içinde ≥ %${MIN_CHAIN}; ilk aday ayrıca raporlanır`,
    async measure() {
      const q = read<Quality>('a5_quality');
      if (!q) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const rows = Object.entries(q);
      const three = weighted(rows.map(([, v]) => ({ value: v.chainTopThree, weight: v.reachableDoors })));
      const first = weighted(rows.map(([, v]) => ({ value: v.chainFirst, weight: v.reachableDoors })));
      const second = weighted(rows.map(([, v]) => ({ value: v.chainFirstOrSecond, weight: v.reachableDoors })));
      const measured = `${rows.length} il, ${rows.reduce((s, [, v]) => s + v.reachableDoors, 0)} kapılı bina: ilk üç %${three.toFixed(1)}, ilk iki %${second.toFixed(1)}, ilk aday %${first.toFixed(1)} (${rows.map(([p, v]) => `${p}: %${v.chainTopThree}`).join(', ')})`;
      return { status: three >= MIN_CHAIN ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A5.2',
    phase: 5,
    title: 'Taraf, tek/çift kuralıyla tutarlı (bağlanan zincirin tarafında tek ya da çift numaralar)',
    kind: 'auto',
    threshold: `≥ %${MIN_SIDE}`,
    async measure() {
      const q = read<Quality>('a5_quality');
      if (!q) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const rows = Object.entries(q);
      const side = weighted(rows.map(([, v]) => ({ value: v.side, weight: v.sideDoors })));
      return { status: side >= MIN_SIDE ? 'pass' : 'fail', measured: `${rows.reduce((s, [, v]) => s + v.sideDoors, 0)} kapı: %${side.toFixed(1)} (${rows.map(([p, v]) => `${p}: %${v.side}`).join(', ')})` };
    },
  },
  {
    id: 'A5.3',
    phase: 5,
    title: 'Kat sayısı kaynak dağılımı ve OSM building:levels olan binalarda tahmin hatası raporlandı',
    kind: 'auto',
    threshold: 'rapor var',
    async measure() {
      const b = read<Build>('a5_build');
      if (!b) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const rows = Object.entries(b);
      const known = rows.reduce((s, [, v]) => s + v.floors.known, 0);
      const within = rows.reduce((s, [, v]) => s + (v.floors.within1 * v.floors.known) / 100, 0);
      const src = rows[0]?.[1].floors.sources;
      const measured = `${rows.length} il; kaynak (${rows[0]?.[0]}): ${src ? Object.entries(src).map(([k, v]) => `${k} %${v}`).join(', ') : '-'}; OSM kat sayısı bilinen ${known} binada gizlenip tahmin: ±1 kat içinde %${known === 0 ? 0 : ((100 * within) / known).toFixed(1)}`;
      return { status: 'pass', measured };
    },
  },
  {
    id: 'A5.4',
    phase: 5,
    title: 'Boyut ve açılış süresi raporlandı',
    kind: 'auto',
    threshold: 'rapor var',
    async measure() {
      const b = read<Build>('a5_build');
      if (!b) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const rows = Object.entries(b);
      return { status: 'pass', measured: rows.map(([p, v]) => `${p}: ${v.buildings} bina, ${v.sizeMb} MB, açılış ${v.openMs} ms, nokta sorgusu p95 ${v.atP95Ms} ms`).join('; ') };
    },
  },
  {
    id: 'A5.5',
    phase: 5,
    title: 'Hermes: bina sorgusu Node ile birebir, p95 ≤ 5 ms',
    kind: 'auto',
    threshold: `fark 0, p95 ≤ ${MAX_HERMES_MS} ms`,
    async measure() {
      const m = read<{ total: number; different: number; p95: number }>('a5_hermes');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.different === 0 && m.p95 <= MAX_HERMES_MS ? 'pass' : 'fail', measured: `${m.total} sorgu, fark ${m.different}, p95 ${m.p95.toFixed(2)} ms` };
    },
  },
  {
    id: 'A5.6',
    phase: 5,
    title: 'Yerleşim kümesi merkezi, çevredeki köy kapılarının merkezine ortanca uzaklık',
    kind: 'auto',
    threshold: `≤ ${MAX_VILLAGE_M} m`,
    async measure() {
      const m = read<{ villages: number; median: number | null; within300: number; plates: string[] }>('a5_settlements');
      if (!m || m.median === null) return { status: 'open', measured: 'ölçülebilir köy yok' };
      return { status: m.median <= MAX_VILLAGE_M ? 'pass' : 'fail', measured: `${m.villages} köy (${m.plates.join(', ')}; küçük örnek): ortanca ${m.median} m, ${m.within300} köyde ≤ ${MAX_VILLAGE_M} m` };
    },
  },
  {
    id: 'A5.7',
    phase: 5,
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
    id: 'A5.8',
    phase: 5,
    title: 'Telefonda bina testi (sdk.addr-buildings) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-buildings'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-buildings')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return { status: outcome(ios) === 'pass' && outcome(android) === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
