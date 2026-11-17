import { sdkGuideSteps, type SdkGuideState } from '../../example/src/sdk-test/guide';

const base = (): SdkGuideState => ({
  serverOk: false,
  entries: {},
  online: true,
  autoIds: ['a1', 'a2'],
  restartIds: ['b1'],
  offlineAutoIds: ['f1', 'f2'],
});

const status = (state: SdkGuideState, id: string): string => sdkGuideSteps(state).find((s) => s.id === id)?.status ?? 'missing';

describe('sdkGuideSteps', () => {
  it('starts with the server and locks everything that needs it', () => {
    const state = base();
    expect(sdkGuideSteps(state).map((s) => s.id)).toEqual(['server', 'auto', 'restart', 'airplane', 'offline-auto', 'report']);
    expect(status(state, 'server')).toBe('todo');
    for (const id of ['auto', 'restart']) expect(status(state, id)).toBe('locked');
  });

  it('opens the automatic tests once the server answers', () => {
    expect(status({ ...base(), serverOk: true }, 'server')).toBe('done');
    expect(status({ ...base(), serverOk: true }, 'auto')).toBe('todo');
  });

  it('marks the automatic tests done only when all passed or were informational, failed when one failed', () => {
    const ok = { ...base(), serverOk: true, entries: { a1: { outcome: 'pass' as const }, a2: { outcome: 'info' as const } } };
    expect(status(ok, 'auto')).toBe('done');
    expect(status({ ...ok, entries: { a1: { outcome: 'pass' }, a2: { outcome: 'fail' } } }, 'auto')).toBe('fail');
    expect(status({ ...ok, entries: { a1: { outcome: 'pass' } } }, 'auto')).toBe('todo');
    expect(status({ ...ok, entries: { a1: { outcome: 'skip' }, a2: { outcome: 'pass' } } }, 'auto')).toBe('todo');
  });

  it('asks for the restart test after the automatic ones and reports its own result', () => {
    const done = { ...base(), serverOk: true, entries: { a1: { outcome: 'pass' as const }, a2: { outcome: 'pass' as const } } };
    expect(status(done, 'restart')).toBe('todo');
    expect(status({ ...done, entries: { ...done.entries, b1: { outcome: 'pass' } } }, 'restart')).toBe('done');
    expect(status({ ...done, entries: { ...done.entries, b1: { outcome: 'fail' } } }, 'restart')).toBe('fail');
    expect(status({ ...base(), serverOk: true }, 'restart')).toBe('locked');
  });

  it('is done at the airplane step when the network is off', () => {
    expect(status({ ...base(), online: true }, 'airplane')).toBe('todo');
    expect(status({ ...base(), online: null }, 'airplane')).toBe('todo');
    expect(status({ ...base(), online: false }, 'airplane')).toBe('done');
  });

  it('locks the automatic airplane-mode tests until the network is off and then follows their results', () => {
    expect(status({ ...base(), online: true }, 'offline-auto')).toBe('locked');
    expect(status({ ...base(), online: null }, 'offline-auto')).toBe('locked');
    expect(status({ ...base(), online: false }, 'offline-auto')).toBe('todo');
    expect(status({ ...base(), online: false, entries: { f1: { outcome: 'pass' } } }, 'offline-auto')).toBe('todo');
    expect(status({ ...base(), online: false, entries: { f1: { outcome: 'pass' }, f2: { outcome: 'info' } } }, 'offline-auto')).toBe('done');
    expect(status({ ...base(), online: false, entries: { f1: { outcome: 'pass' }, f2: { outcome: 'fail' } } }, 'offline-auto')).toBe('fail');
  });

  it('allows the report once the automatic tests have results', () => {
    expect(status(base(), 'report')).toBe('locked');
    expect(status({ ...base(), serverOk: true, entries: { a1: { outcome: 'pass' }, a2: { outcome: 'pass' } } }, 'report')).toBe('todo');
    expect(status({ ...base(), serverOk: true, entries: { a1: { outcome: 'fail' }, a2: { outcome: 'pass' } } }, 'report')).toBe('todo');
  });
});
