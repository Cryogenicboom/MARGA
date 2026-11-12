import React from 'react';
import type { EngineMissionConstraints } from '@shared/types/engine';

interface MissionConstraintsPanelProps {
  constraints: EngineMissionConstraints;
  onChangeConstraints: (constraints: EngineMissionConstraints) => void;
}

type NumericField = 'walkingSpeedKmh' | 'maxSlopeDegrees' | 'maxEvaHours' | 'reserveEvaHours' | 'scienceTimeMinPerStop';

const FIELDS: Array<{
  field: NumericField;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  note: string;
}> = [
  { field: 'walkingSpeedKmh', label: 'Walking speed on flat ground', unit: 'km/h', min: 0.5, max: 3, step: 0.1, digits: 1, note: 'The engine slows this down on slopes.' },
  { field: 'maxSlopeDegrees', label: 'Maximum terrain slope', unit: '°', min: 5, max: 25, step: 1, digits: 0, note: 'The route never enters steeper ground.' },
  { field: 'maxEvaHours', label: 'EVA duration', unit: 'h', min: 2, max: 12, step: 0.5, digits: 1, note: 'Total time outside, including the reserve.' },
  { field: 'reserveEvaHours', label: 'Safety reserve', unit: 'h', min: 0.5, max: 4, step: 0.5, digits: 1, note: 'Held back from the EVA duration.' },
  { field: 'scienceTimeMinPerStop', label: 'Science time per stop', unit: 'min', min: 0, max: 120, step: 5, digits: 0, note: 'Working time at the destination, counted in the EVA budget.' },
];

/** Mobility and EVA constraints sent to the engine with every route request. */
export const MissionConstraintsPanel: React.FC<MissionConstraintsPanelProps> = ({ constraints, onChangeConstraints }) => (
  <div className="space-y-3">
    {FIELDS.map((f) => {
      const value = constraints[f.field] ?? 0;
      return (
        <div key={f.field}>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`c-${f.field}`} className="text-muted">
              {f.label}
            </label>
            <span className="num">
              {value.toFixed(f.digits)} {f.unit}
            </span>
          </div>
          <input
            id={`c-${f.field}`}
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={value}
            onChange={(e) => onChangeConstraints({ ...constraints, [f.field]: parseFloat(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-faint">{f.note}</p>
        </div>
      );
    })}
    <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
      <span className="text-muted">Maximum one-way distance</span>
      <span className="num">{(constraints.maxDistanceMeters / 1000).toFixed(0)} km (fixed)</span>
    </div>
  </div>
);
