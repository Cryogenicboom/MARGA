/**
 * One plain-language feasibility reading of an engine response, used by the route summary and the
 * Route tab. It only restates what the engine returned (route status, status reason, EVA status);
 * it never adds a judgement of its own, and "within budget" never means "safe".
 */
import type { EngineRouteResponse, EngineStatusReason } from '@shared/types/engine';
import type { StatusTone } from './StatusBadge';

/** Plain-language labels for the engine's status_reason codes. */
export const REASON_TEXT: Record<Exclude<EngineStatusReason, null>, string> = {
  invalid_request: 'The request was not valid.',
  outside_terrain_coverage: 'A point lies outside the terrain model.',
  start_not_traversable: 'The start lies on ground the route may not use.',
  destination_not_traversable: 'The destination lies on ground the route may not use.',
  no_traversable_path: 'No path stays within the slope limit and known terrain.',
  return_no_traversable_path: 'No return path stays within the slope limit and known terrain.',
  return_start_not_traversable: 'The return leg starts on ground the route may not use.',
  return_destination_not_traversable: 'The return leg ends on ground the route may not use.',
  eva_budget_exceeded: 'The round trip does not fit the EVA time budget.',
  engine_error: 'The engine reported an internal error.',
  terrain_unavailable: 'The terrain model could not be loaded.',
};

export interface Feasibility {
  tone: StatusTone;
  label: string;
  detail: string | null;
}

export function routeFeasibility(route: EngineRouteResponse | null): Feasibility {
  if (!route) return { tone: 'neutral', label: 'No route', detail: null };
  const reason = route.status_reason ? REASON_TEXT[route.status_reason] : null;
  if (route.status === 'failed' || route.status === 'unreachable' || route.coordinates.length < 2) {
    return { tone: 'bad', label: 'Not feasible', detail: reason ?? 'The engine found no route.' };
  }
  const eva = route.eva_assessment;
  if (eva?.status === 'exceeded') {
    return { tone: 'bad', label: 'Exceeds EVA budget', detail: reason ?? 'The round trip and reserve take longer than the EVA.' };
  }
  if (eva?.status === 'no_slack') {
    return { tone: 'warn', label: 'No time margin', detail: 'The round trip uses all usable time; any delay cuts into the reserve.' };
  }
  if (route.status === 'warning') {
    return { tone: 'warn', label: 'Feasible, with warnings', detail: reason ?? `${route.warnings.length} warning(s) from the engine.` };
  }
  if (eva?.status === 'within_budget') return { tone: 'ok', label: 'Within EVA budget', detail: null };
  return { tone: 'info', label: 'Route calculated', detail: 'No EVA assessment was returned.' };
}
