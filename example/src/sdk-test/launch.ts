import { useEffect } from 'react';
import { Linking } from 'react-native';
import { jobEndpoint, parseRunJob, parseRunUrl, type RunRequest } from './autorun';

const POLL_MS = 3000;
const seen = new Set<string>();
const listeners = new Set<(request: RunRequest) => void>();

const announce = (request: RunRequest | null): void => {
  if (!request || seen.has(request.key)) return;
  seen.add(request.key);
  for (const listener of [...listeners]) listener(request);
};

export function useRunRequests(onRequest: (request: RunRequest) => void): void {
  useEffect(() => {
    listeners.add(onRequest);
    void Linking.getInitialURL().then((url) => announce(parseRunUrl(url)), () => undefined);
    const subscription = Linking.addEventListener('url', (event) => announce(parseRunUrl(event.url)));
    return () => {
      listeners.delete(onRequest);
      subscription.remove();
    };
  }, [onRequest]);
}

export function useRunPolling(server: string | null, idle: boolean): void {
  useEffect(() => {
    if (!server || !idle) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch(jobEndpoint(server), { headers: { 'Cache-Control': 'no-store' } });
        if (alive && response.status === 200) announce(parseRunJob(await response.text()));
      } catch {
        return;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [server, idle]);
}
