import type { NetPort } from '../../src/core/packs/ports';
import { recordingNet, resumedWithRange } from '../../example/src/device-test/recording-fetch';

const fakeNet = (): NetPort => ({
  getText: async () => ({ status: 200, text: 'manifest' }),
  get: async (_url, options) => ({ status: options?.rangeStart ? 206 : 200, body: (async function* () { yield new Uint8Array(1); })() }),
});

describe('recordingNet', () => {
  it('records the range and status of every download and passes the answer on', async () => {
    const net = recordingNet(fakeNet());
    expect((await net.get('http://x/a')).status).toBe(200);
    expect((await net.get('http://x/a', { rangeStart: 100 })).status).toBe(206);
    await net.get('http://x/a', { rangeStart: 0 });
    expect(net.calls).toEqual([
      { method: 'GET', range: null, status: 200 },
      { method: 'GET', range: 'bytes=100-', status: 206 },
      { method: 'GET', range: null, status: 200 },
    ]);
  });

  it('leaves text requests alone', async () => {
    const net = recordingNet(fakeNet());
    expect(await net.getText('http://x/manifest-v1.json')).toEqual({ status: 200, text: 'manifest' });
    expect(net.calls).toEqual([]);
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
