const BASE = 1792;

export function trigramCodes(key: string): number[] {
  if (key.length === 0) return [];
  const padded = `  ${key} `;
  const seen: Record<number, true> = {};
  const codes: number[] = [];
  for (let i = 0; i + 2 < padded.length; i++) {
    const a = padded.charCodeAt(i);
    const b = padded.charCodeAt(i + 1);
    const c = padded.charCodeAt(i + 2);
    if (a >= BASE || b >= BASE || c >= BASE) continue;
    const code = (a * BASE + b) * BASE + c;
    if (!seen[code]) {
      seen[code] = true;
      codes.push(code);
    }
  }
  return codes.sort((x, y) => x - y);
}

export function encodePostings(ids: number[]): Uint8Array {
  const sorted = [...new Set(ids)].sort((x, y) => x - y);
  const bytes: number[] = [];
  let previous = 0;
  for (const id of sorted) {
    let rest = id - previous;
    previous = id;
    while (rest >= 128) {
      bytes.push((rest % 128) + 128);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
  }
  return Uint8Array.from(bytes);
}

export function decodePostings(bytes: Uint8Array): number[] {
  const ids: number[] = [];
  let previous = 0;
  let value = 0;
  let factor = 1;
  let open = false;
  for (let i = 0; i < bytes.length; i++) {
    const next = bytes[i] as number;
    value += (next % 128) * factor;
    if (next < 128) {
      previous += value;
      ids.push(previous);
      value = 0;
      factor = 1;
      open = false;
    } else {
      factor *= 128;
      open = true;
    }
  }
  if (open) throw new Error('postings end in the middle of a number');
  return ids;
}
