export type AttributionState = 'expanded' | 'collapsed';

export function nextAttribution(state: AttributionState, event: 'interact' | 'toggle' | 'show'): AttributionState {
  if (event === 'interact') return 'collapsed';
  if (event === 'show') return 'expanded';
  return state === 'expanded' ? 'collapsed' : 'expanded';
}
