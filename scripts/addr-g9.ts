import { pathToFileURL } from 'node:url';
import { pick, plates, readDoors, seeded, seedOf, updateManifest, writeSet, type Door, type TextRecord } from './addr-sets';

const PER_PLATE = 400;
const BLOCKS = ['A', 'B', 'C', 'D', 'E', 'F', 'A1', 'B2', 'K'];
const SITES = ['Güneş', 'Yıldız', 'Lale', 'Çınar', 'Defne', 'Park', 'Bahar', 'Huzur'];

type Form = { text: string; floor: boolean; door: boolean; block: boolean };
const form = (text: string): Form => ({ text, floor: text.includes('{k}'), door: text.includes('{d}'), block: text.includes('{b}') });

const FORMS = [
  'Kat {k} Daire {d}', 'K:{k} D:{d}', '{k}. kat {d} nolu daire', '{k}. Kat No:{d}', 'D:{d} K:{k}', 'daire {d} kat {k}',
  '{b} Blok Kat {k} Daire {d}', '{b} Blok D:{d}', 'Blok {b} Daire {d}', '{d} numaralı daire {k}. katta', 'kat:{k}/daire:{d}',
  'İç kapı no {d}', 'Kat {k}', 'Daire {d}', '{b} Blok {k}. Kat {d} Nolu Daire', '{s} Sitesi {b} Blok D:{d}', '{k}.kat d.{d}',
  '{b} blok {k}. kat daire {d}', 'D{d} K{k}', 'daire no {d}', '{b} Blok', '{b} Blok Daire {d}', 'Kat: {k} Daire: {d}', '{k}. kat daire {d}',
].map(form);
const GROUND = ['zemin kat daire {d}', 'Zemin Kat D:{d}', '{b} Blok Zemin Kat Daire {d}'].map(form);
const BASEMENT = ['bodrum kat daire {d}', 'Kat: -1 Daire {d}', '{b} Blok Bodrum Kat D:{d}'].map(form);

function unitFor(door: Door): { text: string; unit: { floor?: string; door?: string; block?: string } } {
  const rng = seeded(seedOf(`g9-${door.id}`));
  const roll = rng();
  const f = roll < 0.08 ? pick(rng, GROUND) : roll < 0.12 ? pick(rng, BASEMENT) : pick(rng, FORMS);
  const floor = f === undefined ? 1 : GROUND.includes(f) ? 0 : BASEMENT.includes(f) ? -1 : 1 + Math.floor(rng() * 12);
  const d = 1 + Math.floor(rng() * 40);
  const b = pick(rng, BLOCKS);
  const text = f.text.replace('{k}', String(floor)).replace('{d}', String(d)).replace('{b}', b).replace('{s}', pick(rng, SITES));
  const unit: { floor?: string; door?: string; block?: string } = {};
  if (f.floor || GROUND.includes(f) || BASEMENT.includes(f)) unit.floor = String(floor);
  if (f.door) unit.door = String(d);
  if (f.block) unit.block = b;
  return { text, unit };
}

export function generate(plate: string): TextRecord[] {
  const osm = readDoors(plate, 'osm').filter((d) => d.hood !== null);
  const rng = seeded(seedOf(`g9-${plate}`));
  const copy = [...osm];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as Door, copy[i] as Door];
  }
  return copy.slice(0, PER_PLATE).map((door) => {
    const { text, unit } = unitFor(door);
    const street = door.kind ? door.street : door.street;
    const base = `${door.hood} Mah. ${street} No:${door.number} ${text} ${door.district}/${door.province}`;
    return { ...door, text: base, ops: ['unit'], unit };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hashes: { [plate: string]: string } = {};
  let total = 0;
  for (const plate of plates()) {
    const records = generate(plate);
    hashes[plate] = writeSet('g9', plate, records);
    total += records.length;
  }
  updateManifest('g9', hashes, { perPlate: PER_PLATE, forms: FORMS.length + GROUND.length + BASEMENT.length });
  console.log(`toplam ${total}`);
}
