import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const square = (west: number, south: number, east: number, north: number) => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
export const admin = (id: string, level: number, parent: string | null, names: Record<string, string>, rings: unknown, center: [number, number], alt: string[] = []) => ({ id, level, parent, names, alt, center, rings });
export const where = (district: string, neighbourhood: string | null, source = 'polygon', hoodName: string | null = null, hoodNames: Record<string, string> | null = null) => ({ district, neighbourhood, hoodName, hoodNames, hoodSource: source, slack: false });
export const address = (id: string, street: string | null, number: string, lon: number, lat: number, w = where('r10', 'r20'), more: Record<string, unknown> = {}) => ({ id, street, place: null, number, postcode: null, lon, lat, tags: {}, ...w, ...more });
export const part = (name: string, w: ReturnType<typeof where>, lines: number[][][], ways: string[], names: Record<string, string> = {}, alt: string[] = []) => ({ name, names: { tr: name, ...names }, alt, highway: 'residential', lines, ways, ...w });
export const poi = (id: string, kind: string, name: string, lon: number, lat: number, w = where('r10', 'r20'), names: Record<string, string> = {}) => ({ id, kind, name, names: { tr: name, ...names }, alt: [], lon, lat, ...w, slack: false });

export type Rows = { addresses: object[]; streets: object[]; places: object[]; admin: object[] };

export const baseAdmin = () => [
  admin('r10', 6, 'r1', { tr: 'Kadıköy', ru: 'Кадыкёй' }, square(28.5, 40.5, 29.0, 41.5), [28.7, 41.0]),
  admin('r11', 6, 'r1', { tr: 'Üsküdar' }, square(29.0, 40.5, 29.5, 41.0), [29.2, 40.8], ['Scutari']),
  admin('r20', 8, 'r10', { tr: 'Moda Mahallesi' }, square(28.5, 40.5, 28.72, 41.0), [28.6, 40.7]),
  admin('r21', 8, 'r11', { tr: 'Fener Mahallesi' }, square(29.0, 40.5, 29.3, 40.9), [29.1, 40.7]),
  admin('r30', 8, 'r99', { tr: 'Baska Il Mahallesi' }, square(10, 10, 11, 11), [10.5, 10.5]),
];

export const baseRows = (): Rows => ({
  admin: baseAdmin(),
  addresses: [
    address('n5', 'Bahariye Caddesi', '14', 28.6, 40.7),
    address('n6', 'Bahariye Cd.', '16', 28.61, 40.71),
    address('n7', 'Atatürk Sokağı', '3/A', 28.62, 40.72),
    address('w8', null, '7', 28.63, 40.73),
    address('n9', 'Gül Sokak', '12', 29.1, 40.7, where('r11', 'r21')),
    address('n10', 'Gül Sokak', '14', 28.65, 40.75),
    address('n11', 'Atatürk Caddesi', '٣٤', 28.8, 41.2, where('r10', null, 'tag', 'Bahariye Mah.')),
    address('n12', 'Atatürk Caddesi', '36', 28.81, 41.21, where('r10', null, 'tag', 'Bahariye Mahallesi')),
  ],
  streets: [
    part('Gül Sokak', where('r10', 'r20'), [[[28.6, 40.7], [28.7, 40.7]]], ['w1']),
    part('Gül Sokak', where('r11', 'r21'), [[[29.1, 40.7], [29.2, 40.7]]], ['w2']),
    part('Atatürk Caddesi', where('r10', 'r20'), [[[28.6, 40.8], [28.7, 40.8]], [[28.6, 40.81], [28.7, 40.81]]], ['w3', 'w4'], { ru: 'улица Республики', en: 'Ataturk Street' }, ['Cumhuriyet Cd']),
    part('Atatürk Sokağı', where('r10', 'r20'), [[[28.6, 40.9], [28.7, 40.9]]], ['w5']),
    part('Bahariye Caddesi', where('r10', 'r20'), [[[28.6, 40.6], [28.7, 40.6]]], ['w6']),
  ],
  places: [
    poi('n40', 'hospital', 'Devlet Hastanesi', 28.62, 40.62, where('r10', 'r20'), { ru: 'Государственная больница' }),
    poi('w41', 'pharmacy', 'Gül Eczanesi', 29.1, 40.65, where('r11', 'r21')),
    poi('n42', 'unknown_kind', 'Bilinmeyen', 28.62, 40.62),
  ],
});

export function writeWork(rows: Rows, dir = mkdtempSync(join(tmpdir(), 'pack-')), province = '34'): string {
  const put = (path: string, items: object[]): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), items.map((r) => JSON.stringify(r)).join('\n') + (items.length ? '\n' : ''));
  };
  put(`admin-pack/${province}.jsonl`, rows.admin);
  put(`addresses/${province}/addresses.jsonl`, rows.addresses);
  put(`streets/${province}/streets.jsonl`, rows.streets);
  put(`places/${province}/places.jsonl`, rows.places);
  return dir;
}

