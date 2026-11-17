import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServerStore } from '../../server/store';

const sha = (n: number): string => String(n).repeat(64).slice(0, 64);

function manifest(learned: { path: string; sha: string } | null): string {
  return JSON.stringify({
    format: 2, minSdk: '0.8.0', osm: { file: 'x', time: '2026-11-11T00:00:00Z' }, tiles: { build: '20261101', time: 'x' }, base: [],
    regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [28, 40, 30, 42], version: 'v1', stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [
      { kind: 'address', path: '34/address-aaaa.sqlite', size: 1, sha256: sha(1) },
      ...(learned ? [{ kind: 'learned', path: learned.path, size: 1, sha256: learned.sha }] : []),
    ] }],
  });
}

describe('server store reload', () => {
  it('yeni manifest gelince değişen bölgeyi bildirir ve yeni dosyayı açar, yeniden başlatma gerekmez', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reload-'));
    mkdirSync(join(dir, '34'));
    writeFileSync(join(dir, '34', 'address-aaaa.sqlite'), '');
    writeFileSync(join(dir, '34', 'learned-1111.sqlite'), '');
    writeFileSync(join(dir, 'manifest-v2.json'), manifest({ path: '34/learned-1111.sqlite', sha: sha(2) }));
    let clock = 0;
    const store = createServerStore(dir, 5, () => clock);
    const seen: string[][] = [];
    store.onChange((regions) => seen.push(regions));
    expect(store.manifest.regions[0]?.files.find((f) => f.kind === 'learned')?.path).toBe('34/learned-1111.sqlite');
    expect(store.refresh()).toBe(false);

    writeFileSync(join(dir, '34', 'learned-2222.sqlite'), '');
    writeFileSync(join(dir, 'manifest-v2.json'), manifest({ path: '34/learned-2222.sqlite', sha: sha(3) }));
    utimesSync(join(dir, 'manifest-v2.json'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    clock += 3000;
    expect(await store.installed()).toEqual(['34']);
    expect(seen).toEqual([['34']]);
    expect(store.manifest.regions[0]?.files.find((f) => f.kind === 'learned')?.path).toBe('34/learned-2222.sqlite');
    expect(store.learnedAt()).not.toBeNull();
    await store.closeAll();
    rmSync(dir, { recursive: true, force: true });
    void cpSync;
  });

  it('bozuk manifest gelirse eskisiyle devam eder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reload-'));
    mkdirSync(join(dir, '34'));
    writeFileSync(join(dir, '34', 'address-aaaa.sqlite'), '');
    writeFileSync(join(dir, 'manifest-v2.json'), manifest(null));
    const store = createServerStore(dir, 5, () => 0);
    writeFileSync(join(dir, 'manifest-v2.json'), '{bozuk');
    utimesSync(join(dir, 'manifest-v2.json'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(store.refresh()).toBe(false);
    expect(store.manifest.regions).toHaveLength(1);
    await store.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });
});
