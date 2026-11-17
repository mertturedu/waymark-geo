import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profileFixture } from '../../scripts/prune-profile';

describe('pruned tiles and the map style', () => {
  it('the style reads only what the pruned packs were built for; rebuild the packs and run scripts/prune-profile.ts --write when this changes', () => {
    const saved = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'prune-profile.json'), 'utf8')) as ReturnType<typeof profileFixture>;
    const now = profileFixture();
    expect(now.props).toEqual(saved.props);
    expect(now.rules).toEqual(saved.rules);
    expect(now.digest).toBe(saved.digest);
  });
});
