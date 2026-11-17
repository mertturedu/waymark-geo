import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', 'pipeline', 'data', 'fonts-inter');
const FACES = ['InterRegular', 'InterMedium', 'InterItalic', 'InterBold'];

function varint(buf: Buffer, at: number): [number, number] {
  let value = 0;
  let shift = 0;
  let pos = at;
  for (;;) {
    const byte = buf[pos++] as number;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, pos];
    shift += 7;
  }
}

function skip(buf: Buffer, wire: number, at: number): number {
  if (wire === 0) return varint(buf, at)[1];
  if (wire === 2) {
    const [length, pos] = varint(buf, at);
    return pos + length;
  }
  return at + (wire === 1 ? 8 : 4);
}

export function glyphIds(buf: Buffer): number[] {
  const ids: number[] = [];
  let at = 0;
  while (at < buf.length) {
    const [key, pos] = varint(buf, at);
    if (key >> 3 !== 1 || (key & 7) !== 2) {
      at = skip(buf, key & 7, pos);
      continue;
    }
    const [length, start] = varint(buf, pos);
    const end = start + length;
    let inner = start;
    while (inner < end) {
      const [innerKey, innerPos] = varint(buf, inner);
      if (innerKey >> 3 === 3 && (innerKey & 7) === 2) {
        const [glyphLength, glyphStart] = varint(buf, innerPos);
        let field = glyphStart;
        while (field < glyphStart + glyphLength) {
          const [fieldKey, fieldPos] = varint(buf, field);
          if (fieldKey >> 3 === 1 && (fieldKey & 7) === 0) {
            ids.push(varint(buf, fieldPos)[0]);
            break;
          }
          field = skip(buf, fieldKey & 7, fieldPos);
        }
        inner = glyphStart + glyphLength;
      } else inner = skip(buf, innerKey & 7, innerPos);
    }
    at = end;
  }
  return ids;
}

const codes = (text: string): number[] => [...text].map((c) => c.codePointAt(0) as number);
const have = (face: string, range: string): Set<number> => new Set(glyphIds(readFileSync(join(DIR, face, `${range}.pbf`))));
const built = existsSync(join(DIR, 'InterMedium', '0-255.pbf'));

describe('glyph reader', () => {
  it('reads nothing from an empty buffer', () => {
    expect(glyphIds(Buffer.alloc(0))).toEqual([]);
  });
});

(built ? describe : describe.skip)('Inter glyph packs (npm run fonts to build them)', () => {
  it.each(FACES)('%s has every Turkish letter, with the dotted and dotless i', (face) => {
    const latin = have(face, '0-255');
    const extended = have(face, '256-511');
    const all = new Set([...latin, ...extended]);
    for (const code of codes('çğıİöşüÇĞÖŞÜ')) expect(all.has(code)).toBe(true);
    for (const code of codes('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')) expect(latin.has(code)).toBe(true);
  });

  it.each(FACES)('%s has Greek and Cyrillic', (face) => {
    expect(have(face, '768-1023').has(codes('Ωα')[0] as number)).toBe(true);
    expect(have(face, '1024-1279').has(codes('Жя')[0] as number)).toBe(true);
  });

  it.each(['InterRegular', 'InterMedium'])('%s carries the Noto glyphs it does not have itself, such as Arabic', (face) => {
    expect(have(face, '1536-1791').size).toBeGreaterThan(100);
  });

  it('takes the Latin letters from Inter, not from Noto', () => {
    expect(have('InterMedium', '0-255').size).toBeGreaterThan(150);
  });

  it('covers all 256 ranges for each face', () => {
    for (const face of FACES) expect(existsSync(join(DIR, face, '65280-65535.pbf'))).toBe(true);
  });
});
