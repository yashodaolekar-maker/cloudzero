import { useState } from "react";
import { Activity, FileText, Search, ShieldCheck } from "lucide-react";
import type { ChangeRecord, HITLApproval, SSOUser, SystemLog } from "../types";
import ApprovalsView from "./ApprovalsView";
import AuditLogView from "./AuditLogView";

interface ActivityViewProps {
  currentUser: SSOUser;
  approvals: HITLApproval[];
  systemLogs: SystemLog[];
  changeRecords: ChangeRecord[];
  onApproveAction: (approvalId: string, status: "APPROVED" | "DENIED", comment: string) => void;
  approving: boolean;
  fetchState: () => void;
}

type ActivitySection = "activity" | "approvals" | "audit";

export default function ActivityView({ currentUser, approvals, systemLogs, changeRecords, onApproveAction, approving, fetchState }: ActivityViewProps) {
  const [section, setSection] = useState<ActivitySection>("activity");
  const [query, setQuery] = useState("");
  const pendingCount = approvals.filter(approval => approval.status === "PENDING").length;
  const tabs: Array<{ id: ActivitySection; label: string; icon: typeof Activity; badge?: number }> = [
    { id: "activity", label: "Activity", icon: Activity },
    { id: "approvals", label: "Approvals", icon: ShieldCheck, badge: pendingCount },
    { id: "audit", label: "Audit trail", icon: FileText }
  ];

  return (
    <section className="min-h-full bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">Operations history</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Activity</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Review agent work, approvals, and the evidence trail without leaving the operator workspace.</p>
        </div>
        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(tab => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setSection(tab.id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold ${section === tab.id ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}><Icon className="h-4 w-4" />{tab.label}{tab.badge ? <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] text-white">{tab.badge}</span> : null}</button>; })}
        </div>
        {section === "activity" && <section className="cz-activity-history" aria-label="Operational history">
          <header><div><p className="cz-section-kicker">Evidence-backed event stream</p><h2>Operational history</h2></div><label><Search className="h-4 w-4" /><span className="sr-only">Filter activity</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter Twin, incident or result" /></label></header>
          <div className="cz-history-summary"><span><strong>{systemLogs.length}</strong> recorded events</span><button type="button" onClick={() => setSection("approvals")}><strong>{pendingCount}</strong> awaiting approval</button><span><strong>{changeRecords.length}</strong> controlled changes</span></div>
          {systemLogs.filter(log => `${log.source} ${log.message} ${log.level}`.toLowerCase().includes(query.toLowerCase())).length ? <ol className="cz-history-list">{systemLogs.filter(log => `${log.source} ${log.message} ${log.level}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40).map(log => <li key={log.id}><time dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span className={`cz-history-level is-${log.level.toLowerCase()}`}>{log.level}</span><div><h3>{log.source}</h3><p>{log.message}</p></div><code>{log.id}</code></li>)}</ol> : <div className="cz-history-empty"><Activity className="h-6 w-6" /><h3>No matching operational activity</h3><p>Try a broader filter. New backend-recorded events will appear here.</p></div>}
        </section>}
        {section === "approvals" && <ApprovalsView currentUser={currentUser} approvals={approvals} onApproveAction={onApproveAction} approving={approving} changeRecords={changeRecords} fetchState={fetchState} />}
        {section === "audit" && <AuditLogView systemLogs={systemLogs} />}
      </div>
    </section>
  );
}
