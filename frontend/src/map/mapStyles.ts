import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { ScienceCategory } from '@shared/types';

const CATEGORY_COLORS: Record<ScienceCategory, string> = {
  mineralogical: '#f59e0b', // Amber
  hydration: '#06b6d4',     // Cyan
  sedimentary: '#10b981',   // Emerald
  radiation: '#a855f7',     // Purple
  geological: '#f43f5e',    // Rose
};

export function getTargetStyle(category: ScienceCategory, name: string, isSelected = false) {
  const color = CATEGORY_COLORS[category] || '#3b82f6';
  const radius = isSelected ? 11 : 8;

  return new Style({
    image: new CircleStyle({
      radius: radius,
      fill: new Fill({ color: color }),
      stroke: new Stroke({
        color: isSelected ? '#ffffff' : '#0f172a',
        width: isSelected ? 3 : 2,
      }),
    }),
    text: new Text({
      text: name,
      font: 'bold 12px "Space Mono", monospace',
      offsetY: -16,
      fill: new Fill({ color: isSelected ? '#38bdf8' : '#e2e8f0' }),
      stroke: new Stroke({ color: '#090d16', width: 3 }),
    }),
  });
}

export function getRouteStyle() {
  return [
    // Outer glow
    new Style({
      stroke: new Stroke({
        color: 'rgba(6, 182, 212, 0.4)',
        width: 8,
      }),
    }),
    // Main route line
    new Style({
      stroke: new Stroke({
        color: '#38bdf8',
        width: 4,
        lineDash: [10, 6],
      }),
    }),
  ];
}

export function getWaypointMarkerStyle(type: 'start' | 'destination' | 'waypoint', label: string) {
  const color = type === 'start' ? '#22c55e' : type === 'destination' ? '#ef4444' : '#eab308';
  return new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
    }),
    text: new Text({
      text: label,
      font: 'bold 11px "Space Mono", monospace',
      offsetY: 18,
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#000000', width: 3 }),
    }),
  });
}
