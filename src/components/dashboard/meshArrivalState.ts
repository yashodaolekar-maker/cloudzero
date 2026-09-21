import type { CollaborationStep, TwinDomain } from './model';

export const meshPositions: Record<TwinDomain, [number, number]> = {
  Windows: [50, 12], Linux: [77, 24], Middleware: [86, 51], DevOps: [76, 78],
  Cyber: [50, 88], CloudOps: [24, 78], Database: [14, 51], Network: [23, 24],
};
export type MeshArrival = { id: string; path: string; reply: boolean };
export type ArrivalState = { mountedAt: number; initialized: boolean; seen: ReadonlySet<string> };
export const createArrivalState = (mountedAt: number): ArrivalState => ({ mountedAt, initialized: false, seen: new Set() });
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;

// Pure presentation selector. Never infer traffic from runtime status or timestamps alone.
export function selectMeshArrivals(state: ArrivalState, steps: readonly CollaborationStep[], reduced: boolean | null): { state: ArrivalState; arrivals: MeshArrival[] } {
  const seen = new Set(state.seen);
  const arrivals: MeshArrival[] = [];
  for (const step of steps) {
    const raw = record(step.raw);
    for (const kind of ['request', 'response'] as const) {
      const event = record(raw?.[kind]);
      if (typeof event?.id !== 'string' || !event.id) continue;
      const id = `${step.incidentId}:${kind}:${event.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const timestamp = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
      // Suppress initial snapshots and history fetched asynchronously after mount.
      if (!state.initialized || reduced !== false || !Number.isFinite(timestamp) || timestamp <= state.mountedAt) continue;
      const reply = kind === 'response';
      const sourceName = reply ? step.targetTwin : step.sourceTwin;
      const targetName = reply ? step.sourceTwin : step.targetTwin;
      if (!Object.hasOwn(meshPositions, sourceName) || !Object.hasOwn(meshPositions, targetName)) continue;
      const [sx, sy] = meshPositions[sourceName as TwinDomain];
      const [tx, ty] = meshPositions[targetName as TwinDomain];
      arrivals.push({ id, reply, path: `M ${sx} ${sy} Q ${50 + (sx - 50) * .25} ${sy} 50 50 Q ${50 + (tx - 50) * .25} ${ty} ${tx} ${ty}` });
    }
  }
  return { state: { ...state, initialized: true, seen }, arrivals };
}
