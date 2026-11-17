import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { nominatim } from '../tools/compare/engines/nominatim';
import { recordMeasure } from '../tools/compare/measures';
import { stats } from './addr-eval';
import { pick, readDoors, seeded, type Door } from './addr-sets';

const FLIPS: [RegExp, string][] = [[/ Sokak$/, ' Sokağı'], [/ Sokağı$/, ' Sokak'], [/ Cadde$/, ' Caddesi'], [/ Caddesi$/, ' Cadde'], [/ Bulvar$/, ' Bulvarı'], [/ Bulvarı$/, ' Bulvar']];

export const flipKind = (street: string): string => {
  for (const [from, to] of FLIPS) if (from.test(street)) return street.replace(from, to);
  return street;
};

const query = (d: Door, street: string): string => `${street} ${d.number}, ${d.district}, ${d.province}`;

export async function checkPlate(plate: string, count: number): Promise<number[]> {
  const doors = readDoors(plate, 'osm').filter((d) => d.street && d.number);
  const rng = seeded(1212);
  const sample = Array.from({ length: Math.min(count, doors.length) }, () => pick(rng, doors));
  const engine = nominatim();
  const errors: number[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < sample.length; i = next++) {
      const d = sample[i]!;
      const best = async (street: string): Promise<number> => {
        const r = await engine.query(query(d, street));
        return r.point ? distanceM(r.point, [d.lng, d.lat]) : 100_000;
      };
      const first = await best(d.street);
      errors.push(first <= 30 ? first : Math.min(first, await best(flipKind(d.street))));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return errors;
}

async function main(): Promise<void> {
  const list = (process.argv[2] ?? '34,16,35').split(',');
  const count = Number(process.argv[3] ?? 500);
  const all: number[] = [];
  const per: Record<string, number> = {};
  for (const plate of list) {
    const errors = await checkPlate(plate, count);
    per[plate] = stats(errors).within30;
    all.push(...errors);
  }
  const total = stats(all);
  console.log(per, `toplam ${total.count} kapı, ≤30 m %${total.within30}`);
  recordMeasure('a1_2', { plates: list, count: total.count, within30: total.within30, per });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
