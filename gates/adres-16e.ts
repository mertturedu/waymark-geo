import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

async function measure(run: GateContext['run'], check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-numbers.ts', `--check=${check}`]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.9;
const verdict = (real: Check | null, pass: boolean | null = null): { status: 'pass' | 'fail'; measured: string } => (real ? { status: (pass ?? real.pass) ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' });

export const adres16eGates: Gate[] = [
  {
    id: 'A16E.1',
    phase: PHASE,
    title: 'Sokağa bağlı binaların numara durumu (bilinen ya da tahmini) ve hiçbir tahminin `approximate: false` sayılmaması',
    kind: 'auto',
    threshold: 'numara durumu olan bağlı bina ≥ %90',
    async measure({ run }) {
      return verdict(await measure(run, 'coverage'));
    },
  },
  {
    id: 'A16E.2',
    phase: PHASE,
    title: 'Gizlenmiş OSM kapılarında tahmini numara (kapıların %25\'i gizli, 4 il)',
    kind: 'auto',
    threshold: 'doğru bina ≥ %70, ortanca konum hatası ≤ 12 m, ±2 numara ≥ %85',
    async measure({ run }) {
      return verdict(await measure(run, 'hidden'));
    },
  },
  {
    id: 'A16E.3',
    phase: PHASE,
    title: 'Sokak-taraf-parça numara aralığı gizlenmiş OSM kapılarının numarasını kapsıyor (aralık: çapalar ve tahmin edilen uçlar, ±2)',
    kind: 'auto',
    threshold: 'kapsama ≥ %95',
    async measure({ run }) {
      const real = await measure(run, 'hidden');
      return verdict(real, real ? (real.numbers?.range ?? 0) >= 0.95 : null);
    },
  },
  {
    id: 'A16E.4',
    phase: PHASE,
    title: 'Bilinen kapı sayısı (OSM ve rehber, binaya yerleşen) raporlandı',
    kind: 'auto',
    threshold: 'bilinen kapı sayısı ve il bazında kapı/bina oranı raporda; boyut artışı raporlandı',
    async measure({ run }) {
      const real = await measure(run, 'coverage');
      return verdict(real, real ? (real.numbers?.known ?? 0) > 0 : null);
    },
  },
  {
    id: 'A16E.5',
    phase: PHASE,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme, sunucu, harita mantığı)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real, test/scripts, test/server, test/geo, test/native geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts', 'test/server', 'test/geo', 'test/native']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A16E.6',
    phase: PHASE,
    title: 'Telefonda bina numarası ve sokak aralığı okuma, ve mevcut numara testleri (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-numbers, sdk.addr-sequence, sdk.addr-reverse ve sdk.addr-validate pass',
    async measure({ reportDir }) {
      const ids = ['sdk.addr-numbers', 'sdk.addr-sequence', 'sdk.addr-reverse', 'sdk.addr-validate'];
      const parts = ids.map((id) => ({ id, ios: deviceEntry(reportDir, id, true), android: deviceEntry(reportDir, id, false) }));
      const measured = parts.map((p) => `${p.id}: iPhone ${p.ios.outcome}, Android ${p.android.outcome}`).join('; ');
      if (parts.some((p) => p.ios.outcome === 'yok' || p.android.outcome === 'yok')) return { status: 'open', measured };
      return { status: parts.every((p) => p.ios.outcome === 'pass' && p.android.outcome === 'pass') ? 'pass' : 'fail', measured };
    },
  },
];
