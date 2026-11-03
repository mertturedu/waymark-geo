import { newMarks, shotPath } from '../../scripts/device-shots';

describe('device shots', () => {
  it('takes only the marks that arrived since the last look', () => {
    const marks = [{ id: 'a', at: 1 }, { id: 'b', at: 2 }, { id: 'c', at: 3 }];
    expect(newMarks(marks, 0)).toEqual(marks);
    expect(newMarks(marks, 2)).toEqual([{ id: 'c', at: 3 }]);
    expect(newMarks(marks, 3)).toEqual([]);
    expect(newMarks([], 0)).toEqual([]);
  });

  it('keeps the file name safe', () => {
    expect(shotPath('/out', { id: 'kadikoy-z16', at: 1 })).toBe('/out/kadikoy-z16.png');
    expect(shotPath('/out', { id: '../etc/pass wd', at: 1 })).toBe('/out/.._etc_pass_wd.png');
  });
});
