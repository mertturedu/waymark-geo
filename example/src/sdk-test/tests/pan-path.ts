export const offset = (at: [number, number], east: number, north: number): [number, number] => [at[0] + east / (111320 * Math.cos((at[1] * Math.PI) / 180)), at[1] + north / 110540];

export const panPath = (start: [number, number], steps: number, meters: number): [number, number][] => {
  const moves: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const out: [number, number][] = [];
  let at = start;
  for (let i = 0; i < steps; i += 1) {
    const [east, north] = moves[Math.floor(i / 2) % moves.length]!;
    at = offset(at, east * meters, north * meters);
    out.push(at);
  }
  return out;
};
