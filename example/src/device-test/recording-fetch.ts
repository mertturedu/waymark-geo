export type FetchCall = { method: string; range: string | null; status: number };

export function recordingFetch(inner: typeof fetch): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const wrapped = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await inner(input, init);
    calls.push({ method: init?.method ?? 'GET', range: new Headers(init?.headers).get('range'), status: response.status });
    return response;
  }) as typeof fetch;
  return { fetch: wrapped, calls };
}

export const resumedWithRange = (calls: FetchCall[]): boolean =>
  calls.some((call) => {
    const start = /^bytes=(\d+)-/.exec(call.range ?? '')?.[1];
    return call.method === 'GET' && call.status === 206 && start !== undefined && Number(start) > 0;
  });
