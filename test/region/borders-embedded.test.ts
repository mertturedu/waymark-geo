import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embeddedBorders } from '../../src/core/region/embedded';
import { BORDERS_BASE64 } from '../../src/core/region/data/borders-base64';
import { base64Decode } from '../../src/core/packs/base64';

describe('embedded borders', () => {
  const bin = new Uint8Array(readFileSync(join(__dirname, '../../src/core/region/data/borders.bin')));

  it('are exactly the bytes of borders.bin', () => {
    expect(base64Decode(BORDERS_BASE64)).toEqual(bin);
  });

  it('know all 81 provinces and place well-known points', () => {
    const borders = embeddedBorders();
    expect(borders.plates()).toHaveLength(81);
    expect(borders.provinceAt(28.9784, 41.0082)).toBe('34');
    expect(borders.provinceAt(32.8597, 39.9334)).toBe('06');
    expect(borders.provinceAt(27.1428, 38.4237)).toBe('35');
    expect(borders.provinceAt(29.0875, 37.7765)).toBe('20');
  });

  it('are created once', () => {
    expect(embeddedBorders()).toBe(embeddedBorders());
  });
});
