import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const CACHE_DIR = join(process.cwd(), 'dist', 'llm-cache');

export const MODELS = ['qwen3:14b', 'gemma3:12b'] as const;

const caches = new Map<string, Map<string, unknown>>();

function cacheOf(model: string): Map<string, unknown> {
  let map = caches.get(model);
  if (map) return map;
  map = new Map();
  const file = join(CACHE_DIR, `${model.replace(/[^a-z0-9]+/gi, '_')}.jsonl`);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const [key, value] = JSON.parse(line) as [string, unknown];
        map.set(key, value);
      } catch {
        continue;
      }
    }
  }
  caches.set(model, map);
  return map;
}

export async function ask<T>(model: string, system: string, user: string, schema: object, options: { numPredict?: number } = {}): Promise<T | null> {
  const key = createHash('sha1').update(`${system}\n${user}\n${JSON.stringify(schema)}`).digest('hex');
  const cache = cacheOf(model);
  if (cache.has(key)) return cache.get(key) as T | null;
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, think: false, format: schema, options: { temperature: 0, seed: 7, num_predict: options.numPredict ?? 200 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!response.ok) return null;
  let value: T | null = null;
  try {
    value = JSON.parse(((await response.json()) as { message: { content: string } }).message.content) as T;
  } catch {
    value = null;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  appendFileSync(join(CACHE_DIR, `${model.replace(/[^a-z0-9]+/gi, '_')}.jsonl`), `${JSON.stringify([key, value])}\n`);
  cache.set(key, value);
  return value;
}
