import type { NetPort } from '../../../src/core/packs/ports';

export type FetchCall = { method: string; range: string | null; status: number };

export function recordingNet(inner: NetPort): NetPort & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    getText: (url, options) => inner.getText(url, options),
    async get(url, options) {
      const response = await inner.get(url, options);
      calls.push({ method: 'GET', range: options?.rangeStart ? `bytes=${options.rangeStart}-` : null, status: response.status });
      return response;
    },
  };
}

export const resumedWithRange = (calls: FetchCall[]): boolean =>
  calls.some((call) => {
    const start = /^bytes=(\d+)-/.exec(call.range ?? '')?.[1];
    return call.method === 'GET' && call.status === 206 && start !== undefined && Number(start) > 0;
  });
