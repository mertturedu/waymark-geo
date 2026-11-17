export type SavedPoint = { key: string; text: string; point: [number, number]; count: number; at: number };

type Line = { key?: unknown; text?: unknown; confirmations?: unknown };
type Confirmation = { lng?: unknown; lat?: unknown; at?: unknown };

export function savedPoints(lines: string[]): SavedPoint[] {
  const out: SavedPoint[] = [];
  for (const raw of lines) {
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (typeof line.key !== 'string' || typeof line.text !== 'string' || !Array.isArray(line.confirmations)) continue;
    const last = (line.confirmations as Confirmation[]).filter((c) => typeof c.lng === 'number' && typeof c.lat === 'number' && Number.isFinite(c.lng) && Number.isFinite(c.lat)).reduce<Confirmation | undefined>((latest, c) => (latest === undefined || Number(c.at ?? 0) >= Number(latest.at ?? 0) ? c : latest), undefined);
    if (!last) continue;
    out.push({ key: line.key, text: line.text, point: [last.lng as number, last.lat as number], count: line.confirmations.length, at: Number(last.at ?? 0) });
  }
  return out.sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1));
}
