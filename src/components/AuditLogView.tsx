import React, { useState } from "react";
import { SystemLog } from "../types";
import { 
  Users, 
  Search, 
  ShieldAlert, 
  ShieldCheck, 
  Info, 
  Database, 
  Download,
  Fingerprint
} from "lucide-react";

interface AuditLogViewProps {
  systemLogs: SystemLog[];
}

export default function AuditLogView({ systemLogs }: AuditLogViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");

  const filteredLogs = systemLogs.filter((log) => {
    const matchesSearch = 
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.source.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === "ALL" || log.level === levelFilter;
    return matchesSearch && matchesLevel;
  });

  const getLevelStyles = (level: string) => {
    switch (level) {
      case "SECURITY":
        return {
          badge: "bg-blue-50 text-blue-700 dark:bg-blue-600/10 dark:text-blue-400 border border-transparent dark:border-blue-600/20",
          icon: <ShieldAlert className="w-4 h-4 text-blue-500" />
        };
      case "WARNING":
        return {
          badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30",
          icon: <ShieldAlert className="w-4 h-4 text-amber-500" />
        };
      case "ERROR":
        return {
          badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30",
          icon: <ShieldAlert className="w-4 h-4 text-rose-500" />
        };
      default:
        return {
          badge: "bg-slate-50 text-slate-700 dark:bg-zinc-800/60 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700",
          icon: <Info className="w-4 h-4 text-slate-400 dark:text-zinc-500" />
        };
    }
  };

  const handleExportCSV = () => {
    const headers = "ID,Timestamp,Level,Source,Message,CryptographicHash\n";
    const rows = filteredLogs.map(l => 
      `"${l.id}","${l.timestamp}","${l.level}","${l.source}","${l.message.replace(/"/g, '""')}","${l.checksum}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CloudZero_AuditLogs_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50 dark:bg-[#050505] text-slate-800 dark:text-[#e0e0e0] transition-colors duration-200 h-screen">
      
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-tight">
            <Users className="w-5 h-5 text-blue-500" /> Security Audit Log & Compliance Ledger
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#888] mt-1">
            Complete cryptographic audit log stream tracking all user SSO logins, digital twin modifications, manual backup restorations, and HITL gatekeeper clearances.
          </p>
        </div>
        
        <button
          onClick={handleExportCSV}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow shadow-blue-500/10 uppercase tracking-wider"
        >
          <Download className="w-3.5 h-3.5" /> Export Compliance CSV
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-[#0d0d0d] p-4 rounded border border-slate-200 dark:border-[#222] shadow-sm flex flex-col sm:flex-row gap-3 mb-6">
        
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-400 dark:text-zinc-500" />
          <input
            type="text"
            placeholder="Search audit messages, actions, or service providers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded py-2 pl-10 pr-4 text-xs text-slate-700 dark:text-zinc-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 select-text shadow-inner"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider shrink-0">Filter Severity:</label>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded py-2 px-3 text-xs font-semibold text-slate-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm"
          >
            <option value="ALL">All Levels</option>
            <option value="SECURITY">Security Assertion</option>
            <option value="WARNING">Warning Logs</option>
            <option value="ERROR">Error Failures</option>
            <option value="INFO">Info Logs</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 dark:bg-[#0a0a0a] border-b border-slate-200 dark:border-[#222] text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-3.5 px-6">Timestamp / Event ID</th>
                <th className="py-3.5 px-6">Severity</th>
                <th className="py-3.5 px-6">Source Node</th>
                <th className="py-3.5 px-6">Log Message Detail</th>
                <th className="py-3.5 px-6">Cryptographic Ledger Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#222] text-xs text-slate-700 dark:text-zinc-300 font-mono">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 dark:text-zinc-500 font-sans">
                    No compliant audit logs found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const styles = getLevelStyles(log.level);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/40 dark:hover:bg-[#111]/40 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-slate-900 dark:text-zinc-100 text-[11px]">
                          {new Date(log.timestamp).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium font-sans mt-0.5">
                          ID: {log.id}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${styles.badge}`}>
                          {styles.icon}
                          {log.level}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-[11px] font-semibold text-cyan-500">
                        {log.source}
                      </td>
                      <td className="py-4 px-6 font-sans leading-relaxed text-[11.5px] max-w-sm select-text">
                        {log.message}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 text-[11px]">
                          <Fingerprint className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{log.checksum}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
