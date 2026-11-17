import { address, baseRows, part, where, type Rows } from '../../pipeline/helpers/mini-work';

export const LINE: [number, number][] = [[28.6, 40.7], [28.61, 40.7]];
const SIDE = 0.00005;

export function streetRows(options: { even?: number[]; odd?: number[]; withLine?: boolean; hood?: boolean } = {}): Rows {
  const rows = baseRows();
  rows.addresses = [];
  rows.streets = [];
  rows.places = [];
  const w = options.hood === false ? where('r10', null, 'none') : where('r10', 'r20');
  const at = (n: number): number => 28.6 + (n / 20) * 0.01;
  for (const n of options.even ?? []) rows.addresses.push(address(`n${1000 + n}`, 'Test Sokak', String(n), at(n), 40.7 + SIDE, w));
  for (const n of options.odd ?? []) rows.addresses.push(address(`n${2000 + n}`, 'Test Sokak', String(n), at(n), 40.7 - SIDE, w));
  if (options.withLine !== false) rows.streets.push(part('Test Sokak', w, [LINE], ['w9001']));
  return rows;
}
