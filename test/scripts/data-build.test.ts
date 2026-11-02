import { optionValue } from '../../scripts/data-build';

describe('optionValue', () => {
  it('reads a value given with an equals sign or after the name', () => {
    expect(optionValue(['--regions=12il'], '--regions')).toBe('12il');
    expect(optionValue(['--regions', 'all', '--force'], '--regions')).toBe('all');
    expect(optionValue(['--force'], '--regions')).toBeUndefined();
    expect(optionValue(['--regions'], '--regions')).toBeUndefined();
  });
});
