import { describeProbeFailure } from '../../example/src/device-test/probe-error';

const url = 'http://192.168.1.110:8090';

describe('describeProbeFailure', () => {
  it('explains a timeout as an unreachable network, with the address', () => {
    const text = describeProbeFailure(url, Object.assign(new Error('aborted'), { name: 'AbortError' }), 5001, 5000);
    expect(text).toContain('zaman aşımı');
    expect(text).toContain(url);
    expect(text).toContain('aynı Wi-Fi');
  });

  it('treats a failure that took about the whole timeout as a timeout', () => {
    expect(describeProbeFailure(url, new Error('Network request failed'), 4950, 5000)).toContain('zaman aşımı');
  });

  it('points at the local network permission for an instant failure and keeps the raw message', () => {
    const text = describeProbeFailure(url, new Error('Network request failed'), 120, 5000);
    expect(text).toContain('hemen');
    expect(text).toContain('Network request failed');
    expect(text).toContain('Yerel Ağ');
  });

  it('copes with errors that are not Error objects', () => {
    expect(describeProbeFailure(url, 'boom', 100, 5000)).toContain('boom');
    expect(describeProbeFailure(url, undefined, 100, 5000)).toContain(url);
  });

  it('mentions the elapsed time in milliseconds', () => {
    expect(describeProbeFailure(url, new Error('x'), 3200, 5000)).toContain('3200 ms');
  });
});
