import { readMeasures } from '../tools/compare/measures';
import { uploadedReports } from './fix-0';
import type { Gate } from './engine';

const COMPONENTS = ['province', 'district', 'hood', 'street', 'number', 'floor', 'door', 'block'];
const MIN_ALL = 92;
const MIN_NAMES = ['street', 'number', 'hood'];
const MIN_NAMES_VALUE = 90;
const MIN_UNIT = ['block', 'floor', 'door'];
const MIN_UNIT_VALUE = 95;
const MAX_ATTRIBUTABLE = 3;
const MAX_P95_MS = 3;

type Held = { count: number; f1: Record<string, number>; libpostal?: Record<string, number>; falseDrops: number };

const held = (): Held | undefined => readMeasures().a2_heldout as Held | undefined;

export const adres2Gates: Gate[] = [
  {
    id: 'A2.1',
    phase: 2,
    title: 'Bileşen F1, G2 ayrılmış dilimi (geliştirmede kullanılmayan kayıtlar), N-en-iyi',
    kind: 'auto',
    threshold: `ortalama ≥ %${MIN_ALL}; sokak, numara, mahalle ≥ %${MIN_NAMES_VALUE}; blok, kat, daire ≥ %${MIN_UNIT_VALUE}`,
    async measure() {
      const m = held();
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const mean = COMPONENTS.reduce((sum, c) => sum + (m.f1[c] ?? 0), 0) / COMPONENTS.length;
      const names = MIN_NAMES.every((c) => (m.f1[c] ?? 0) >= MIN_NAMES_VALUE);
      const unit = MIN_UNIT.every((c) => (m.f1[c] ?? 0) >= MIN_UNIT_VALUE);
      const measured = `${m.count} kayıt; ortalama %${mean.toFixed(1)}; ${COMPONENTS.map((c) => `${c} %${m.f1[c]}`).join(', ')}`;
      return { status: mean >= MIN_ALL && names && unit ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A2.2',
    phase: 2,
    title: 'SDK ayrıştırıcısı, libpostal\'dan her bileşende daha iyi ya da eşit',
    kind: 'auto',
    threshold: '8 bileşenin hepsinde F1 ≥ libpostal',
    async measure() {
      const m = held();
      if (!m?.libpostal) return { status: 'open', measured: 'libpostal ölçümü yok' };
      const lib = m.libpostal;
      const worse = COMPONENTS.filter((c) => (m.f1[c] ?? 0) < (lib[c] ?? 0));
      return { status: worse.length === 0 ? 'pass' : 'fail', measured: worse.length === 0 ? `8/8; en yakın fark ${Math.min(...COMPONENTS.map((c) => (m.f1[c] ?? 0) - (lib[c] ?? 0))).toFixed(1)} puan` : `libpostal önde: ${worse.join(', ')}` };
    },
  },
  {
    id: 'A2.3',
    phase: 2,
    title: 'G2\'de ayrıştırma kaynaklı çözümleme hatası (çözümleme >30 m yanlış ve N-en-iyi ayrıştırma da yanlış)',
    kind: 'auto',
    threshold: `≤ %${MAX_ATTRIBUTABLE}`,
    async measure() {
      const m = readMeasures().a2_attrib as { total: number; failedShare: number; attributableShare: number } | undefined;
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const measured = `${m.total} kayıt; çözümleme hatası %${m.failedShare}, bunun ayrıştırma kaynaklısı %${m.attributableShare}`;
      return { status: m.attributableShare <= MAX_ATTRIBUTABLE ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A2.4',
    phase: 2,
    title: 'Gürültü ayıklamada yanlış silme (telefon ve not dışı kayıtta ya da adres sözcüğü silinen kayıt)',
    kind: 'auto',
    threshold: '0',
    async measure() {
      const m = held();
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.falseDrops === 0 ? 'pass' : 'fail', measured: `${m.count} kayıtta ${m.falseDrops} yanlış silme` };
    },
  },
  {
    id: 'A2.5',
    phase: 2,
    title: 'Hermes: 3.000 vaka Node ile birebir, p95 ≤ 3 ms',
    kind: 'auto',
    threshold: `fark 0, p95 ≤ ${MAX_P95_MS} ms`,
    async measure() {
      const m = readMeasures().a2_hermes as { total: number; different: number; p95: number } | undefined;
      if (!m) return { status: 'open', measured: 'Hermes ölçümü koşulmadı' };
      const measured = `${m.total} vaka, fark ${m.different}, p95 ${m.p95} ms`;
      return { status: m.different === 0 && m.p95 <= MAX_P95_MS ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A2.6',
    phase: 2,
    title: 'Mevcut altın küme (G6) ve metin testleri gerilemedi',
    kind: 'auto',
    threshold: 'test/text ve K1.1 altın küme geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A2.7',
    phase: 2,
    title: 'Telefonda ayrıştırma testi (sdk.addr-parse) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-parse'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-parse')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return { status: outcome(ios) === 'pass' && outcome(android) === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
