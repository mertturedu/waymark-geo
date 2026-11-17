import type { Lang } from '../../../../src/core/text/types';
import type { DeviceTest } from '../../device-test/types';
import { ensureIstanbul, openGeo } from '../sandbox';
import { BESIKTAS, ensureRoute, firstDoor, FULL, GOLDEN, HINT, KADIKOY, metres, percentile } from './helpers';

const SAMPLE = 100;
const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });
const sample = (count: number, every: number) => GOLDEN.filter((_, i) => i % every === 0).slice(0, count);

export const sdkAddressGolden = test('sdk.address-golden', 'Adres: 100 altın sorguda kapı numarası doğru', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    let right = 0;
    let resolved = 0;
    const times: number[] = [];
    for (const q of sample(SAMPLE, 3)) {
      const started = Date.now();
      const found = await geo.search.resolve(q.text, HINT);
      times.push(Date.now() - started);
      if (found.status === 'resolved') {
        resolved += 1;
        if (q.expect.number === undefined || found.best.components.houseNumber === q.expect.number) right += 1;
      }
    }
    const share = right / SAMPLE;
    return { outcome: share >= 0.9 ? 'pass' : 'fail', value: String(Math.round(share * 100)), unit: '% doğru kapı', threshold: '≥ 90%', note: `${resolved} çözüldü, ${right} doğru; p95 ${percentile(times, 0.95)} ms` };
  } finally {
    await geo.dispose();
  }
});

export const sdkAddressTypo = test('sdk.address-typo', 'Adres: yazım hatalı sokak adında kapı numarası yine bulunur', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const swap = (text: string): string => {
      const words = text.split(' ');
      const at = words.reduce((best, word, i) => (word.length > (words[best] as string).length && /^[A-Za-zÇĞİÖŞÜçğıöşü]+$/.test(word) ? i : best), 0);
      const word = words[at] as string;
      words[at] = word.slice(0, 2) + word[3] + word[2] + word.slice(4);
      return words.join(' ');
    };
    const queries = FULL.slice(0, 40);
    let right = 0;
    for (const q of queries) {
      const found = await geo.search.resolve(swap(q.text), HINT);
      const first = found.status === 'resolved' ? found.best : found.status === 'region_missing' ? undefined : found.candidates[0];
      if (first?.components.houseNumber === q.expect.number) right += 1;
    }
    const share = right / queries.length;
    return { outcome: share >= 0.85 ? 'pass' : 'fail', value: String(Math.round(share * 100)), unit: '% doğru kapı', threshold: '≥ 85%', note: `${queries.length} yazım hatalı sorgudan ${right}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkAutocomplete = test('sdk.autocomplete', 'Adres: yazarken öneri gelir ve hızlıdır', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const words = door.text.split(' ');
    const prefixes = [3, 4, 5, 6].map((n) => words.slice(0, n).join(' '));
    const times: number[] = [];
    for (const prefix of prefixes) {
      const started = Date.now();
      const list = await geo.search.autocomplete(prefix, HINT);
      times.push(Date.now() - started);
      if (list.length === 0) return { outcome: 'fail', note: `"${prefix}" için öneri yok` };
    }
    const worst = Math.max(...times);
    return { outcome: worst <= 200 ? 'pass' : 'fail', value: String(worst), unit: 'ms (en yavaş)', threshold: '≤ 200 ms', note: `${prefixes.length} önek, hepsinde öneri var` };
  } finally {
    await geo.dispose();
  }
});

export const sdkReverseSearch = test('sdk.reverse-search', 'Adres: noktadan geri arama aynı sokağı verir', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    let tried = 0;
    let same = 0;
    for (const q of sample(60, 3)) {
      const found = await geo.search.resolve(q.text, HINT);
      if (found.status !== 'resolved' || !found.best.components.street) continue;
      tried += 1;
      if (tried > 30) break;
      const back = await geo.search.reverse(found.best.coordinate);
      if (back?.components.street === found.best.components.street) same += 1;
    }
    if (tried < 20) return { outcome: 'fail', note: `yalnızca ${tried} adres çözüldü` };
    const share = same / tried;
    return { outcome: share >= 0.9 ? 'pass' : 'fail', value: String(Math.round(share * 100)), unit: '% aynı sokak', threshold: '≥ 90%', note: `${tried} noktadan ${same}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkLanguages = test('sdk.languages', 'Adres: altı dilde etiket ve yazı sistemleri', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const labels: Record<string, string> = {};
    for (const language of ['tr', 'en', 'de', 'ar', 'ru', 'el'] as Lang[]) {
      const found = await geo.search.resolve(door.text, { ...HINT, language });
      if (found.status !== 'resolved') return { outcome: 'fail', note: `${language}: durum ${found.status}` };
      labels[language] = found.best.label;
    }
    const scripts: [string, RegExp][] = [['ar', /[؀-ۿ]/], ['ru', /[Ѐ-ӿ]/], ['el', /[Ͱ-Ͽ]/]];
    for (const [language, pattern] of scripts) if (!pattern.test(labels[language] as string)) return { outcome: 'fail', note: `${language} etiketinde beklenen yazı yok: ${labels[language]}` };
    if (labels.en === labels.tr) return { outcome: 'fail', note: 'en etiketi tr ile aynı' };
    return { outcome: 'pass', note: `en: ${labels.en}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkNotFound = test('sdk.not-found', 'Adres: anlamsız metinde bulunamadı durumu', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const found = await geo.search.resolve('zzqxw yyvvk 99', HINT);
    return found.status === 'not_found' ? { outcome: 'pass' } : { outcome: 'fail', note: `durum ${found.status}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkHoodsCoverage = test('sdk.hoods-coverage', 'Adres: İstanbul mahalle etiketleri ve Kadıköy kapsamı', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const hoods = await geo.search.hoods();
    if (hoods.length < 900) return { outcome: 'fail', note: `yalnızca ${hoods.length} mahalle etiketi` };
    const coverage = await geo.search.coverage(KADIKOY);
    if (coverage?.district !== 'Kadıköy' || coverage.level !== 'rich') return { outcome: 'fail', note: `kapsam ${JSON.stringify(coverage)}` };
    return { outcome: 'pass', note: `${hoods.length} etiket; Kadıköy ${coverage.streets} sokak, ${coverage.addresses} kapı` };
  } finally {
    await geo.dispose();
  }
});

export const sdkReverseDistance = test('sdk.reverse-distance', 'Adres: bulunan kapının noktası yakın ters aramayla uyumlu', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const back = await geo.search.reverse(door.place.coordinate);
    if (!back) return { outcome: 'fail', note: 'ters arama boş' };
    const drift = metres(door.place.coordinate, back.coordinate);
    return { outcome: drift <= 60 ? 'pass' : 'fail', value: String(Math.round(drift)), unit: 'm', threshold: '≤ 60 m', note: back.label };
  } finally {
    await geo.dispose();
  }
});

export const sdkOfflineSearch = test('sdk.offline-search', 'Ağsız arama ve rota: bağlantı tamamen kapalıyken sonuç gelir', async (ctx) => {
  const offline = async (): Promise<never> => {
    throw new Error('ağ kapalı');
  };
  const prepared = await ensureRoute(ctx);
  await prepared.geo.dispose();
  const { geo: closed } = await openGeo(ctx, 'main', { wipe: false, net: { get: offline, getText: offline } });
  try {
    const door = await firstDoor(closed);
    if (!door) return { outcome: 'fail', note: 'ağsız kapı çözülemedi' };
    const suggestions = await closed.search.autocomplete('Bağdat Cad', HINT);
    if (suggestions.length === 0) return { outcome: 'fail', note: 'ağsız öneri boş' };
    const leg = await closed.route.route(KADIKOY, BESIKTAS);
    if (!leg.ok) return { outcome: 'fail', note: `ağsız rota ${leg.code}` };
    return { outcome: 'pass', note: `kapı ve ${suggestions.length} öneri geldi, rota ${(leg.distanceM / 1000).toFixed(1)} km` };
  } finally {
    await closed.dispose();
  }
});

export const ADDRESS_TESTS: DeviceTest[] = [sdkAddressGolden, sdkAddressTypo, sdkAutocomplete, sdkReverseSearch, sdkReverseDistance, sdkLanguages, sdkNotFound, sdkHoodsCoverage, sdkOfflineSearch];
