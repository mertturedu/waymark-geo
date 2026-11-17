import { candidateUrls, findServer, type Probe } from '../../example/src/device-test/find-server';

const ok = (ms = 5): ReturnType<Probe> => Promise.resolve({ ok: true, ms });
const bad = (note = 'yok'): ReturnType<Probe> => Promise.resolve({ ok: false, note });

describe('candidateUrls', () => {
  it('puts the typed address first, then the build time list, without duplicates', () => {
    expect(candidateUrls('10.0.0.5:8090', 'http://192.168.1.110:8090,http://192.168.1.114:8090,http://10.0.0.5:8090')).toEqual([
      'http://10.0.0.5:8090',
      'http://192.168.1.110:8090',
      'http://192.168.1.114:8090',
    ]);
  });

  it('skips invalid entries and empty input', () => {
    expect(candidateUrls('', 'x y, ,http://a:1')).toEqual(['http://a:1']);
    expect(candidateUrls('', undefined)).toEqual([]);
  });
});

describe('findServer', () => {
  it('returns the first reachable address and stops asking', async () => {
    const asked: string[] = [];
    const result = await findServer(['http://a:1', 'http://b:1', 'http://c:1'], (url) => {
      asked.push(url);
      return url === 'http://b:1' ? ok(12) : bad('zaman aşımı');
    });
    expect(result.url).toBe('http://b:1');
    expect(asked).toEqual(['http://a:1', 'http://b:1']);
    expect(result.attempts).toEqual([
      { url: 'http://a:1', ok: false, note: 'zaman aşımı' },
      { url: 'http://b:1', ok: true, note: '12 ms' },
    ]);
  });

  it('reports every attempt when none works', async () => {
    const result = await findServer(['http://a:1', 'http://b:1'], () => bad('engellendi'));
    expect(result.url).toBeNull();
    expect(result.attempts.map((a) => a.note)).toEqual(['engellendi', 'engellendi']);
  });

  it('handles an empty list', async () => {
    expect(await findServer([], () => ok())).toEqual({ url: null, attempts: [] });
  });

  it('counts a thrown probe as a failed attempt', async () => {
    const result = await findServer(['http://a:1', 'http://b:1'], async (url) => {
      if (url === 'http://a:1') throw new Error('boom');
      return { ok: true, ms: 1 };
    });
    expect(result.url).toBe('http://b:1');
    expect(result.attempts[0]).toEqual({ url: 'http://a:1', ok: false, note: 'boom' });
  });
});
