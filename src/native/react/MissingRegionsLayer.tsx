import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { embeddedBorders } from '../../core/region/embedded';
import { regionOutlines } from '../../core/region/outline';
import { fadeLevel, missingPlates, removedPlates } from '../logic/missing-regions';
import { useRegions } from './hooks';

export type MissingRegionsStyle = { id?: string; line?: string; fill?: string; fillOpacity?: number; pattern?: string; patternOpacity?: number; lineWidth?: number; fadeMs?: number };

const LINE_LAYOUT = { 'line-join': 'round' } as const;
const FADE_DELAY_MS = 150;
const FADE_STEP_MS = 50;

type Look = Required<Pick<MissingRegionsStyle, 'line' | 'fill' | 'fillOpacity' | 'patternOpacity' | 'lineWidth' | 'fadeMs'>> & Pick<MissingRegionsStyle, 'pattern'>;

function Outlines({ id, plates, look, level }: { id: string; plates: string[]; look: Look; level: number }) {
  const data = useMemo(() => regionOutlines(embeddedBorders(), plates), [plates]);
  const fillPaint = useMemo(() => ({ 'fill-color': look.fill, 'fill-opacity': look.fillOpacity * level }), [look.fill, look.fillOpacity, level]);
  const hatchPaint = useMemo(() => ({ 'fill-pattern': look.pattern, 'fill-opacity': look.patternOpacity * level }), [look.pattern, look.patternOpacity, level]);
  const linePaint = useMemo(() => ({ 'line-color': look.line, 'line-width': look.lineWidth, 'line-opacity': level }), [look.line, look.lineWidth, level]);
  return (
    <GeoJSONSource id={id} data={data as never}>
      <Layer id={`${id}-fill`} type="fill" paint={fillPaint} />
      {look.pattern ? <Layer id={`${id}-hatch`} type="fill" paint={hatchPaint as never} /> : null}
      <Layer id={`${id}-line`} type="line" layout={LINE_LAYOUT} paint={linePaint} />
    </GeoJSONSource>
  );
}

export function MissingRegionsLayer({ id = 'yuksi-missing-regions', line = '#E0050F', fill = '#E0050F', fillOpacity = 0.06, pattern, patternOpacity = 0.55, lineWidth = 2.5, fadeMs = 1400 }: MissingRegionsStyle) {
  'use no memo';
  const { regions, statusOf } = useRegions();
  const key = missingPlates(regions, (plate) => statusOf(plate).state).join(',');
  const missing = useMemo(() => (key === '' ? [] : key.split(',')), [key]);
  const [seen, setSeen] = useState(missing);
  const [fading, setFading] = useState<string[]>([]);
  const [level, setLevel] = useState(1);
  if (seen !== missing) {
    setSeen(missing);
    const left = removedPlates(seen, missing);
    if (left.length > 0) {
      setFading((list) => [...list, ...left]);
      setLevel(1);
    }
  }
  useEffect(() => {
    if (fading.length === 0) return;
    const began = Date.now() + FADE_DELAY_MS;
    const timer = setInterval(() => {
      const elapsed = Date.now() - began;
      if (elapsed >= fadeMs) {
        clearInterval(timer);
        setFading([]);
        setLevel(1);
      } else if (elapsed > 0) setLevel(fadeLevel(elapsed, fadeMs));
    }, FADE_STEP_MS);
    return () => clearInterval(timer);
  }, [fading, fadeMs]);
  const look: Look = { line, fill, fillOpacity, patternOpacity, lineWidth, fadeMs, ...(pattern ? { pattern } : {}) };
  return (
    <>
      <Outlines id={id} plates={missing} look={look} level={1} />
      {fading.length > 0 ? <Outlines id={`${id}-fade`} plates={fading} look={look} level={level} /> : null}
    </>
  );
}
