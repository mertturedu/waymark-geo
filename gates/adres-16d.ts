import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string };

async function measure(run: GateContext['run'], check: string, extra: string[] = []): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', 'scripts/measure-streets-national.ts', `--check=${check}`, ...extra]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.8;
const verdict = (real: Check | null): { status: 'pass' | 'fail'; measured: string } => (real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' });

export const adres16dGates: Gate[] = [
  {
    id: 'A16D.1',
    phase: PHASE,
    title: 'Bağlı bina oranı: binanın adlı sokağa ya da adsız yola bağlı olması',
    kind: 'auto',
    threshold: 'bağlı bina ≥ %85',
    async measure({ run }) {
      return verdict(await measure(run, 'links'));
    },
  },
  {
    id: 'A16D.1b',
    phase: PHASE,
    title: 'Bağ doğruluğu: kapının içindeki ya da 6 m yakınındaki adlı bağlı binanın sokağı kapının sokağıyla aynı (komşu kapı etiketleri kullanılır, binanın kendi kapısı gizli)',
    kind: 'auto',
    threshold: 'ilk sokak doğru ≥ %90',
    async measure({ run }) {
      return verdict(await measure(run, 'links', ['--accuracy']));
    },
  },
  {
    id: 'A16D.2',
    phase: PHASE,
    title: 'Adsız yol adlandırma (işletme ve kapı etiketi, en az 3 bağımsız kanıt): gizlenen adlı yollarda kesinlik, ad verilen yol sayısı yalnız işletmeyle olandan fazla',
    kind: 'auto',
    threshold: 'kesinlik ≥ %95 ve eklenen ad sayısı artmış',
    async measure({ run }) {
      return verdict(await measure(run, 'names'));
    },
  },
  {
    id: 'A16D.3',
    phase: PHASE,
    title: 'Kararlı sokak kimliği: her sokakta `sid` var, yinelenmiyor, ad ve türden yeniden hesaplanınca aynı; çizgisiz sokaklar kapılardan çiziliyor ve gizlenen gerçek çizgilerde makul uzaklıkta',
    kind: 'auto',
    threshold: 'kimlik farkı/yinelenen 0; türetilen çizgi p90 ≤ 60 m',
    async measure({ run }) {
      const ids = await measure(run, 'ids');
      const lines = await measure(run, 'lines');
      if (!ids || !lines) return { status: 'fail', measured: 'ölçüm çalışmadı' };
      return { status: ids.pass && lines.pass ? 'pass' : 'fail', measured: `${ids.measured}; ${lines.measured}` };
    },
  },
  {
    id: 'A16D.4',
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
    id: 'A16D.5',
    phase: PHASE,
    title: 'Telefonda sokak, bina ve yol bağı testleri (iPhone ve Android)',
    kind: 'device',
    threshold: 'iki platformda sdk.addr-streets ve sdk.addr-roads pass',
    async measure({ reportDir }) {
      const parts = ['sdk.addr-streets', 'sdk.addr-roads'].map((id) => ({ id, ios: deviceEntry(reportDir, id, true), android: deviceEntry(reportDir, id, false) }));
      const measured = parts.map((p) => `${p.id}: iPhone ${p.ios.outcome}${p.ios.note ? ` (${p.ios.note.slice(0, 120)})` : ''}, Android ${p.android.outcome}`).join('; ');
      if (parts.some((p) => p.ios.outcome === 'yok' || p.android.outcome === 'yok')) return { status: 'open', measured };
      return { status: parts.every((p) => p.ios.outcome === 'pass' && p.android.outcome === 'pass') ? 'pass' : 'fail', measured };
    },
  },
];
