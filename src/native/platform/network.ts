import { fetch as streamingFetch } from 'expo/fetch';
import type { NetPort, NetResponse } from '../../core/packs/ports';

async function* chunksOf(response: Awaited<ReturnType<typeof streamingFetch>>): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield new Uint8Array(await response.arrayBuffer());
    return;
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createExpoNet(): NetPort {
  return {
    async get(url, options = {}): Promise<NetResponse> {
      const headers: Record<string, string> = options.rangeStart !== undefined && options.rangeStart > 0 ? { Range: `bytes=${options.rangeStart}-` } : {};
      const response = await streamingFetch(url, { headers, ...(options.signal ? { signal: options.signal } : {}) });
      return { status: response.status, body: chunksOf(response) };
    },
    async getText(url, options = {}) {
      const response = await streamingFetch(url, { headers: { 'Cache-Control': 'no-cache' }, ...(options.signal ? { signal: options.signal } : {}) });
      return { status: response.status, text: await response.text() };
    },
  };
}
