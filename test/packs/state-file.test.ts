import { BACKUP_PATH, STATE_PATH, emptyState, loadState, parseState, saveState, serializeState, type PackState } from '../../src/core/packs/state-file';
import { createFakeEnv } from '../helpers/fake-env';

const sha = (c: string): string => c.repeat(64);

const sample = (): PackState => ({
  v: 1,
  regions: { '34': { version: '20261020.20261022', files: { address: { path: '34/address-0a0b0c0d.sqlite', size: 5, sha256: sha('a') }, tiles: { path: '34/tiles-11223344.pmtiles', size: 9, sha256: sha('b') } } } },
  base: { build: '20261022', files: [{ path: 'base-20261022/overview.pmtiles', size: 3, sha256: sha('c') }] },
  pending: { '35': { parts: ['address'] } },
  dismissed: ['41'],
  checked: { manifest: sha('d'), signature: sha('e'), keys: ['key-a'] },
});

describe('state file', () => {
  it('round-trips a state through text', () => {
    expect(parseState(serializeState(sample()))).toEqual(sample());
    expect(parseState(serializeState(emptyState()))).toEqual(emptyState());
  });

  it.each([
    ['not json', '{'],
    ['wrong version', JSON.stringify({ ...sample(), v: 2 })],
    ['missing regions', JSON.stringify({ v: 1, base: null, pending: {}, dismissed: [] })],
    ['bad path', JSON.stringify({ ...sample(), regions: { '34': { version: 'x', files: { address: { path: '../x', size: 1, sha256: sha('a') } } } } })],
    ['absolute path', JSON.stringify({ ...sample(), regions: { '34': { version: 'x', files: { address: { path: '/x', size: 1, sha256: sha('a') } } } } })],
    ['bad hash', JSON.stringify({ ...sample(), regions: { '34': { version: 'x', files: { address: { path: 'a/b', size: 1, sha256: 'zz' } } } } })],
    ['bad size', JSON.stringify({ ...sample(), regions: { '34': { version: 'x', files: { address: { path: 'a/b', size: -1, sha256: sha('a') } } } } })],
    ['unknown part', JSON.stringify({ ...sample(), pending: { '35': { parts: ['elevation'] } } })],
    ['bad plate', JSON.stringify({ ...sample(), regions: { abc: { version: 'x', files: {} } } })],
    ['array', '[]'],
    ['null', 'null'],
  ])('rejects %s', (_name, text) => {
    expect(parseState(text)).toBeNull();
  });

  it('is empty and trusted on a first run', async () => {
    const env = createFakeEnv();
    expect(await loadState(env.fs)).toEqual({ state: emptyState(), trusted: true });
  });

  it('saves a backup of the previous state and reads the main file back', async () => {
    const env = createFakeEnv();
    await saveState(env.fs, emptyState());
    await saveState(env.fs, sample());
    expect(await loadState(env.fs)).toEqual({ state: sample(), trusted: true });
    expect(parseState((await env.fs.readText(BACKUP_PATH)) ?? '')).toEqual(emptyState());
  });

  it('falls back to the backup when the main file is cut in half', async () => {
    const env = createFakeEnv();
    await saveState(env.fs, sample());
    await saveState(env.fs, { ...sample(), dismissed: ['41', '42'] });
    await env.fs.writeAtomic(STATE_PATH, serializeState(sample()).slice(0, 30));
    expect(await loadState(env.fs)).toEqual({ state: sample(), trusted: true });
  });

  it('starts empty but untrusted when both copies are unreadable', async () => {
    const env = createFakeEnv();
    await env.fs.writeAtomic(STATE_PATH, 'junk');
    await env.fs.writeAtomic(BACKUP_PATH, '{"v":9}');
    expect(await loadState(env.fs)).toEqual({ state: emptyState(), trusted: false });
  });

  it('starts empty but untrusted when only a corrupt main file exists', async () => {
    const env = createFakeEnv();
    await env.fs.writeAtomic(STATE_PATH, 'junk');
    expect(await loadState(env.fs)).toEqual({ state: emptyState(), trusted: false });
  });
});

describe('checked record', () => {
  const withChecked = (checked: unknown) => JSON.stringify({ ...sample(), checked });

  it('reads a state written before the record existed', () => {
    const older: Partial<PackState> = sample();
    delete older.checked;
    expect(parseState(JSON.stringify(older))?.checked).toBeNull();
    expect(parseState(withChecked(null))?.checked).toBeNull();
  });

  it.each([
    ['text', 'x'],
    ['no keys', { manifest: sha('a'), signature: sha('b') }],
    ['bad manifest hash', { manifest: 'zz', signature: sha('b'), keys: [] }],
    ['bad signature hash', { manifest: sha('a'), signature: 5, keys: [] }],
    ['keys that are not text', { manifest: sha('a'), signature: sha('b'), keys: [1] }],
  ])('rejects a record with %s', (_name, checked) => {
    expect(parseState(withChecked(checked))).toBeNull();
  });

  it('keeps a good record', () => {
    expect(parseState(withChecked({ manifest: sha('a'), signature: sha('b'), keys: ['k1', 'k2'] }))?.checked).toEqual({ manifest: sha('a'), signature: sha('b'), keys: ['k1', 'k2'] });
  });
});

describe('state validation details', () => {
  const withFile = (file: unknown) => JSON.stringify({ ...sample(), regions: { '34': { version: 'x', files: { address: file } } } });
  const good = { path: 'a/b', size: 1, sha256: sha('a') };

  it('accepts the smallest valid file record', () => {
    expect(parseState(withFile(good))).not.toBeNull();
    expect(parseState(withFile({ ...good, size: 0 }))).not.toBeNull();
  });

  it.each([
    ['empty path', { ...good, path: '' }],
    ['double slash', { ...good, path: 'a//b' }],
    ['trailing slash', { ...good, path: 'a/' }],
    ['dot piece', { ...good, path: 'a/./b' }],
    ['dot dot piece', { ...good, path: 'a/../b' }],
    ['backslash', { ...good, path: 'a\\b' }],
    ['percent', { ...good, path: 'a%2fb' }],
    ['query', { ...good, path: 'a?b' }],
    ['fragment', { ...good, path: 'a#b' }],
    ['numeric path', { ...good, path: 5 }],
    ['fractional size', { ...good, size: 1.5 }],
    ['text size', { ...good, size: '1' }],
    ['missing size', { path: 'a/b', sha256: sha('a') }],
    ['numeric hash', { ...good, sha256: 5 }],
    ['long hash', { ...good, sha256: 'a'.repeat(65) }],
    ['prefixed hash', { ...good, sha256: `g${'a'.repeat(63)}` }],
    ['suffixed hash', { ...good, sha256: `${'a'.repeat(63)}!` }],
    ['uppercase hash', { ...good, sha256: 'A'.repeat(64) }],
    ['not an object', 'a/b'],
    ['null', null],
  ])('rejects a file record with %s', (_name, file) => {
    expect(parseState(withFile(file))).toBeNull();
  });

  it.each([
    ['numeric version', { '34': { version: 1, files: {} } }],
    ['files as array', { '34': { version: 'x', files: [] } }],
    ['missing files', { '34': { version: 'x' } }],
    ['unknown part', { '34': { version: 'x', files: { elevation: good } } }],
    ['three digit plate', { '134': { version: 'x', files: {} } }],
    ['letter plate', { a34: { version: 'x', files: {} } }],
    ['plate with a suffix', { '34x': { version: 'x', files: {} } }],
    ['region as text', { '34': 'x' }],
  ])('rejects a region with %s', (_name, regions) => {
    expect(parseState(JSON.stringify({ ...sample(), regions }))).toBeNull();
  });

  it.each([
    ['base as text', 'x'],
    ['base without build', { files: [] }],
    ['base with numeric build', { build: 5, files: [] }],
    ['base without files', { build: '1' }],
    ['base with a bad file', { build: '1', files: [{ path: '../x', size: 1, sha256: sha('a') }] }],
  ])('rejects %s', (_name, base) => {
    expect(parseState(JSON.stringify({ ...sample(), base }))).toBeNull();
  });

  it.each([
    ['pending parts as text', { '35': { parts: 'address' } }],
    ['pending without parts', { '35': {} }],
    ['pending as text', { '35': 'x' }],
    ['pending with a bad plate', { abc: { parts: [] } }],
  ])('rejects %s', (_name, pending) => {
    expect(parseState(JSON.stringify({ ...sample(), pending }))).toBeNull();
  });

  it.each([[['abc']], [[5]], [['3']], [['123']], [['x34']], [['34x']], ['34']])('rejects dismissed %j', (dismissed) => {
    expect(parseState(JSON.stringify({ ...sample(), dismissed }))).toBeNull();
  });

  it('accepts no base and empty lists', () => {
    expect(parseState(JSON.stringify({ v: 1, regions: {}, base: null, pending: {}, dismissed: [] }))).toEqual(emptyState());
  });

  it('accepts the places part in a region record and in a pending download', () => {
    const state = { ...sample(), regions: { '34': { version: 'x', files: { places: { path: '34/places-1.pmtiles', size: 5, sha256: sha('a') } } } }, pending: { '35': { parts: ['address', 'tiles', 'places'] } } };
    expect(parseState(JSON.stringify(state))?.pending['35']?.parts).toEqual(['address', 'tiles', 'places']);
  });

  it('uses fixed file names', () => {
    expect(STATE_PATH).toBe('state.json');
    expect(BACKUP_PATH).toBe('state.json.bak');
  });

  it('prefers a readable main file over the backup', async () => {
    const env = createFakeEnv();
    await env.fs.writeAtomic(STATE_PATH, serializeState(sample()));
    await env.fs.writeAtomic(BACKUP_PATH, serializeState(emptyState()));
    expect((await loadState(env.fs)).state).toEqual(sample());
  });

  it('uses the backup when the main file is missing', async () => {
    const env = createFakeEnv();
    await env.fs.writeAtomic(BACKUP_PATH, serializeState(sample()));
    expect(await loadState(env.fs)).toEqual({ state: sample(), trusted: true });
  });

  it('does not overwrite a good backup with an unreadable main file', async () => {
    const env = createFakeEnv();
    await saveState(env.fs, sample());
    await saveState(env.fs, emptyState());
    await env.fs.writeAtomic(STATE_PATH, 'junk');
    await saveState(env.fs, { ...sample(), dismissed: [] });
    expect(parseState((await env.fs.readText(BACKUP_PATH)) ?? '')).toEqual(sample());
  });

  it('writes no backup on the first save', async () => {
    const env = createFakeEnv();
    await saveState(env.fs, sample());
    expect(await env.fs.exists(BACKUP_PATH)).toBe(false);
  });
});
