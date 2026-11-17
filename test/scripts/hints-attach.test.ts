import { chainOf } from '../../scripts/hints-attach';

const seg = (highway: string, ...line: number[][]) => ({ highway, line });

describe('chainOf', () => {
  it('joins ways that continue through a shared end', () => {
    const out = chainOf([seg('residential', [29, 41], [29.001, 41]), seg('residential', [29.001, 41], [29.002, 41]), seg('residential', [29.003, 41], [29.002, 41])]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4);
    expect(out[0]![0]![0]).toBeCloseTo(29, 5);
    expect(out[0]![3]![0]).toBeCloseTo(29.003, 5);
  });

  it('keeps ways apart at a junction, a sharp turn or another road class', () => {
    expect(chainOf([seg('residential', [29, 41], [29.001, 41]), seg('residential', [29.001, 41], [29.002, 41]), seg('residential', [29.001, 41], [29.001, 41.001])])).toHaveLength(3);
    expect(chainOf([seg('residential', [29, 41], [29.001, 41]), seg('residential', [29.001, 41], [29.001, 41.001])])).toHaveLength(2);
    expect(chainOf([seg('residential', [29, 41], [29.001, 41]), seg('service', [29.001, 41], [29.002, 41])])).toHaveLength(2);
  });
});
