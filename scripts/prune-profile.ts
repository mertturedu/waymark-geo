import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { styleVariants, usageProfile } from '../pipeline/build/tile-usage';

export const PROFILE_FIXTURE = fileURLToPath(new URL('../fixtures/prune-profile.json', import.meta.url));

export function profileFixture(): { digest: string; props: [string, string[]][]; named: string[]; labels: string[]; maxzoom: Record<string, number>; rules: [string, number][] } {
  const { digest, summary } = usageProfile(styleVariants());
  return { digest, props: summary.props, named: summary.named, labels: summary.labels, maxzoom: summary.maxzoom as Record<string, number>, rules: summary.rules.map(([key, list]) => [key, list.length]) };
}

const rows = (list: unknown[]): string => list.map((row) => `  ${JSON.stringify(row)}`).join(',\n');

export const formatFixture = (fixture: ReturnType<typeof profileFixture>): string =>
  `{\n "digest": ${JSON.stringify(fixture.digest)},\n "maxzoom": ${JSON.stringify(fixture.maxzoom)},\n "labels": ${JSON.stringify(fixture.labels)},\n "named": ${JSON.stringify(fixture.named)},\n "props": [\n${rows(fixture.props)}\n ],\n "rules": [\n${rows(fixture.rules)}\n ]\n}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = profileFixture();
  if (process.argv.includes('--write')) writeFileSync(PROFILE_FIXTURE, formatFixture(fixture));
  console.log(`budama profili ${fixture.digest}${process.argv.includes('--write') ? ` → ${PROFILE_FIXTURE}` : ''}`);
}
