import type { Outcome } from '../../../src/core';
import type { StepStatus } from '../device-test/guide';

export type SdkStepId = 'server' | 'auto' | 'restart' | 'airplane' | 'offline-auto' | 'report';
export type SdkStep = { id: SdkStepId; status: StepStatus; blocker?: string };

export type SdkGuideState = {
  serverOk: boolean;
  entries: Record<string, { outcome: Outcome }>;
  online: boolean | null;
  autoIds: string[];
  restartIds: string[];
  offlineAutoIds: string[];
};

const step = (id: SdkStepId, status: StepStatus): SdkStep => ({ id, status });
const locked = (id: SdkStepId, blocker: string): SdkStep => ({ id, status: 'locked', blocker });

function testsStatus(state: SdkGuideState, ids: string[]): StepStatus {
  const results = ids.map((id) => state.entries[id]?.outcome);
  if (results.some((outcome) => outcome === 'fail')) return 'fail';
  return results.every((outcome) => outcome === 'pass' || outcome === 'info') ? 'done' : 'todo';
}

const answered = (state: SdkGuideState, ids: string[]): boolean => ids.every((id) => state.entries[id] !== undefined);

export function sdkGuideSteps(state: SdkGuideState): SdkStep[] {
  const auto = state.serverOk ? testsStatus(state, state.autoIds) : 'todo';
  const autoDone = state.serverOk && answered(state, state.autoIds);
  const networkOff = state.online === false;
  return [
    step('server', state.serverOk ? 'done' : 'todo'),
    !state.serverOk ? locked('auto', 'Önce sunucuya bağlan') : step('auto', auto),
    !autoDone ? locked('restart', 'Önce otomatik testleri bitir') : step('restart', testsStatus(state, state.restartIds)),
    step('airplane', networkOff ? 'done' : 'todo'),
    !networkOff ? locked('offline-auto', "Önce uçak modunu aç ve Wi-Fi'ı kapat") : step('offline-auto', testsStatus(state, state.offlineAutoIds)),
    state.serverOk && state.autoIds.every((id) => state.entries[id] !== undefined) ? step('report', 'todo') : locked('report', 'Önce otomatik testleri çalıştır'),
  ];
}
