export type LocateMode = 'off' | 'follow' | 'heading';
export type LocatePermission = 'unknown' | 'granted' | 'denied';
export type Tracking = 'default' | 'heading' | 'course';

export const LOCATE_ZOOM = 16;

export const nextMode = (mode: LocateMode, headingMode = true): LocateMode => (mode === 'off' ? 'follow' : mode === 'follow' && headingMode ? 'heading' : 'follow');

export const trackingOf = (mode: LocateMode): Tracking | undefined => (mode === 'off' ? undefined : mode === 'follow' ? 'default' : 'heading');

export const modeOfTracking = (tracking: Tracking | null | undefined): LocateMode => (tracking === 'default' ? 'follow' : tracking === 'heading' || tracking === 'course' ? 'heading' : 'off');

export const zoomFor = (current: number | undefined, wanted: number): number => (current === undefined || !Number.isFinite(current) ? wanted : Math.max(current, wanted));

export const needsZoom = (current: number | undefined, wanted: number): boolean => current === undefined || !Number.isFinite(current) || current < wanted - 0.05;
