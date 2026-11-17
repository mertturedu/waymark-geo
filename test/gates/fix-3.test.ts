import { gainsOf } from '../../gates/fix-3';

describe('fix 3 gate parsing', () => {
  it('reads the gains and the windowed pan time from the test note', () => {
    const note = 'kurulu 7 il; tümü: 922 katman, açılış 900 ms, kaydırma p95 1000 ms; pencereli: 284 katman, açılış 500 ms, kaydırma p95 620 ms; açılış kazancı 44%, kaydırma kazancı 38%; üçer tur ortancası';
    expect(gainsOf(note)).toEqual({ open: 44, pan: 38, panMs: 620 });
  });

  it('reads a loss as a negative gain and refuses a note it cannot read', () => {
    const note = 'tümü: 1 katman, açılış 1 ms, kaydırma p95 1 ms; pencereli: 1 katman, açılış 2 ms, kaydırma p95 2 ms; açılış kazancı -100%, kaydırma kazancı -5%';
    expect(gainsOf(note)).toEqual({ open: -100, pan: -5, panMs: 2 });
    expect(gainsOf('hiçbir şey')).toBeNull();
  });
});
