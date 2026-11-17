import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text';
import { streetKey } from '../src/core/text/street';
import { pick, readDoors, repoRoot, seeded, seedOf, updateManifest, writeSet, type Door, type TextRecord } from './addr-sets';

export const MODEL = 'qwen3:14b';
export const BATCH = 10;
const OLLAMA = 'http://127.0.0.1:11434';

const STYLES = [
  'acelesi olan biri telefondan hızlı yazıyor: kısaltmalar (mh, sk, cd, no) var, noktalama az',
  'yaşlı biri resmi ve tam yazıyor: Mahallesi, Sokağı, No:, ilçe/il',
  'işletme çalışanı kurye için yazıyor: adresin sonuna kat ve daire bilgisini ekliyor (ör. "Kat 3 Daire 7", "D:5")',
  'genç biri hepsini küçük harfle ve Türkçe karakter kullanmadan yazıyor',
  'bir apartman ya da sitenin adını (uydurma) ve kat/daire bilgisini ekleyen biri',
  'mahalleyi ve sokağı kısaltarak yazıp ilçeyi sona koyan biri',
];

export const PROMPT = `Türkiye'de gerçek insanların kargo, yemek ya da kurye siparişi için yazdığı adres metinlerini üretiyorsun. Sana numaralı adres bileşenleri verilecek. Her biri için, belirtilen yazım tarzında, o adresi tek satır metne dök.
Kurallar:
- Sıra gerçek adreslerdeki gibi olsun: mahalle, sokak ya da cadde, kapı numarası, ilçe, il. Bileşenleri birbirine karıştırma; mahalle adı sokak adının yerine geçmesin.
- Kapı numarası ile sokak ya da cadde adı aynen doğru olmalı.
- İl, ilçe ve mahalleden bazılarını doğal biçimde atlayabilir ya da kısaltabilirsin.
- Her metin en çok 110 karakter olsun. Açıklama, not ya da uydurma bilgi ekleme (stilde istenmedikçe).
- Telefon numarası, isim ya da kişisel bilgi yazma.
Örnekler (uydurma): "Gül Mah. Papatya Sk. No:12 Çankaya/Ankara", "papatya sk 12 gul mh cankaya", "Papatya Sokağı No 12 Daire 4, Çankaya".
Yalnızca JSON döndür.`;

const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' } }, required: ['i', 'text'] } } },
  required: ['items'],
} as const;

const describe = (d: Door, i: number): string => `${i + 1}. il: ${d.province}; ilçe: ${d.district}; mahalle: ${d.hood ?? '-'}; sokak: ${d.street}; no: ${d.number}`;

export function acceptable(text: string, door: Door): boolean {
  const flat = text.toLocaleLowerCase('tr-TR');
  if (text.length < 8 || text.length > 200) return false;
  if (!new RegExp(`(^|[^0-9])${door.number.toLocaleLowerCase('tr-TR')}([^0-9a-z]|$)`).test(flat)) return false;
  if (/\d{10,}|@/.test(text)) return false;
  const core = streetKey(door.street).key.split(' ')[0] ?? '';
  return core === '' || nameKey(flat).includes(core.slice(0, Math.max(3, core.length - 2)));
}

async function ask(doors: Door[], style: string, seed: number): Promise<string[]> {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      format: SCHEMA,
      options: { temperature: 0.7, seed, num_predict: 900 },
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `Yazım tarzı: ${style}\n\n${doors.map(describe).join('\n')}` },
      ],
    }),
  });
  if (!response.ok) return [];
  try {
    const parsed = JSON.parse(((await response.json()) as { message: { content: string } }).message.content) as { items: { i: number; text: string }[] };
    const out: string[] = [];
    for (const item of parsed.items) out[item.i - 1] = item.text;
    return out;
  } catch {
    return [];
  }
}

export async function generate(plate: string, count: number, onBatch?: (done: number) => void): Promise<TextRecord[]> {
  const rng = seeded(seedOf(`g1s:${plate}`));
  const osm = readDoors(plate, 'osm');
  const business = readDoors(plate, 'business');
  const out: TextRecord[] = [];
  let round = 0;
  while (out.length < count && round < Math.ceil(count / BATCH) * 3) {
    const doors = Array.from({ length: BATCH }, () => pick(rng, rng() < 0.6 && osm.length > 0 ? osm : business.length > 0 ? business : osm));
    const style = pick(rng, STYLES);
    const texts = await ask(doors, style, round);
    doors.forEach((door, i) => {
      const text = texts[i]?.trim();
      if (text && out.length < count && acceptable(text, door)) out.push({ ...door, id: `${door.id}:g1s${round}`, text, ops: ['llm'] });
    });
    round++;
    onBatch?.(out.length);
  }
  return out;
}

async function main(): Promise<void> {
  const list = (process.argv[2] ?? '34').split(',');
  const count = Number(process.argv[3] ?? 1000);
  const hashes: { [plate: string]: string } = {};
  for (const plate of list) {
    const started = Date.now();
    const records = await generate(plate, count, (done) => process.stdout.write(`\r${plate}: ${done}/${count}`));
    hashes[plate] = writeSet('g1s', plate, records);
    console.log(`\n${plate}: ${records.length} kayıt, ${Math.round((Date.now() - started) / 1000)} sn`);
  }
  const path = join(repoRoot, 'fixtures', 'addr-eval', 'MANIFEST.json');
  const before = existsSync(path) ? ((JSON.parse(readFileSync(path, 'utf8')) as { g1s?: { files: { [plate: string]: string } } }).g1s?.files ?? {}) : {};
  updateManifest('g1s', { ...before, ...hashes }, { model: MODEL, batch: BATCH, note: 'dil modeliyle üretildi; yalnız hazırlanan iller' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
