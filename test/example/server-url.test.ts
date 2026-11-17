import { normalizeServerUrl, resolveServerUrl } from '../../example/src/device-test/server-url';

describe('normalizeServerUrl', () => {
  it.each([
    ['http://192.168.1.110:8090', 'http://192.168.1.110:8090'],
    ['  http://192.168.1.110:8090/  ', 'http://192.168.1.110:8090'],
    ['192.168.1.110:8090', 'http://192.168.1.110:8090'],
    ['https://geo.example.com/packs/', 'https://geo.example.com/packs'],
    ['HTTP://Host:1', 'http://Host:1'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['http://'], ['ftp://host'], ['http://ho st'], ['not a url at all']])('rejects %j', (input) => {
    expect(normalizeServerUrl(input)).toBeNull();
  });
});

describe('resolveServerUrl', () => {
  it('prefers a valid saved address', () => {
    expect(resolveServerUrl('http://10.0.0.5:8090', 'http://192.168.1.110:8090')).toBe('http://10.0.0.5:8090');
  });

  it('falls back to the build time address when nothing valid is saved', () => {
    expect(resolveServerUrl('', 'http://192.168.1.110:8090')).toBe('http://192.168.1.110:8090');
    expect(resolveServerUrl('???', 'http://192.168.1.110:8090')).toBe('http://192.168.1.110:8090');
  });

  it('is empty when there is neither', () => {
    expect(resolveServerUrl('', undefined)).toBe('');
    expect(resolveServerUrl('', '')).toBe('');
  });
});
