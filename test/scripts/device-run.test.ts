import { launchCommands, parseArgs, parseRss, runJob, runUrl, summarize, waitForReport, type RunArgs, type WaitDeps } from '../../scripts/device-run';

const args = (extra: Partial<RunArgs> = {}): RunArgs => ({ target: 'sim', ids: ['sdk.map-open'], tab: false, timeoutMs: 1000, udid: 'U', location: null, fresh: false, rss: false, server: 'http://127.0.0.1:8090', repeat: 1, ...extra });

describe('parseArgs', () => {
  it('reads target, ids, location and flags', () => {
    expect(parseArgs(['--target', 'phone', '--ids', 'sdk.map-open, sdk.offline-search', '--app', '--timeout', '60', '--location', '38.68,29.40', '--fresh'])).toEqual({
      target: 'phone',
      ids: ['sdk.map-open', 'sdk.offline-search'],
      tab: true,
      timeoutMs: 60000,
      udid: '00008030-001A59511E23402E',
      location: [38.68, 29.4],
      fresh: true,
      rss: false,
      server: 'http://127.0.0.1:8090',
      repeat: 1,
    });
  });

  it('refuses bad input with a message', () => {
    expect(parseArgs(['--target', 'tv', '--ids', 'x'])).toMatch(/unknown target/);
    expect(parseArgs(['--target', 'sim'])).toMatch(/missing --ids/);
    expect(parseArgs(['--ids', ' , '])).toMatch(/missing --ids/);
    expect(parseArgs(['--ids', 'x', '--timeout', '0'])).toMatch(/bad --timeout/);
    expect(parseArgs(['--ids', 'x', '--location', '95,29'])).toMatch(/bad --location/);
    expect(parseArgs(['--ids', 'x', '--location', 'abc'])).toMatch(/bad --location/);
    expect(parseArgs(['--ids', 'x', '--repeat', '0'])).toMatch(/bad --repeat/);
    expect(parseArgs(['--ids', 'x', '--repeat', '21'])).toMatch(/bad --repeat/);
    expect(parseArgs(['--ids', 'x', '--repeat', '10'])).toMatchObject({ repeat: 10 });
  });

  it('accepts the automatic list', () => {
    expect(parseArgs(['--ids', 'auto'])).toMatchObject({ ids: 'auto', target: 'sim', server: 'http://127.0.0.1:8090' });
    expect(parseArgs(['--ids', 'x', '--server', 'http://10.0.0.2:9000'])).toMatchObject({ server: 'http://10.0.0.2:9000' });
  });
});

describe('runUrl', () => {
  it('encodes ids and adds the tab and a nonce', () => {
    expect(runUrl(['sdk.map-open', 'a b'], true, '17')).toBe('geoornek://run?ids=sdk.map-open,a%20b&tab=app&n=17');
    expect(runUrl('auto', false, '1')).toBe('geoornek://run?ids=auto&n=1');
  });
});

describe('launchCommands', () => {
  it('starts the app on the phone with a fresh process and no link', () => {
    expect(launchCommands(args({ target: 'phone', udid: 'U' }))).toEqual([
      { argv: ['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', 'U', '--terminate-existing', 'com.aakgur.yuksigeoexample'], optional: false },
    ]);
  });

  it('grants and sets the simulator location before launching', () => {
    const commands = launchCommands(args({ location: [38.68, 29.4], fresh: true })).map((c) => c.argv.slice(2, 4).join(' '));
    expect(commands).toEqual(['terminate booted', 'privacy booted', 'location booted', 'launch booted']);
    expect(launchCommands(args({ fresh: true }))[0]!.optional).toBe(true);
  });

  it('writes the job the app picks up from the server', () => {
    expect(JSON.parse(runJob(['sdk.map-open'], true, '7'))).toEqual({ ids: ['sdk.map-open'], tab: 'app', n: '7' });
    expect(JSON.parse(runJob('auto', false, '8'))).toEqual({ ids: 'auto', n: '8' });
    expect(JSON.parse(runJob(['a'], false, '9', 10))).toEqual({ ids: ['a'], repeat: 10, n: '9' });
    expect(JSON.parse(runJob(['a'], false, '9', 1, 'phone'))).toEqual({ ids: ['a'], target: 'phone', n: '9' });
  });
});

describe('waitForReport', () => {
  const fake = (files: Record<string, number>, clock = { t: 0 }): WaitDeps => ({
    list: () => Object.keys(files),
    mtime: (path) => files[path.split('/').pop()!]!,
    sleep: async (ms) => void (clock.t += ms),
    now: () => clock.t,
  });

  it('returns the newest report written after the start', async () => {
    expect(await waitForReport('/r', 100, 5000, fake({ 'cihaz-a.json': 50, 'cihaz-b.json': 150, 'cihaz-c.json': 120, 'cihaz-d.md': 900, 'other.json': 900 }))).toBe('/r/cihaz-b.json');
  });

  it('gives up after the timeout', async () => {
    const clock = { t: 0 };
    expect(await waitForReport('/r', 100, 3000, fake({ 'cihaz-a.json': 50 }, clock), 1000)).toBeNull();
    expect(clock.t).toBe(3000);
  });
});

describe('summarize', () => {
  it('counts outcomes and fails on any failure', () => {
    const report = {
      reportId: 'iPhone12,1-1',
      createdAt: '',
      device: { model: 'm', os: 'o' },
      sdk: { version: '0.4.0', dataVersion: null, build: 'release' as const },
      entries: [
        { id: 'a', title: 'a', kind: 'auto' as const, outcome: 'pass' as const, value: '12', unit: 'ms' },
        { id: 'b', title: 'b', kind: 'auto' as const, outcome: 'fail' as const, note: 'kayıt bulunamadı' },
        { id: 'c', title: 'c', kind: 'auto' as const, outcome: 'info' as const },
      ],
    };
    const summary = summarize(report);
    expect(summary.failed).toBe(1);
    expect(summary.text.split('\n')[0]).toBe('iPhone12,1-1: 1 geçti, 1 hata, 1 bilgi, 0 atlandı');
    expect(summary.text).toContain('pass  a  12 ms');
    expect(summary.text).toContain('(kayıt bulunamadı)');
  });
});

describe('parseRss', () => {
  it('takes the largest resident size of the matching processes', () => {
    expect(parseRss('101\n202\n', (pid) => (pid === '101' ? ' 81234\n' : '412000\n'))).toBe(412000);
  });

  it('returns null when nothing matches or the size is unreadable', () => {
    expect(parseRss('', () => '1')).toBeNull();
    expect(parseRss('12', () => 'x')).toBeNull();
  });
});

describe('waitForReport polling', () => {
  it('calls the sampler on every poll', async () => {
    let polls = 0;
    const clock = { t: 0 };
    await waitForReport('/r', 1, 2000, { list: () => [], mtime: () => 0, sleep: async (ms) => void (clock.t += ms), now: () => clock.t }, 1000, () => void (polls += 1));
    expect(polls).toBe(3);
  });
});
