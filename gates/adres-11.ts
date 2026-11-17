import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Typing = { texts: number; streetMedian: number; doorMedian: number; streetReached: number; doorReached: number; textLengthMedian: number; keyMsP95: number; keyMsMedian: number };
type Labels = { n: number; province: number; district: number; both: number };

const entryOf = (reportDir: string, ios: boolean): { outcome: string; value: number } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-typeahead')).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.addr-typeahead');
  return { outcome: entry?.outcome ?? 'yok', value: Number(entry?.value ?? NaN) };
};

const cut = (base: number, now: number): number => (base === 0 ? 0 : Math.round((100 * (base - now)) / base));

export const adres11Gates: Gate[] = [
  {
    id: 'A11.1',
    phase: 11,
    title: 'İlk 3\'e giriş tuş ortancası tabana göre ≥ %40 az ve Photon\'dan ≤ (G1S, yazıldığı gibi ve sokak önde)',
    kind: 'auto',
    threshold: 'tabana göre ≥ %40 az (sokak ve kapı), Photon\'dan ≤',
    async measure() {
      const base = read<Typing>('a11_taban');
      const now = read<Typing>('a11_final');
      const photon = read<Typing>('a11_photon');
      const baseS = read<Typing>('a11_taban_street');
      const nowS = read<Typing>('a11_final_street');
      const photonS = read<Typing>('a11_photon_street');
      if (!base || !now || !photon || !baseS || !nowS || !photonS) return { status: 'open', measured: 'ölçüm koşulmadı' };
      const cuts = [cut(base.streetMedian, now.streetMedian), cut(base.doorMedian, now.doorMedian), cut(baseS.streetMedian, nowS.streetMedian), cut(baseS.doorMedian, nowS.doorMedian)];
      const underPhoton = now.streetMedian <= photon.streetMedian && now.doorMedian <= photon.doorMedian && nowS.streetMedian <= photonS.streetMedian && nowS.doorMedian <= photonS.doorMedian;
      const text = `yazıldığı gibi (${now.texts} metin, ortanca ${now.textLengthMedian} harf): sokak ${base.streetMedian} → ${now.streetMedian} (%${cuts[0]} az, Photon ${photon.streetMedian}), kapı ${base.doorMedian} → ${now.doorMedian} (%${cuts[1]} az, Photon ${photon.doorMedian}); sokak önde (ortanca ${nowS.textLengthMedian} harf): sokak ${baseS.streetMedian} → ${nowS.streetMedian} (%${cuts[2]}, Photon ${photonS.streetMedian}), kapı ${baseS.doorMedian} → ${nowS.doorMedian} (%${cuts[3]}, Photon ${photonS.doorMedian})`;
      return { status: cuts.every((c) => c >= 40) && underPhoton ? 'pass' : 'fail', measured: text };
    },
  },
  {
    id: 'A11.2',
    phase: 11,
    title: 'Tuş başına p95 ≤ 30 ms (iPhone 11), ≤ 60 ms (Android; emülatör vekil)',
    kind: 'device',
    threshold: 'iPhone p95 ≤ 30 ms, Android p95 ≤ 60 ms',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `iPhone p95 ${Number.isFinite(ios.value) ? ios.value : 'yok'} ms, Android (emülatör) p95 ${Number.isFinite(android.value) ? android.value : 'yok'} ms`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.value <= 30 && android.value <= 60 ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A11.3',
    phase: 11,
    title: 'Önerilerin ≥ %99\'unda il/ilçe etiketi doğru (noktanın içinde bulunduğu ilçe ve il ile)',
    kind: 'auto',
    threshold: '≥ %99',
    async measure() {
      const m = read<Labels>('a11_labels');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.both >= 99 ? 'pass' : 'fail', measured: `${m.n} öneri: il %${m.province}, ilçe %${m.district}, ikisi %${m.both}` };
    },
  },
  {
    id: 'A11.4',
    phase: 11,
    title: 'Telefonda sdk.addr-typeahead (100 metin tuş tuş) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass (her tuşta ilk 3 öneri Node ile aynı)',
    async measure({ reportDir }) {
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `iPhone ${ios.outcome}, Android ${android.outcome}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A11.5',
    phase: 11,
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
