import { useEffect, useState } from 'react';
import type { ServiceNowIncident, WorkflowInstance } from '../types';
import type { EventCollection } from '../components/dashboard/model';
import { normalizeDashboardEvents, selectFocusIncident } from '../components/dashboard/projection';

/** Reconciles on the existing /api/state refresh. No additional polling or SSE connection. */
export function useDashboardEvents(incidents: ServiceNowIncident[], workflows: WorkflowInstance[], inspectedId: string | undefined, enabled: boolean, viewerKey: string) {
  const [snapshot, setSnapshot] = useState<{ viewer: string; entries: Record<string, EventCollection> }>({ viewer: '', entries: {} });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const visibleIds = new Set(incidents.map(item => item.id));
    const focus = selectFocusIncident({ incidents, workflows });
    const ids = [...new Set([focus?.id, inspectedId, ...workflows.filter(item => ['ACTIVE', 'PAUSED'].includes(item.status) && visibleIds.has(item.incidentId)).slice(0, 6).map(item => item.incidentId)].filter((id): id is string => Boolean(id && visibleIds.has(id))))];
    setSnapshot(previous => ({ viewer: viewerKey, entries: Object.fromEntries(ids.map(id => [id, previous.viewer === viewerKey && previous.entries[id] ? previous.entries[id] : { status: 'loading', events: [] }])) }));
    const timer = window.setTimeout(async () => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < ids.length && !controller.signal.aborted) {
          const id = ids[cursor++];
          let result: EventCollection;
          try {
            const response = await fetch(`/api/incidents/${encodeURIComponent(id)}/events`, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data.events)) throw new Error('Event collection unavailable');
            result = { status: 'ready', events: normalizeDashboardEvents(data.events, id) };
          } catch {
            if (controller.signal.aborted) return;
            // Fail closed: an unavailable record is not a verified empty result.
            const prior = snapshot.viewer === viewerKey ? snapshot.entries[id] : undefined;
            result = { status: 'error', events: prior?.events || [] };
          }
          if (!controller.signal.aborted) setSnapshot(previous => previous.viewer === viewerKey ? { ...previous, entries: { ...previous.entries, [id]: result } } : previous);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [incidents, workflows, inspectedId, enabled, viewerKey]);
  return snapshot.viewer === viewerKey ? snapshot.entries : {};
}
