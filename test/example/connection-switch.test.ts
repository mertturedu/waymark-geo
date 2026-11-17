import { connectionSwitch } from '../../example/src/sdk-test/tests/connection-switch';

describe('connection switch', () => {
  it('tells the current kind and passes changes to listeners until they leave', async () => {
    const link = connectionSwitch('cellular');
    expect(await link.kind()).toBe('cellular');
    const seen: string[] = [];
    const off = link.onChange((kind) => seen.push(kind));
    link.set('wifi');
    expect(await link.kind()).toBe('wifi');
    off();
    link.set('none');
    expect(seen).toEqual(['wifi']);
    expect(await link.kind()).toBe('none');
  });
});
