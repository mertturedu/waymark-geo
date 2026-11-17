import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

async function measure(run: GateContext['run'], script: string, check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', `scripts/${script}.ts`, `--check=${check}`]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.91;
const verdict = (real: Check | null): { status: 'pass' | 'fail'; measured: string } => (real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' });

export const adres16fGates: Gate[] = [
  {
    id: 'A16F.1',
    phase: PHASE,
    title: 'Kararlı kimlik: aynı veride iki derlemede mahalle ve sokak kimlikleri aynı; adı değişen sokak (yol parçaları aynıysa) kimliğini korur; kapı kimliği OSM kimliğinden',
    kind: 'auto',
    threshold: 'kimliklerin ≥ %99,9\'u aynı',
    async measure({ run }) {
      return verdict(await measure(run, 'measure-ids', 'stable'));
    },
  },
  {
    id: 'A16F.2',
    phase: PHASE,
    title: 'Ülke temeli (kapı ve işletme olmadan sokak dizini) ile kurulu olmayan bir ilin adresi sokak düzeyinde çözülür',
    kind: 'auto',
    threshold: 'G2 metinlerinde sokak doğru ≥ %80; boyut raporlandı',
    async measure({ run }) {
      return verdict(await measure(run, 'measure-country', 'street'));
    },
  },
  {
    id: 'A16F.3',
    phase: PHASE,
    title: 'Gezinme uçları (ülke → il → ilçe → mahalle → sokak, aralık, kimlik çözme) ve toplu geocode / CSV doğrulama doğrudan aramayla birebir; toplu istek süresi ölçüldü',
    kind: 'auto',
    threshold: 'uyumsuz 0',
    async measure({ run }) {
      const nav = await measure(run, 'measure-national-api', 'nav');
      const batch = await measure(run, 'measure-national-api', 'batch');
      if (!nav || !batch) return { status: 'fail', measured: 'ölçüm çalışmadı' };
      return { status: nav.pass && batch.pass ? 'pass' : 'fail', measured: `${nav.measured.replace(/^ \| /, '')}; ${batch.measured}` };
    },
  },
  {
    id: 'A16F.4',
    phase: PHASE,
    title: 'Telefonda ülke temeli ile çözümleme, kimlik çözme ve gezinme (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-country pass',
    async measure({ reportDir }) {
      const ios = deviceEntry(reportDir, 'sdk.addr-country', true);
      const android = deviceEntry(reportDir, 'sdk.addr-country', false);
      const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 200)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A16F.5',
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
];
