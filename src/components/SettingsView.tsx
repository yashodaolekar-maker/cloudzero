import React, { useState } from "react";
import { BackupItem, SSOUser, UserRole } from "../types";
import { 
  Database, 
  Lock, 
  ShieldCheck, 
  UserPlus, 
  RefreshCw, 
  Server, 
  HardDriveDownload, 
  Trash2,
  FileCheck,
  Cpu,
  Fingerprint
} from "lucide-react";

interface SettingsViewProps {
  currentUser: SSOUser;
  backups: BackupItem[];
  onCreateBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  backupLoading: boolean;
  restoreLoading: boolean;
}

export default function SettingsView({
  currentUser,
  backups,
  onCreateBackup,
  onRestoreBackup,
  backupLoading,
  restoreLoading
}: SettingsViewProps) {
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(
    backups.length > 0 ? backups[0].id : null
  );

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isOperatorOrAdmin = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.DEVOPS || currentUser.role === UserRole.NRE;

  const handleRestore = () => {
    if (!selectedBackupId) return;
    onRestoreBackup(selectedBackupId);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50 dark:bg-[#050505] text-slate-800 dark:text-[#e0e0e0] transition-colors duration-200 h-screen">
      
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-tight">
          <Database className="w-5 h-5 text-blue-500" /> Database Backup & RBAC Panel
        </h2>
        <p className="text-xs text-slate-500 dark:text-[#888] mt-1">
          Perform state recovery actions, inspect corporate encryption standards, and configure Role-Based Access Control (RBAC) security permissions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Side: Backup & Decryption Recovery */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-6">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#222] pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Encrypted Database Backups</h3>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">SHA-256 integrity checksum backups stored in secure HSM volumes.</p>
              </div>
              
              <button
                disabled={backupLoading || !isOperatorOrAdmin}
                onClick={onCreateBackup}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow uppercase tracking-wider"
              >
                {backupLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Encrypting...
                  </>
                ) : (
                  <>
                    <Server className="w-3.5 h-3.5" /> Backup Now
                  </>
                )}
              </button>
            </div>

            {/* Backups List */}
            <div className="space-y-3.5">
              {backups.map((bk) => {
                const isSelected = selectedBackupId === bk.id;
                return (
                  <button
                    key={bk.id}
                    onClick={() => setSelectedBackupId(bk.id)}
                    className={`w-full text-left p-4 rounded border transition-all cursor-pointer block ${
                      isSelected
                        ? "border-blue-600 dark:border-blue-500 bg-blue-50/20 dark:bg-blue-600/10 ring-1 ring-blue-500"
                        : "border-slate-100 dark:border-[#222] hover:bg-slate-50 dark:hover:bg-[#111]"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-block text-[8px] font-extrabold px-1.5 py-0.2 rounded uppercase ${
                            bk.backupType === "AUTOMATED" 
                              ? "bg-slate-150 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400" 
                              : "bg-blue-50 text-blue-600 dark:bg-blue-600/10 dark:text-blue-400"
                          }`}>
                            {bk.backupType}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold">{bk.size}</span>
                        </div>
                        <h4 className="font-mono text-xs font-bold text-slate-800 dark:text-zinc-200 truncate uppercase tracking-wider">{bk.name}</h4>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium mt-1">Created: {new Date(bk.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded uppercase border border-emerald-100 dark:border-emerald-900/30 shrink-0">
                        {bk.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-3.5 pt-3 border-t border-slate-100 dark:border-[#222] text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                      <Fingerprint className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate">Checksum: {bk.checksum}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Restore Action */}
            <div className="bg-slate-50 dark:bg-[#111] p-4 rounded border border-slate-100 dark:border-[#222] flex items-center justify-between gap-4">
              <div className="max-w-md">
                <span className="text-[9px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-widest block mb-0.5">Database Restoration</span>
                <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-medium">
                  Trigger secure state recovery of orchestrator workflows. This action requires absolute <strong>Administrator</strong> clearance tokens.
                </p>
              </div>

              <button
                disabled={restoreLoading || !selectedBackupId || !isAdmin}
                onClick={handleRestore}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-[#111] dark:disabled:text-zinc-600 text-white text-xs font-bold rounded transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow shadow-blue-500/10 uppercase tracking-wider"
              >
                {restoreLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Restoring...
                  </>
                ) : (
                  <>
                    <HardDriveDownload className="w-3.5 h-3.5" /> Restore State
                  </>
                )}
              </button>
            </div>

            {!isAdmin && (
              <div className="p-3 bg-rose-50/60 dark:bg-rose-950/20 rounded-lg border border-rose-100/60 dark:border-rose-900/20 text-[11px] text-rose-700 dark:text-rose-400 flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong>RBAC Restrained</strong>: Your current SAML SSO role context is <strong>{currentUser.role}</strong>. State recovery is locked exclusively for enterprise security Administrators.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Corporate Security Standards & RBAC Specs */}
        <div className="lg:col-span-5 space-y-6">
          
          <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-5">
            <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Role-Based Access Control Schema</h3>
            
            <div className="space-y-4">
              <div className="flex gap-3 items-start p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] text-xs">
                <div className="w-6 h-6 rounded bg-blue-100 dark:bg-blue-600/10 dark:text-blue-400 border border-transparent dark:border-blue-600/20 flex items-center justify-center font-bold shrink-0">AD</div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">Administrator</h4>
                  <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-normal mt-0.5">Complete capability control. Execute high priority twin rollbacks, approve or deny HITL, backup database structures, restore backups, configure integrations.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] text-xs">
                <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 border border-transparent dark:border-emerald-500/20 flex items-center justify-center font-bold shrink-0">DO</div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">DevOps Platform Engineer</h4>
                  <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-normal mt-0.5">Automated release gating. Execute Kubernetes canary releases, deploy CI/CD triggers, approve system promotion requests, perform config backups.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] text-xs">
                <div className="w-6 h-6 rounded bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 border border-transparent dark:border-amber-500/20 flex items-center justify-center font-bold shrink-0">NR</div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">Network Reliability Engineer (NRE)</h4>
                  <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-normal mt-0.5">Network automation & failovers. Deploy BGP routing prepends, manage DNS failover policies, approve core switches routing changes, trigger backups.</p>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] text-xs">
                <div className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400 border border-transparent dark:border-purple-500/20 flex items-center justify-center font-bold shrink-0">SA</div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">Security Auditor</h4>
                  <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-normal mt-0.5">Compliance inspection. Read complete cryptographic syslog streams, audit SHA signatures, export CSV security reports.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-blue-500" /> Data Security Compliance
            </h3>
            
            <div className="space-y-3 text-xs leading-relaxed font-medium">
              <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222]">
                <h4 className="font-bold text-slate-800 dark:text-zinc-200 text-xs flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Encryption At Rest
                </h4>
                <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-relaxed">
                  All orchestrator configurations, digital twin parameters, and local states are strictly encrypted using hardware-backed <strong>AES-256-GCM</strong> cipher containers with periodic key rotations.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222]">
                <h4 className="font-bold text-slate-800 dark:text-zinc-200 text-xs flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Encryption In Transit
                </h4>
                <p className="text-[10.5px] text-slate-400 dark:text-zinc-500 leading-relaxed">
                  All ingress webhooks, API requests, and SAML SSO assertions utilize corporate standard <strong>TLS 1.3</strong> security handshakes. Third-party APIs are bound to cryptographically sealed JWT authorization tokens.
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
