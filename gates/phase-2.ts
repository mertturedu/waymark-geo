import type { Gate, GateContext } from './engine';

const lastJson = (out: string): { measured?: string } | null => {
  for (const line of out.trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line) as { measured?: string };
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      continue;
    }
  }
  return null;
};

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

const check = (name: string, always = false) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-packs.ts', '--check', name]);
  const measured = lastJson(out)?.measured ?? tail(out);
  return { status: code === 0 || always ? ('pass' as const) : ('fail' as const), measured };
};

export const phase2Gates: Gate[] = [
  { id: 'K2.1', phase: 2, title: 'Belirlenimcilik', kind: 'auto', threshold: 'aynı girdiyle iki çalıştırma bayt bayt aynı dosyalar (adres paketleri ve sınırlar 81 il, karolar 12 il, manifest)', measure: check('determinism') },
  { id: 'K2.2', phase: 2, title: 'Muhasebe', kind: 'auto', threshold: 'kaynak sayısı = giren + reddedilen, il başına sıfır açık', measure: check('accounting') },
  { id: 'K2.3', phase: 2, title: 'Atama denetimi (adres etiketleriyle)', kind: 'auto', threshold: 'il uyumu en az yüzde 99, ilçe uyumu en az yüzde 95; mahalle yalnızca rapor', measure: check('assignment') },
  { id: 'K2.3b', phase: 2, title: 'Mahalle kaynağı oranları (12 il)', kind: 'auto', threshold: 'yalnızca raporlanır (poligon, etiket, yakın yer noktası, yok)', measure: check('hoods', true) },
  { id: 'K2.4', phase: 2, title: '81 il kurulumu ve 12 il adres sayısı', kind: 'auto', threshold: '81 il hatasız; 12 ilde kapı sayısı Bölüm 3\'ten en çok yüzde 1 sapar', measure: check('counts') },
  { id: 'K2.5', phase: 2, title: 'Boyutlar', kind: 'auto', threshold: 'temel paket en çok 30 MB; her il haritası Bölüm 3 değerini ve 12 il toplamı 700 MB\'ı aşmaz; adres paketleri toplamı en çok 60 MB', measure: check('sizes') },
  { id: 'K2.6', phase: 2, title: 'Gömülü il sınırları', kind: 'auto', threshold: 'uygulama paketini en çok 600 KB büyütür', measure: check('borders') },
  { id: 'K2.7', phase: 2, title: 'Karo dosyaları', kind: 'auto', threshold: 'her karo dosyası pmtiles verify ile geçerli, sınır kutusu il sınırını kapsıyor', measure: check('tiles') },
];
