import { BURST_SECONDS, createGuard, DEFAULT_RPS, FAIL_LIMIT, FAIL_WINDOW_MS } from '../../server/guard';

describe('createGuard', () => {
  const keys = [{ id: 'kargo', secret: 'gizli-bir' }, { id: 'yavas', secret: 'gizli-iki', rps: 1 }];

  it('knows a key by either header and refuses a missing or wrong one', () => {
    const guard = createGuard(keys);
    expect(guard.authenticate({ 'x-api-key': 'gizli-bir' })?.id).toBe('kargo');
    expect(guard.authenticate({ authorization: 'Bearer gizli-iki' })?.id).toBe('yavas');
    expect(guard.authenticate({ 'x-api-key': 'yanlis' })).toBeNull();
    expect(guard.authenticate({ authorization: 'Basic gizli-bir' })).toBeNull();
    expect(guard.authenticate({ 'x-api-key': ['gizli-bir'] })).toBeNull();
    expect(guard.authenticate({})).toBeNull();
    expect(createGuard([]).authenticate({ 'x-api-key': 'gizli-bir' })).toBeNull();
  });

  it('lets a burst through, says how long to wait after it and refills with time', () => {
    let t = 1000;
    const guard = createGuard(keys, () => t);
    const burst = DEFAULT_RPS * BURST_SECONDS;
    for (let i = 0; i < burst; i++) expect(guard.allow('kargo')).toBe(0);
    expect(guard.allow('kargo')).toBeGreaterThanOrEqual(1);
    t += 1000;
    expect(guard.allow('kargo')).toBe(0);
    expect(guard.allow('yavas')).toBe(0);
    expect(guard.allow('yavas')).toBe(0);
    expect(guard.allow('yavas')).toBe(1);
    expect(guard.allow('bilinmeyen')).toBe(0);
  });

  it('counts failed tries per address and forgets them after the window', () => {
    let t = 0;
    const guard = createGuard(keys, () => t);
    for (let i = 0; i < FAIL_LIMIT; i++) expect(guard.failed('1.2.3.4')).toBe(false);
    expect(guard.failed('1.2.3.4')).toBe(true);
    expect(guard.failed('5.6.7.8')).toBe(false);
    t += FAIL_WINDOW_MS + 1;
    expect(guard.failed('1.2.3.4')).toBe(false);
  });
});
