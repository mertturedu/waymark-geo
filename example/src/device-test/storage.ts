import { Directory, File, Paths } from 'expo-file-system';
import type { ReportEntry } from '../../../src/core';
import { buildId } from './env';
import { decodeEntries, encodeEntries } from './entries-store';
import type { InstallManifest } from './install-list';
import { decodeMemory, encodeMemory, importOldEntries, type Memory } from '../sdk-test/answers';

const stateDir = () => new Directory(Paths.document, 'geo-state');

export const packsDirectory = () => new Directory(Paths.document, 'packs');
export const reportsDirectory = () => new Directory(Paths.document, 'reports');

const ensure = (dir: Directory) => {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
};

export async function loadServerUrl(): Promise<string> {
  const file = new File(stateDir(), 'server-url.txt');
  return file.exists ? (await file.text()).trim() : '';
}

export function saveServerUrl(url: string): void {
  ensure(stateDir());
  const file = new File(stateDir(), 'server-url.txt');
  if (!file.exists) file.create();
  file.write(url.trim());
}

export function saveReport(reportId: string, text: string): string {
  ensure(reportsDirectory());
  const file = new File(reportsDirectory(), `${reportId}.txt`);
  if (!file.exists) file.create();
  file.write(text);
  return file.uri;
}

export function saveEntries(entries: Record<string, ReportEntry>): void {
  ensure(stateDir());
  const file = new File(stateDir(), 'entries.json');
  if (!file.exists) file.create();
  file.write(encodeEntries(buildId(), entries));
}

export async function loadEntries(): Promise<Record<string, ReportEntry>> {
  const file = new File(stateDir(), 'entries.json');
  return file.exists ? decodeEntries(await file.text(), buildId()) : {};
}

export function saveMemory(memory: Memory): void {
  ensure(stateDir());
  const file = new File(stateDir(), 'questions.json');
  if (!file.exists) file.create();
  file.write(encodeMemory(memory));
}

export async function loadMemory(): Promise<Memory> {
  const file = new File(stateDir(), 'questions.json');
  if (file.exists) return decodeMemory(await file.text());
  const old = new File(stateDir(), 'entries.json');
  const memory = old.exists ? importOldEntries(await old.text()) : { answers: {}, notes: {} };
  saveMemory(memory);
  return memory;
}

export function saveManifest(manifest: InstallManifest): void {
  ensure(stateDir());
  const file = new File(stateDir(), 'manifest.json');
  if (!file.exists) file.create();
  file.write(JSON.stringify(manifest));
}

export async function loadManifest(): Promise<InstallManifest | null> {
  const file = new File(stateDir(), 'manifest.json');
  return file.exists ? (JSON.parse(await file.text()) as InstallManifest) : null;
}

export function resetTestState(): void {
  for (const name of ['entries.json', 'questions.json', 'manifest.json']) {
    const file = new File(stateDir(), name);
    if (file.exists) file.delete();
  }
  const sandboxes = new Directory(Paths.document, 'sdk-test');
  if (sandboxes.exists) sandboxes.delete();
}
