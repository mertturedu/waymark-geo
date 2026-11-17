import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReports } from '../../gates/phase-5';

const report = (id: string) => ({ reportId: id, createdAt: id, device: { model: 'iPhone12,1', os: 'iOS 26.1' }, sdk: { version: '0.4.0', dataVersion: null, build: 'release' }, entries: [] });

it('reads pasted reports and reports the pack server received', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  mkdirSync(join(dir, 'cihaz'));
  writeFileSync(join(dir, 'cihaz-pasted.json'), JSON.stringify(report('pasted')));
  writeFileSync(join(dir, 'cihaz', 'cihaz-uploaded.json'), JSON.stringify(report('uploaded')));
  writeFileSync(join(dir, 'cihaz', 'cihaz-broken.json'), '{');
  expect(readReports(dir).map((r) => r.reportId).sort()).toEqual(['pasted', 'uploaded']);
  expect(readReports(join(dir, 'missing'))).toEqual([]);
});
