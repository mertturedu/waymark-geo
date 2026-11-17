import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Gate } from './engine';

type Round = { platform: 'android' | 'ios'; flag: 'on' | 'off'; outcome: 'pass' | 'fail' | 'yok'; note: string };

const FILE = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'kargoio-17-sonuclar.json');

function rounds(): Round[] {
  if (!existsSync(FILE)) return [];
  return (JSON.parse(readFileSync(FILE, 'utf8')) as { rounds: Round[] }).rounds;
}

const find = (list: Round[], platform: Round['platform'], flag: Round['flag']): Round | undefined => list.find((r) => r.platform === platform && r.flag === flag);
const text = (r: Round | undefined): string => (r ? `${r.outcome}${r.note ? ` (${r.note})` : ''}` : 'yok');

const PHASE = 17;

export const adres17Gates: Gate[] = [
  {
    id: 'A17.1',
    phase: PHASE,
    title: 'Uçtan uca akış iki platformda, bayrak açıkken: uzaktan bayrak, görev adres kartı (kanıt, yarıçap, iğneyi düzelt), olay sayaçları',
    kind: 'device',
    threshold: 'Android ve iPhone, bayrak açık turu geçti',
    async measure() {
      const list = rounds();
      const android = find(list, 'android', 'on');
      const ios = find(list, 'ios', 'on');
      const measured = `Android ${text(android)}; iPhone ${text(ios)}`;
      if (!android || !ios || android.outcome === 'yok' || ios.outcome === 'yok') return { status: 'open', measured };
      return { status: android.outcome === 'pass' && ios.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A17.2',
    phase: PHASE,
    title: 'Performans kuralları bozulmadı (açılışta ek iş: tek bayrak isteği ve sayaç zamanlayıcısı; ağır modül yok)',
    kind: 'device',
    threshold: 'açılış ve kaydırma ölçümü Kargoio profil araçlarıyla',
    async measure() {
      return { status: 'open', measured: 'ölçülmedi: Kargoio\'nun açılış süresi ve bellek ölçümü bu fazda profil aracıyla yapılmadı; ek açılış işi tek bayrak isteği (4 sn zaman aşımı) ve 60 sn\'lik sayaç zamanlayıcısı' };
    },
  },
  {
    id: 'A17.3',
    phase: PHASE,
    title: 'Bayrak kapalıyken eski davranış: aynı görev, eski adres kartı, iğneyi düzelt yok, öneri satırında kanıt yok, teslim gövdesinde yeni alan yok',
    kind: 'device',
    threshold: 'Android ve iPhone, bayrak kapalı turu eski davranışla aynı',
    async measure() {
      const list = rounds();
      const android = find(list, 'android', 'off');
      const ios = find(list, 'ios', 'off');
      const measured = `Android ${text(android)}; iPhone ${text(ios)}`;
      if (!android || !ios || android.outcome === 'yok' || ios.outcome === 'yok') return { status: 'open', measured };
      return { status: android.outcome === 'pass' && ios.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A17.4',
    phase: PHASE,
    title: 'Sunucu bayrağı ve olay ucu testleri geçiyor (yüzde, izin/ret, kararlılık, olay doğrulama, ölçü sayacı)',
    kind: 'auto',
    threshold: 'test/server geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/server']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
