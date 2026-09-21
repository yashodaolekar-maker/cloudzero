import { useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import type { DigitalTwinAgent, HITLApproval, IncidentAggregate, OperatingMode, ServiceNowIncident, SSOUser, SystemLog, TelemetrySnapshot, WorkflowInstance } from '../types';
import type { EventCollection } from './dashboard/model';
import { buildDashboardModel } from './dashboard/projection';
import { DashboardHeader, OperationalStatusRail, ActiveExecutions, LiveOperations, AvailableTwinRoster } from './dashboard/Operations';
import { CommandCenter } from './dashboard/CommandCenter';
import { ExecutionDrawer, type DrawerTab } from './dashboard/ExecutionDrawer';
import './dashboard/dashboard.css';

interface DashboardViewProps {
  currentUser: SSOUser; agents: DigitalTwinAgent[]; workflows: WorkflowInstance[];
  approvals: HITLApproval[]; systemLogs: SystemLog[]; incidents: ServiceNowIncident[];
  onTriggerWorkflow: (agentId: string, name: string) => void; workflowTriggering: boolean;
  setActiveTab: (tab: string) => void; operatingMode?: OperatingMode;
  telemetrySnapshot: TelemetrySnapshot | null; telemetryLoading: boolean;
  telemetryRefreshing: boolean; telemetryError: string | null; onRefreshTelemetry: () => void;
  aggregates?: IncidentAggregate[]; eventsByIncident?: Record<string, EventCollection>;
  onOpenIncident?: (id: string) => void; onOpenTwin?: (domain: string) => void;
  onInspectIncident?: (id: string) => void;
}
const EMPTY_EVENTS: Record<string, EventCollection> = {};
export default function DashboardView(p: DashboardViewProps) {
  const model = useMemo(() => buildDashboardModel({ agents: p.agents, workflows: p.workflows,
    incidents: p.incidents, approvals: p.approvals, systemLogs: p.systemLogs,
    aggregates: p.aggregates, eventsByIncident: p.eventsByIncident ?? EMPTY_EVENTS }),
  [p.agents, p.workflows, p.incidents, p.approvals, p.systemLogs, p.aggregates, p.eventsByIncident]);
  const [selection, setSelection] = useState<{ id: string; tab: DrawerTab } | null>(null);
  const selected = model.executions.find(x => x.id === selection?.id);
  const openExecution = (id: string, tab: DrawerTab = 'Execution') => {
    const execution = model.executions.find(x => x.id === id);
    const incidentId = execution?.incident?.id ?? execution?.workflow?.incidentId;
    if (incidentId) p.onInspectIncident?.(incidentId);
    setSelection({ id, tab });
  };
  const openIncident = (id: string) => p.onOpenIncident ? p.onOpenIncident(id) : p.setActiveTab('servicenow');
  const openTwin = (domain: string) => p.onOpenTwin?.(domain);
  return <MotionConfig reducedMotion="user"><section className="cz-dashboard" aria-label="Digital Twin Operations">
    <div className="cz-dashboard-content">
      <DashboardHeader name={p.currentUser.name} mode={p.operatingMode} />
      <OperationalStatusRail model={model} onApprovals={() => p.setActiveTab('approvals')} />
      {p.telemetryLoading && <p className="cz-notice" role="status">Connecting to operational telemetry…</p>}
      {p.telemetryError && <div className="cz-notice cz-notice-warning" role="status">Telemetry unavailable. Displaying available runtime records. <button onClick={p.onRefreshTelemetry} disabled={p.telemetryRefreshing}>Retry telemetry</button></div>}
      <CommandCenter model={model} onExecution={openExecution} onIncident={openIncident} onTwin={openTwin} onApprovals={() => p.setActiveTab('approvals')} />
      <div className="cz-operations-grid"><ActiveExecutions executions={model.executions} onOpen={openExecution} /><LiveOperations operations={model.operations} onActivity={() => p.setActiveTab('activity')} /></div>
      <AvailableTwinRoster twins={model.twins} onOpen={openTwin} />
    </div>
    {selected && selection && <ExecutionDrawer key={selected.id} execution={selected} initialTab={selection.tab} onClose={() => setSelection(null)} onIncident={openIncident} />}
  </section></MotionConfig>;
}
