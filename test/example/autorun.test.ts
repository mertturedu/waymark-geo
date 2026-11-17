import { jobEndpoint, parseRunJob, parseRunUrl, pickTests, reportEndpoint } from '../../example/src/sdk-test/autorun';
import type { DeviceTest } from '../../example/src/device-test/types';

const test = (id: string, question?: string): DeviceTest => ({ id, title: id, kind: question ? 'manual' : 'auto', ...(question ? { question } : {}), run: async () => ({ outcome: 'pass' }) });
const registry = [test('sdk.map-open'), test('sdk.offline-search'), test('sdk.q-map', 'Harita göründü mü?')];

describe('parseRunUrl', () => {
  it('reads ids, tab and keeps the url as the key', () => {
    expect(parseRunUrl('geoornek://run?ids=sdk.map-open,sdk.offline-search&tab=app&n=17')).toEqual({ ids: ['sdk.map-open', 'sdk.offline-search'], tab: 'app', key: 'geoornek://run?ids=sdk.map-open,sdk.offline-search&tab=app&n=17', repeat: 1 });
  });

  it('accepts the whole automatic list', () => {
    expect(parseRunUrl('geoornek://run?ids=auto')).toMatchObject({ ids: 'auto', tab: null });
  });

  it('decodes encoded commas and drops duplicates and blanks', () => {
    expect(parseRunUrl('geoornek://run/?ids=sdk.map-open%2C%20sdk.map-open%2C%2C')?.ids).toEqual(['sdk.map-open']);
  });

  it('ignores other links and empty lists', () => {
    expect(parseRunUrl(null)).toBeNull();
    expect(parseRunUrl('')).toBeNull();
    expect(parseRunUrl('geoornek://map?ids=x')).toBeNull();
    expect(parseRunUrl('geoornek://run')).toBeNull();
    expect(parseRunUrl('geoornek://run?ids=')).toBeNull();
    expect(parseRunUrl('geoornek://run?ids=,,')).toBeNull();
    expect(parseRunUrl('https://example.org/run?ids=x')).toBeNull();
  });

  it('survives a broken escape', () => {
    expect(parseRunUrl('geoornek://run?ids=sdk.map-open%E0')?.ids).toEqual(['sdk.map-open%E0']);
  });
});

describe('pickTests', () => {
  it('runs known automatic records and reports the rest', () => {
    const { tests, missing } = pickTests({ ids: ['sdk.map-open', 'sdk.nope', 'sdk.q-map'], tab: null, key: 'k', repeat: 1 }, registry, registry);
    expect(tests.map((t) => t.id)).toEqual(['sdk.map-open']);
    expect(missing).toEqual([
      expect.objectContaining({ id: 'sdk.nope', outcome: 'fail' }),
      expect.objectContaining({ id: 'sdk.q-map', outcome: 'skip' }),
    ]);
  });

  it('keeps the order of the request', () => {
    expect(pickTests({ ids: ['sdk.offline-search', 'sdk.map-open'], tab: null, key: 'k', repeat: 1 }, registry, registry).tests.map((t) => t.id)).toEqual(['sdk.offline-search', 'sdk.map-open']);
  });

  it('leaves questions out of the automatic list', () => {
    expect(pickTests({ ids: 'auto', tab: null, key: 'k', repeat: 1 }, registry, registry).tests.map((t) => t.id)).toEqual(['sdk.map-open', 'sdk.offline-search']);
  });
});

it('builds the report address without a double slash', () => {
  expect(reportEndpoint('http://192.168.1.101:8090/')).toBe('http://192.168.1.101:8090/report');
  expect(reportEndpoint('http://192.168.1.101:8090')).toBe('http://192.168.1.101:8090/report');
});

describe('parseRunJob', () => {
  it('reads a job from the server', () => {
    expect(parseRunJob('{"ids":["sdk.map-open"," sdk.map-open ","b"],"tab":"app","n":"9"}')).toEqual({ ids: ['sdk.map-open', 'b'], tab: 'app', key: 'job:9', repeat: 1 });
    expect(parseRunJob('{"ids":"auto","n":"1"}')).toEqual({ ids: 'auto', tab: null, key: 'job:1', repeat: 1 });
  });

  it('refuses broken or empty jobs', () => {
    for (const text of ['', '{', 'null', '[]', '{"ids":["a"]}', '{"ids":[],"n":"1"}', '{"ids":[1],"n":"1"}', '{"ids":"x","n":"1"}', '{"ids":["a"],"n":""}']) expect(parseRunJob(text)).toBeNull();
  });

  it('builds the job address', () => {
    expect(jobEndpoint('http://h:8090/')).toBe('http://h:8090/run');
  });
});

describe('repeat', () => {
  it('reads the repeat count and keeps it within limits', () => {
    expect(parseRunUrl('geoornek://run?ids=a&repeat=10')?.repeat).toBe(10);
    expect(parseRunUrl('geoornek://run?ids=a&repeat=99')?.repeat).toBe(20);
    expect(parseRunUrl('geoornek://run?ids=a&repeat=x')?.repeat).toBe(1);
    expect(parseRunJob('{"ids":["a"],"repeat":3,"n":"1"}')?.repeat).toBe(3);
    expect(parseRunJob('{"ids":["a"],"repeat":0,"n":"1"}')?.repeat).toBe(1);
  });

  it('runs the list again with numbered ids', () => {
    const { tests } = pickTests({ ids: ['sdk.map-open', 'sdk.offline-search'], tab: null, key: 'k', repeat: 3 }, registry, registry);
    expect(tests.map((t) => t.id)).toEqual(['sdk.map-open', 'sdk.offline-search', 'sdk.map-open#2', 'sdk.offline-search#2', 'sdk.map-open#3', 'sdk.offline-search#3']);
  });
});
