import { recordingFetch, resumedWithRange } from '../../example/src/device-test/recording-fetch';

const fakeFetch = (statusFor: (range: string | null) => number): typeof fetch =>
  (async (_url: unknown, init?: RequestInit) => new Response('x', { status: statusFor(new Headers(init?.headers).get('range')) })) as typeof fetch;

describe('recordingFetch', () => {
  it('records method, range and status of every call', async () => {
    const { fetch: wrapped, calls } = recordingFetch(fakeFetch((range) => (range ? 206 : 200)));
    await wrapped('http://x/a', { method: 'HEAD' });
    await wrapped('http://x/a', { headers: { Range: 'bytes=0-' } });
    await wrapped('http://x/a', { headers: { Range: 'bytes=100-' } });
    expect(calls).toEqual([
      { method: 'HEAD', range: null, status: 200 },
      { method: 'GET', range: 'bytes=0-', status: 206 },
      { method: 'GET', range: 'bytes=100-', status: 206 },
    ]);
  });
});

describe('resumedWithRange', () => {
  it('is true only for a ranged GET that starts past zero and was answered 206', () => {
    expect(resumedWithRange([{ method: 'GET', range: 'bytes=100-', status: 206 }])).toBe(true);
    expect(resumedWithRange([{ method: 'GET', range: 'bytes=100-', status: 200 }])).toBe(false);
    expect(resumedWithRange([{ method: 'GET', range: 'bytes=0-', status: 206 }])).toBe(false);
    expect(resumedWithRange([{ method: 'GET', range: null, status: 200 }])).toBe(false);
    expect(resumedWithRange([{ method: 'HEAD', range: 'bytes=100-', status: 206 }])).toBe(false);
    expect(resumedWithRange([])).toBe(false);
  });
});
