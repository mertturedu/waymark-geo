import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kindOfNetwork } from '../../src/native/logic/connection';

const root = join(__dirname, '../../src/native');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('native layer', () => {
  const files = sources(root);

  it('has files to look at', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never branches on the platform, so Android and iOS run the same code', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect({ file, bad: /Platform\.(OS|select|Version)/.test(text) }).toEqual({ file, bad: false });
      expect({ file, bad: /['"](ios|android)['"]/.test(text) }).toEqual({ file, bad: false });
    }
  });

  it('keeps block comments out of the shipped code', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect({ file, block: /\/\*[\s\S]*?\*\//.test(text) }).toEqual({ file, block: false });
    }
  });
});

describe('kindOfNetwork', () => {
  it('maps the connection type names to the three kinds', () => {
    expect(kindOfNetwork('WIFI')).toBe('wifi');
    expect(kindOfNetwork('ETHERNET')).toBe('wifi');
    expect(kindOfNetwork('CELLULAR')).toBe('cellular');
    expect(kindOfNetwork('NONE')).toBe('none');
  });

  it('does not block downloads when the type is unknown', () => {
    for (const type of ['UNKNOWN', 'BLUETOOTH', 'WIMAX', 'OTHER', 'VPN', undefined, '']) expect(kindOfNetwork(type)).toBe('wifi');
  });
});
