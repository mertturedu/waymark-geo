import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Line = Record<string, unknown>;

async function jsonLine(run: GateContext['run'], script: string, args: string[] = []): Promise<Line | null> {
  const { out } = await run('npx', ['tsx', script, ...args]);
  const line = out.split('\n').filter((l) => l.startsWith('{')).pop();
  return line ? (JSON.parse(line) as Line) : null;
}

const PHASE = 16.6;
const MODEL_FILE = join(process.cwd(), 'pipeline', 'data', 'category-groups-model.json');
const DOC = join(process.cwd(), 'docs', 'enrichment.md');

const deviceGate = (id: string, title: string): Gate => ({
  id,
  phase: PHASE,
  title,
  kind: 'device',
  threshold: 'iki platformda sdk.addr-places, sdk.addr-streets ve sdk.manifest-migration pass',
  async measure({ reportDir }) {
    const parts: string[] = [];
    let open = false;
    let bad = false;
    for (const test of ['sdk.addr-places', 'sdk.addr-streets', 'sdk.manifest-migration']) {
      const ios = deviceEntry(reportDir, test, true);
      const android = deviceEntry(reportDir, test, false);
      parts.push(`${test.slice(4)}: iPhone ${ios.outcome}, Android ${android.outcome}`);
      if (ios.outcome === 'yok' || android.outcome === 'yok') open = true;
      else if (ios.outcome !== 'pass' || android.outcome !== 'pass') bad = true;
    }
    return { status: bad ? 'fail' : open ? 'open' : 'pass', measured: parts.join('; ') };
  },
});

export const adres16bGates: Gate[] = [
  {
    id: 'A16B.1',
    phase: PHASE,
    title: 'Kapsama haritası 81 il ve her mahalle için üretildi; zayıf alan listesi raporlandı',
    kind: 'auto',
    threshold: '81 il dosyası, özet ve zayıf alan listesi; her mahallede puan ve düzey',
    async measure({ run }) {
      const result = await jsonLine(run, 'scripts/coverage-map.ts');
      if (!result) return { status: 'fail', measured: 'kapsama üretimi çalışmadı' };
      const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'kapsama');
      const ok = result.plates === 81 && existsSync(join(dir, 'kapsama-ozet.md')) && existsSync(join(dir, 'zayif-alanlar.csv'));
      return { status: ok ? 'pass' : 'fail', measured: `${String(result.plates)} il, ${String(result.hoods)} mahalle, zayıf ${String(result.weak)}, ${String(result.seconds)} sn; özet ve zayıf alan listesi ${ok ? 'var' : 'yok'}` };
    },
  },
  {
    id: 'A16B.2',
    phase: PHASE,
    title: 'Model eşlemesi ve takma ad kesinliği ≥ %95 (gizlenmiş etiketlerle); altındakiler pakete girmez',
    kind: 'auto',
    threshold: 'pakete giren her kategori eşlemesi, gizlenmiş kural etiketine karşı ≥ %95 kesinlikli bir gruptan; takma ad: kesinlik ≥ %95 değilse hiçbiri girmez',
    async measure({ run }) {
      const categories = await jsonLine(run, 'scripts/enrich-categories.ts');
      const aliases = await jsonLine(run, 'scripts/enrich-aliases.ts');
      if (!categories || !aliases || !existsSync(MODEL_FILE)) return { status: 'fail', measured: 'ölçüm çalışmadı' };
      const file = JSON.parse(readFileSync(MODEL_FILE, 'utf8')) as { groups: Record<string, string>; precision: Record<string, { n: number; right: number }> };
      const bad = Object.values(file.groups).filter((g) => !(file.precision[g] && file.precision[g].n >= 5 && file.precision[g].right / file.precision[g].n >= 0.95));
      const total = Number(categories.agreeKnown);
      const right = Number(categories.agreeRight);
      const aliasPass = Number(aliases.agreedPrecision) >= 0.95 && Number(aliases.agreed) >= 20;
      return { status: bad.length === 0 ? 'pass' : 'fail', measured: `kategori: iki modelin anlaştığı ${total} kural gruplu kategoriden ${right} kuralla aynı (%${((100 * right) / Math.max(1, total)).toFixed(1)}); pakete giren ${Object.keys(file.groups).length} eşleme (${String(categories.acceptedPois)} işletme), eşik altı gruptan ${bad.length}; takma ad: ${String(aliases.proposed)} öneriden ${String(aliases.verified)} gerçek takma adla aynı (kesinlik %${(100 * Number(aliases.precision)).toFixed(1)}, iki modelin ortak önerisinde %${(100 * Number(aliases.agreedPrecision)).toFixed(1)}), ${aliasPass ? 'eşik geçildi' : 'eşik geçilmedi, takma ad pakete girmedi'}` };
    },
  },
  {
    id: 'A16B.3',
    phase: PHASE,
    title: 'Zenginleştirme sonrası çözümleme gerilemesi yok (G2 metinleri, grup aramaları); artış raporlandı',
    kind: 'auto',
    threshold: 'G2 OSM kapıları aynı ya da daha iyi; kategori aramasında kaybolan işletme ≤ %1 (sıralamayla yer değiştirme); artış raporlandı',
    async measure({ run }) {
      const result = await jsonLine(run, 'scripts/measure-enrich.ts');
      if (!result) return { status: 'fail', measured: 'ölçüm çalışmadı' };
      return { status: result.pass === true ? 'pass' : 'fail', measured: String(result.measured) };
    },
  },
  {
    id: 'A16B.4',
    phase: PHASE,
    title: 'Pakete giren model kaynaklı alanın oranı, boyut artışı ve geri alma yolu belgelendi',
    kind: 'auto',
    threshold: 'docs/enrichment.md oran, boyut ve geri alma bölümlerini içerir',
    async measure() {
      if (!existsSync(DOC)) return { status: 'fail', measured: 'docs/enrichment.md yok' };
      const text = readFileSync(DOC, 'utf8');
      const ok = /Oran/.test(text) && /Boyut/.test(text) && /Geri alma/.test(text);
      const share = /Model kaynaklı işletme: ([^\n]+)/.exec(text)?.[1] ?? '';
      return { status: ok ? 'pass' : 'fail', measured: ok ? `belge var; ${share}` : 'belgede oran, boyut ya da geri alma bölümü eksik' };
    },
  },
  {
    id: 'A16B.5',
    phase: PHASE,
    title: 'Hiçbir model çıktısında uydurma koordinat ya da kapı yok (otomatik denetim)',
    kind: 'auto',
    threshold: '0 bulgu',
    async measure({ run }) {
      const result = await jsonLine(run, 'scripts/audit-model.ts');
      if (!result) return { status: 'fail', measured: 'denetim çalışmadı' };
      return { status: result.pass === true ? 'pass' : 'fail', measured: String(result.measured) };
    },
  },
  deviceGate('A16B.6', 'Telefonda zenginleşmiş rehber paketiyle yer, sokak ve geçiş testleri (iPhone ve Android)'),
  {
    id: 'A16B.7',
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
