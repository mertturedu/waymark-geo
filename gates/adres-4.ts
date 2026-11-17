import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const MIN_PRECISION = 95;
const TARGET_GAIN = 10;

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Groups = { groups: Record<string, { count: number; street: number; within30: number }> };
type Streets = { total: number; sdkShare: number; rivalShare: number; named: { tried: number; sdkShare: number; rivalShare: number } };

export const adres4Gates: Gate[] = [
  {
    id: 'A4.1',
    phase: 4,
    title: 'Sokak adı geri bulma kesinliği (OSM adları gizlenip işletme adreslerinden aynı ad bulunuyor)',
    kind: 'auto',
    threshold: `≥ %${MIN_PRECISION}`,
    async measure() {
      const m = read<{ plates: string[]; tried: number; proposed: number; correct: number; precision: number; coverage: number; derived: number }>('a4_names');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const measured = `${m.tried} gizlenmiş yol, ${m.proposed} öneri, ${m.correct} doğru: kesinlik %${m.precision}, kapsam %${m.coverage}; ${m.derived} adsız yola ad verildi`;
      return { status: m.precision >= MIN_PRECISION ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A4.2',
    phase: 4,
    title: `Sokak bulundu oranı tabana göre ≥ +${TARGET_GAIN} puan (G0 ve G1S; geçici: yalnız G2 ölçülebiliyor)`,
    kind: 'auto',
    threshold: `≥ +${TARGET_GAIN} puan (gerçek veride)`,
    allowOpen: true,
    async measure() {
      const base = read<Groups>('a4_base');
      const now = read<Groups>('a4_new');
      if (!base || !now) return { status: 'open', measured: 'ölçüm yok' };
      const gain = (g: string): string => `${g} %${base.groups[g]?.street} → %${now.groups[g]?.street}`;
      return { status: 'open', measured: `G2 sentetik tavana yakın: tümü ${gain('tümü')}, yazım hatalı ${gain('street_typo')}, türü yazılmayan ${gain('kind_drop')}; +${TARGET_GAIN} puan gerçek veriyle (G0/G1S) ölçülecek` };
    },
  },
  {
    id: 'A4.3',
    phase: 4,
    title: 'Sokak bulmada Nominatim\'e göre ≥ eşit; adlandırılan yollarda üstün',
    kind: 'auto',
    threshold: 'SDK ≥ Nominatim; adlandırılan yollarda SDK > Nominatim',
    async measure() {
      const m = read<Streets>('a4_streets_s4');
      if (!m) return { status: 'open', measured: 'ölçüm yok' };
      const ok = m.sdkShare >= m.rivalShare && m.named.sdkShare > m.named.rivalShare;
      return { status: ok ? 'pass' : 'fail', measured: `${m.total} kayıt: SDK %${m.sdkShare}, Nominatim %${m.rivalShare}; adlandırılan ${m.named.tried} yol: SDK %${m.named.sdkShare}, Nominatim %${m.named.rivalShare}` };
    },
  },
  {
    id: 'A4.4',
    phase: 4,
    title: 'Paket büyümesi raporlandı',
    kind: 'auto',
    threshold: 'rapor var; büyüme ≤ %5',
    async measure() {
      const m = read<{ total: { before: number; after: number; growth: number } }>('a4_size');
      if (!m) return { status: 'open', measured: 'ölçüm yok' };
      return { status: m.total.growth <= 5 ? 'pass' : 'fail', measured: `4 il adres paketi ${(m.total.before / 1e6).toFixed(1)} MB → ${(m.total.after / 1e6).toFixed(1)} MB (%${m.total.growth})` };
    },
  },
  {
    id: 'A4.5',
    phase: 4,
    title: 'Mevcut altın küme (G6) ve metin, adres, hat testleri gerilemedi',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A4.6',
    phase: 4,
    title: 'Telefonda sokak testi (sdk.addr-streets) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-streets'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-streets')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return { status: outcome(ios) === 'pass' && outcome(android) === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
