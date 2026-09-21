import { useState } from "react";
import { Code2, Database, Plug, Settings, ShieldCheck, Users } from "lucide-react";
import type { BackupItem, SSOUser } from "../types";
import AgentConfigView from "./AgentConfigView";
import ApiPlaygroundView from "./ApiPlaygroundView";
import SettingsView from "./SettingsView";

interface SettingsHubViewProps {
  currentUser: SSOUser;
  backups: BackupItem[];
  onCreateBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  backupLoading: boolean;
  restoreLoading: boolean;
}

type SettingsSection = "home" | "integrations" | "agents" | "users" | "backup" | "developer";

export default function SettingsHubView(props: SettingsHubViewProps) {
  const [section, setSection] = useState<SettingsSection>("home");
  const cards: Array<{ id: SettingsSection; label: string; description: string; icon: typeof Plug }> = [
    { id: "integrations", label: "Integrations", description: "ServiceNow, Azure, telemetry, voice, and external connections.", icon: Plug },
    { id: "agents", label: "Agents", description: "Configure digital twins and external agent connections.", icon: Settings },
    { id: "users", label: "Users & RBAC", description: "Review access context and identity-related controls.", icon: Users },
    { id: "backup", label: "Backup & recovery", description: "Create and restore protected application state.", icon: Database },
    { id: "developer", label: "Developer tools", description: "Inspect and exercise supported integration APIs.", icon: Code2 }
  ];
  if (section === "agents" || section === "integrations") return <section className="min-h-full bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1400px]"><button type="button" onClick={() => setSection("home")} className="mb-4 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">← Settings</button><AgentConfigView currentUser={props.currentUser} /></div></section>;
  if (section === "developer") return <section className="min-h-full bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1400px]"><button type="button" onClick={() => setSection("home")} className="mb-4 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">← Settings</button><ApiPlaygroundView /></div></section>;
  if (section === "backup") return <section className="min-h-full bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1400px]"><button type="button" onClick={() => setSection("home")} className="mb-4 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">← Settings</button><SettingsView {...props} /></div></section>;
  return <section className="min-h-full bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1200px]"><div className="mb-8"><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">System configuration</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Settings</h1><p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Manage CloudZero connections, agents, access, recovery, and developer tools.</p></div>{section === "users" && <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"><ShieldCheck className="mr-2 inline h-4 w-4" />Authenticated identity and RBAC controls remain enforced by the existing security layer.</div>}<div className="grid gap-4 sm:grid-cols-2">{cards.map(card => { const Icon = card.icon; return <button key={card.id} type="button" onClick={() => setSection(card.id)} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900"><Icon className="h-5 w-5 text-blue-600 dark:text-blue-300" /><h2 className="mt-4 font-bold text-slate-950 dark:text-white">{card.label}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{card.description}</p></button>; })}</div></div></section>;
}
