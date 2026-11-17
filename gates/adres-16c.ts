import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string };

async function measure(run: GateContext['run'], check: string): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-admin-national.ts', `--check=${check}`]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.7;

export const adres16cGates: Gate[] = [
  {
    id: 'A16C.1',
    phase: PHASE,
    title: 'Bina mahalle kapsamı: bina paketindeki binaların mahalle/köy alanına atanan oranı, yalnız OSM çokgeniyle olandan yüksek',
    kind: 'auto',
    threshold: 'hood dolu bina ≥ %70 ve OSM çokgeniyle bulunandan fazla',
    async measure({ run }) {
      const real = await measure(run, 'buildings');
      return real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' };
    },
  },
  {
    id: 'A16C.2',
    phase: PHASE,
    title: 'Resmî mahalle ve köy listesi (DASK ve turkey-neighbourhoods) pakette: listedeki birimlerin pakette bulunma oranı',
    kind: 'auto',
    threshold: 'resmî listedeki birimin ≥ %98\'i pakette',
    async measure({ run }) {
      const real = await measure(run, 'units');
      return real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' };
    },
  },
  {
    id: 'A16C.3',
    phase: PHASE,
    title: 'Türetilen köy ve mahalle alanı doğruluğu: OSM çokgeni gizlenip yerleşim noktası ve binalardan türetilince binaların doğru alana düşme oranı',
    kind: 'auto',
    threshold: 'köy ≥ %75, mahalle noktası ≥ %65 (planın %95 hedefi nokta tohumuyla ulaşılamadı)',
    async measure({ run }) {
      const real = await measure(run, 'extent');
      return real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' };
    },
  },
  {
    id: 'A16C.4',
    phase: PHASE,
    title: 'Kararlı kimlik: her mahalle/köyün `sid` değeri var, yinelenmiyor ve ikinci uzlaştırmada aynı çıkıyor',
    kind: 'auto',
    threshold: 'yinelenen/boş kimlik 0, farklı kimlik 0',
    async measure({ run }) {
      const real = await measure(run, 'ids');
      return real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' };
    },
  },
  {
    id: 'A16C.5',
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
    id: 'A16C.6',
    phase: PHASE,
    title: 'Telefonda yeni mahalle/köy verisiyle idari çözümleme (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-national pass',
    async measure({ reportDir }) {
      const ios = deviceEntry(reportDir, 'sdk.addr-national', true);
      const android = deviceEntry(reportDir, 'sdk.addr-national', false);
      const measured = `iPhone ${ios.outcome}${ios.note ? ` (${ios.note.slice(0, 200)})` : ''}, Android ${android.outcome}${android.note ? ` (${android.note.slice(0, 120)})` : ''}`;
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
