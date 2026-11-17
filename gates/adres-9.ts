import { readMeasures } from '../tools/compare/measures';
import { NOTE_CODES, PRECISIONS, STATUSES } from '../src/core/address/validate-text';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Rank = { set: string; n: number; first: number; top3: number; top8: number; inBest: number };
type Validate = { corrupted: number; caught: number; per: Record<string, { n: number; caught: number }>; clean: number; falseRate: number; falseCodes: Record<string, number> };
type Suggest = Record<'neighbourhood' | 'district' | 'street', { n: number; suggested: number; right: number }>;

const FAZ1_BASELINE_G2_30M = 80.2;
const LANGUAGES = 6;

const entryOf = (reportDir: string, ios: boolean): { outcome: string; value: number } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-validate')).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.addr-validate');
  return { outcome: entry?.outcome ?? 'yok', value: Number(entry?.value ?? NaN) };
};

export const adres9Gates: Gate[] = [
  {
    id: 'A9.1',
    phase: 9,
    title: 'İlk sırada doğru (≤ 50 m) tabana göre ≥ +25 puan (G1S + G2; geçici)',
    kind: 'auto',
    threshold: '≥ +25 puan (taban: Faz 1 SDK ölçümü, G2 ≤ 30 m %80,2)',
    allowOpen: true,
    async measure() {
      const g1s = read<Rank>('a9_rank_g1s');
      const g2 = read<Rank>('a9_rank_g2');
      if (!g1s || !g2) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const gain = Math.round((g2.first - FAZ1_BASELINE_G2_30M) * 10) / 10;
      return { status: gain >= 25 ? 'pass' : 'fail', measured: `G2 (${g2.n} kayıt) ilk sırada %${g2.first} (taban %${FAZ1_BASELINE_G2_30M}, ${gain >= 0 ? '+' : ''}${gain} puan); G1S (${g1s.n} kayıt) %${g1s.first}. Sıralamayla kazanılabilecek pay: G2 %${g2.inBest}, G1S %${g1s.inBest}` };
    },
  },
  {
    id: 'A9.2',
    phase: 9,
    title: 'Bilerek bozulan bileşenlerin ≥ %90\'ı doğru notu alıyor; temizde yanlış not ≤ %2',
    kind: 'auto',
    threshold: 'doğru not ≥ %90, yanlış not ≤ %2',
    async measure() {
      const m = read<Validate>('a9_validate');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const per = Object.entries(m.per).map(([k, v]) => `${k} %${v.caught} (${v.n})`).join(', ');
      return { status: m.caught >= 90 && m.falseRate <= 2 ? 'pass' : 'fail', measured: `${m.corrupted} bozuk kayıtta doğru not %${m.caught} (${per}); ${m.clean} temiz kayıtta yanlış not %${m.falseRate}` };
    },
  },
  {
    id: 'A9.3',
    phase: 9,
    title: '6 dilde not, tür ve durum metinleri eksiksiz',
    kind: 'auto',
    threshold: 'her not kodu, kesinlik türü ve durum 6 dilde dolu, yer tutucu kalmadı',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/address/validate.test.ts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      const count = (NOTE_CODES.length + PRECISIONS.length + STATUSES.length) * LANGUAGES;
      return { status: code === 0 ? 'pass' : 'fail', measured: `${NOTE_CODES.length} not, ${PRECISIONS.length} tür, ${STATUSES.length} durum × ${LANGUAGES} dil = ${count} metin; ${tail}` };
    },
  },
  {
    id: 'A9.4',
    phase: 9,
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
    id: 'A9.5',
    phase: 9,
    title: 'Telefonda sdk.addr-validate iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `iPhone ${ios.outcome}${Number.isFinite(ios.value) ? ` (p95 ${ios.value} ms)` : ''}, Android ${android.outcome}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A9.6',
    phase: 9,
    title: 'Bunu mu demek istediniz: bir harf eksik yazılan mahalle, ilçe ve sokak düzeltiliyor (plana ek kapı)',
    kind: 'auto',
    threshold: 'mahalle ve ilçe ≥ %90, sokak ≥ %75',
    async measure() {
      const m = read<Suggest>('a9_suggest');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.neighbourhood.right >= 90 && m.district.right >= 90 && m.street.right >= 75 ? 'pass' : 'fail', measured: `mahalle %${m.neighbourhood.right} (${m.neighbourhood.n}), ilçe %${m.district.right} (${m.district.n}), sokak %${m.street.right} (${m.street.n})` };
    },
  },
];
