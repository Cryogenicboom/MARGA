/**
 * Web Worker that hosts the MARGA core engine so A* searches never block the map or the panels.
 * Loaded by routeService.ts with `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })`,
 * which Vite bundles without any config change.
 */
import { runJob, type EngineJob, type EngineJobResult } from './engineHost';

export interface EngineWorkerRequest {
  id: number;
  job: EngineJob;
}

export type EngineWorkerReply =
  | { id: number; ok: true; result: EngineJobResult }
  | { id: number; ok: false; error: string };

// Typed view of the worker global without pulling the WebWorker lib into the DOM-typed project.
const scope = self as unknown as {
  addEventListener(type: 'message', handler: (e: MessageEvent<EngineWorkerRequest>) => void): void;
  postMessage(message: EngineWorkerReply, transfer?: Transferable[]): void;
};

scope.addEventListener('message', async (e) => {
  const msg = e.data;
  try {
    const result = await runJob(msg.job);
    // Terrain grids are large (a few MB): move them instead of copying them.
    const transfer = result.kind === 'terrain' ? [result.layers.elevation.buffer, result.layers.slope.buffer] : [];
    scope.postMessage({ id: msg.id, ok: true, result }, transfer);
  } catch (err) {
    scope.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
