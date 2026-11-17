import type { Outcome } from '../../../src/core';

export type StepStatus = 'locked' | 'todo' | 'done' | 'fail';
export type StepId = 'server' | 'packs' | 'online-tests' | 'airplane' | 'map' | 'map-tests' | 'questions' | 'report';
export type GuideStep = { id: StepId; status: StepStatus; blocker?: string };

export type GuideState = {
  serverOk: boolean;
  packsMissing: number | null;
  entries: Record<string, { outcome: Outcome }>;
  online: boolean | null;
  mapOpened: boolean;
  internetTests: string[];
  mapTests: string[];
  questions: string[];
};

const locked = (id: StepId, blocker: string): GuideStep => ({ id, status: 'locked', blocker });
const step = (id: StepId, status: StepStatus): GuideStep => ({ id, status });

function testsStatus(state: GuideState, ids: string[], accepted: Outcome[]): StepStatus {
  const results = ids.map((id) => state.entries[id]?.outcome);
  if (results.some((outcome) => outcome === 'fail')) return 'fail';
  return results.every((outcome) => outcome !== undefined && accepted.includes(outcome)) ? 'done' : 'todo';
}

export function guideSteps(state: GuideState): GuideStep[] {
  const packsDone = state.packsMissing === 0;
  const onlineStatus = testsStatus(state, state.internetTests, ['pass', 'info']);
  const networkOff = state.online === false;

  const server = step('server', state.serverOk ? 'done' : 'todo');
  const packs = packsDone ? step('packs', 'done') : state.serverOk ? step('packs', 'todo') : locked('packs', 'Önce sunucuya bağlan');
  const onlineTests = !state.serverOk ? locked('online-tests', 'Önce sunucuya bağlan') : !packsDone ? locked('online-tests', 'Önce paketleri indir') : step('online-tests', onlineStatus);
  const airplane = step('airplane', networkOff ? 'done' : 'todo');
  const map = !networkOff ? locked('map', "Önce uçak modunu aç ve Wi-Fi'ı kapat") : step('map', state.mapOpened ? 'done' : 'todo');
  const mapTests = !networkOff
    ? locked('map-tests', "Önce uçak modunu aç ve Wi-Fi'ı kapat")
    : !state.mapOpened
      ? locked('map-tests', 'Önce Harita sekmesini aç')
      : step('map-tests', testsStatus(state, state.mapTests, ['pass']));
  const answered = state.questions.every((id) => state.entries[id]);
  const questions = answered
    ? step('questions', 'done')
    : !networkOff
      ? locked('questions', "Önce uçak modunu aç ve Wi-Fi'ı kapat")
      : !state.mapOpened
        ? locked('questions', 'Önce Harita sekmesini aç')
        : step('questions', 'todo');
  const report = onlineStatus === 'todo' ? locked('report', 'Önce internetli testleri bitir') : step('report', 'todo');
  return [server, packs, onlineTests, airplane, map, mapTests, questions, report];
}
