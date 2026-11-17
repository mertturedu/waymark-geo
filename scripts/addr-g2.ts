import { pathToFileURL } from 'node:url';
import { pick, plates, readDoors, seedOf, seeded, updateManifest, writeSet, type Door, type Rng, type TextRecord } from './addr-sets';

const PER_PLATE = 2000;
const OSM_SHARE = 0.6;

const KIND_FORMS: Record<string, string[]> = {
  sokak: ['Sokak', 'Sokağı', 'Sk.', 'Sk', 'Sok.', 'Sok', 'sk'],
  cadde: ['Caddesi', 'Cadde', 'Cd.', 'Cd', 'Cad.', 'Cad', 'cd'],
  bulvar: ['Bulvarı', 'Bulvar', 'Blv.', 'Blv', 'Bul.'],
  cikmaz: ['Çıkmazı', 'Çıkmaz', 'Çık.'],
  yol: ['Yolu', 'Yol'],
  meydan: ['Meydanı', 'Meydan'],
};
const KIND_WORD: Record<string, RegExp> = {
  sokak: /\s(Sokak|Sokağı)$/,
  cadde: /\s(Caddesi|Cadde)$/,
  bulvar: /\s(Bulvarı|Bulvar)$/,
  cikmaz: /\s(Çıkmazı|Çıkmaz)$/,
  yol: /\s(Yolu|Yol)$/,
  meydan: /\s(Meydanı|Meydan)$/,
};
const HOOD_FORMS = ['Mahallesi', 'Mah.', 'Mah', 'Mh.', 'mh', 'mahallesi', 'Mahalle'];
const NUMBER_FORMS = ['No:{n}', 'No: {n}', 'No {n}', 'no:{n}', 'no{n}', 'Numara {n}', 'N:{n}', '{n}', 'No.{n}'];
const UNIT_FORMS = ['D:{d}', 'Daire {d}', 'daire:{d}', 'K:{k} D:{d}', 'Kat {k} Daire {d}', '/{d}', 'D.{d}', 'kat:{k}', 'İç Kapı No:{d}'];
const BUILDING_FORMS = ['{w} Apt.', '{w} Apartmanı', '{w} Sitesi {b} Blok', '{w} Sitesi', '{b} Blok', '{w} Residence', '{w} İş Merkezi'];
const BUILDING_WORDS = ['Güneş', 'Yıldız', 'Lale', 'Çınar', 'Defne', 'Park', 'Bahar', 'Huzur', 'Ege', 'Doğa', 'Karanfil', 'Nil'];
const NOTES = ['kapıda ödeme', 'zile basmayın', 'aramadan gelmeyin', 'kargo', 'arayınız lütfen', 'teslimat saat 18den sonra', 'kapıcıya bırakın'];
const ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };

type Parts = { hood: string | null; street: string; kindForm: string | null; number: string; unit: string | null; unitFloor: string | null; unitDoor: string | null; building: string | null; block: string | null; district: string | null; province: string | null; note: string | null; phone: string | null };

const baseStreet = (door: Door): { core: string; kind: string | null } => {
  const re = door.kind ? KIND_WORD[door.kind] : undefined;
  if (re && re.test(door.street)) return { core: door.street.replace(re, ''), kind: door.kind };
  return { core: door.street, kind: null };
};

const typo = (rng: Rng, word: string): string => {
  if (word.length < 5) return word;
  const at = 1 + Math.floor(rng() * (word.length - 2));
  const mode = Math.floor(rng() * 3);
  if (mode === 0) return word.slice(0, at) + word.slice(at + 1);
  if (mode === 1) return word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
  return word.slice(0, at) + word[at] + word.slice(at);
};

export const OPERATORS: { name: string; weight: number; apply: (rng: Rng, p: Parts, door: Door, others: string[]) => Parts | null }[] = [
  { name: 'kind_abbrev', weight: 0.45, apply: (rng, p, door) => (door.kind && KIND_FORMS[door.kind] ? { ...p, kindForm: pick(rng, KIND_FORMS[door.kind] as string[]) } : null) },
  { name: 'kind_drop', weight: 0.08, apply: (_r, p) => (p.kindForm ? { ...p, kindForm: null } : null) },
  { name: 'kind_swap', weight: 0.04, apply: (_r, p, door) => (door.kind === 'sokak' ? { ...p, kindForm: 'Cad.' } : door.kind === 'cadde' ? { ...p, kindForm: 'Sok.' } : null) },
  { name: 'hood_drop', weight: 0.2, apply: (_r, p) => (p.hood ? { ...p, hood: null } : null) },
  { name: 'district_drop', weight: 0.15, apply: (_r, p) => (p.district ? { ...p, district: null } : null) },
  { name: 'province_drop', weight: 0.35, apply: (_r, p) => (p.province ? { ...p, province: null } : null) },
  { name: 'district_wrong', weight: 0.04, apply: (rng, p, _d, others) => (others.length > 0 ? { ...p, district: pick(rng, others) } : null) },
  { name: 'street_typo', weight: 0.1, apply: (rng, p) => ({ ...p, street: typo(rng, p.street) }) },
  { name: 'hood_typo', weight: 0.06, apply: (rng, p) => (p.hood ? { ...p, hood: typo(rng, p.hood) } : null) },
  { name: 'street_join', weight: 0.04, apply: (_r, p) => (p.street.includes(' ') ? { ...p, street: p.street.replace(/\s+/g, '') } : null) },
  {
    name: 'unit',
    weight: 0.3,
    apply: (rng, p) => {
      const form = pick(rng, UNIT_FORMS);
      const door = String(1 + Math.floor(rng() * 24));
      const floor = String(Math.floor(rng() * 8));
      return { ...p, unit: form.replace('{d}', door).replace('{k}', floor), unitDoor: form.includes('{d}') ? door : null, unitFloor: form.includes('{k}') ? floor : null };
    },
  },
  {
    name: 'building',
    weight: 0.15,
    apply: (rng, p) => {
      const form = pick(rng, BUILDING_FORMS);
      const block = pick(rng, ['A', 'B', 'C', 'D', 'A1', 'B2']);
      return { ...p, building: form.replace('{w}', pick(rng, BUILDING_WORDS)).replace('{b}', block), block: form.includes('{b}') ? block : null };
    },
  },
  { name: 'note', weight: 0.08, apply: (rng, p) => ({ ...p, note: pick(rng, NOTES) }) },
  { name: 'phone', weight: 0.05, apply: (rng, p) => ({ ...p, phone: `05${30 + Math.floor(rng() * 20)} ${100 + Math.floor(rng() * 900)} ${10 + Math.floor(rng() * 90)} ${10 + Math.floor(rng() * 90)}` }) },
];

const FINISH = [
  { name: 'ascii', weight: 0.25, apply: (t: string) => t.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => ASCII[c] as string) },
  { name: 'upper', weight: 0.08, apply: (t: string) => t.toLocaleUpperCase('tr-TR') },
  { name: 'lower', weight: 0.15, apply: (t: string) => t.toLocaleLowerCase('tr-TR') },
  { name: 'no_punct', weight: 0.1, apply: (t: string) => t.replace(/[.,:/]/g, ' ').replace(/\s+/g, ' ').trim() },
];

const ORDERS = ['hood-street-number-district', 'street-number-hood-district', 'district-hood-street-number', 'hood-street-number', 'street-number-district'];

function render(rng: Rng, p: Parts, order: string): string {
  const hood = p.hood ? `${p.hood} ${pick(rng, HOOD_FORMS)}` : null;
  const street = p.kindForm ? `${p.street} ${p.kindForm}` : p.street;
  const number = pick(rng, NUMBER_FORMS).replace('{n}', p.number);
  const area = [p.district, p.province].filter(Boolean).join(pick(rng, ['/', ' ', ', ']));
  const pieces: Record<string, string | null> = { hood, street, number: [number, p.unit].filter(Boolean).join(' '), district: area || null };
  const ordered = order.split('-').map((k) => pieces[k]).filter((x): x is string => Boolean(x));
  if (!order.includes('hood') && hood) ordered.splice(1, 0, hood);
  if (!order.includes('district') && area) ordered.push(area);
  if (p.building) ordered.splice(Math.min(ordered.length, 2), 0, p.building);
  const sep = pick(rng, [' ', ', ', ' ']);
  let text = ordered.join(sep);
  if (p.note) text += ` ${p.note}`;
  if (p.phone) text = rng() < 0.5 ? `${text} ${p.phone}` : `${p.phone} ${text}`;
  return text.replace(/\s+/g, ' ').trim();
}

export function makeRecord(door: Door, otherDistricts: string[]): TextRecord {
  const rng = seeded(seedOf(door.id));
  const { core, kind } = baseStreet(door);
  let parts: Parts = { hood: door.hood, street: core, kindForm: kind ? (door.street.slice(core.length).trim() || null) : null, number: door.number, unit: null, unitFloor: null, unitDoor: null, building: null, block: null, district: door.district, province: door.province, note: null, phone: null };
  const ops: string[] = [];
  for (const op of OPERATORS) {
    if (rng() >= op.weight) continue;
    const next = op.apply(rng, parts, door, otherDistricts);
    if (next) {
      parts = next;
      ops.push(op.name);
    }
  }
  if (!parts.hood && !parts.district) {
    parts = { ...parts, district: door.district };
    ops.splice(ops.indexOf('district_drop'), ops.includes('district_drop') ? 1 : 0);
  }
  let text = render(rng, parts, pick(rng, ORDERS));
  for (const f of FINISH) {
    if (rng() < f.weight) {
      text = f.apply(text);
      ops.push(f.name);
    }
  }
  const unit = { ...(parts.unitFloor !== null ? { floor: parts.unitFloor } : {}), ...(parts.unitDoor !== null ? { door: parts.unitDoor } : {}), ...(parts.block !== null ? { block: parts.block } : {}) };
  return { ...door, text, ops, ...(Object.keys(unit).length > 0 ? { unit } : {}) };
}

function sample<T>(list: T[], count: number, seed: number): T[] {
  const rng = seeded(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, count);
}

export function generate(plate: string): TextRecord[] {
  const osm = readDoors(plate, 'osm');
  const keys = new Set(osm.map((d) => `${d.district}|${d.street}|${d.number}`));
  const business = readDoors(plate, 'business').filter((d) => !keys.has(`${d.district}|${d.street}|${d.number}`));
  const osmCount = Math.min(osm.length, Math.round(PER_PLATE * OSM_SHARE));
  const bizCount = Math.min(business.length, PER_PLATE - osmCount);
  const picked = [...sample(osm, osmCount + Math.max(0, PER_PLATE - osmCount - bizCount), seedOf(`${plate}-osm`)), ...sample(business, bizCount, seedOf(`${plate}-biz`))];
  const districts = [...new Set([...osm, ...business].map((d) => d.district))];
  return picked.map((door) => makeRecord(door, districts.filter((d) => d !== door.district)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wanted = process.argv.includes('--plates') ? (process.argv[process.argv.indexOf('--plates') + 1] ?? '').split(',') : plates();
  const hashes: { [plate: string]: string } = {};
  let total = 0;
  for (const plate of wanted) {
    const records = generate(plate);
    hashes[plate] = writeSet('g2', plate, records);
    total += records.length;
    console.log(`${plate}: ${records.length} (osm ${records.filter((r) => r.source === 'osm').length}, işletme ${records.filter((r) => r.source === 'business').length})`);
  }
  updateManifest('g2', hashes, { perPlate: PER_PLATE, osmShare: OSM_SHARE, operators: [...OPERATORS.map((o) => `${o.name}:${o.weight}`), ...FINISH.map((f) => `${f.name}:${f.weight}`)] });
  console.log(`toplam ${total}`);
}
