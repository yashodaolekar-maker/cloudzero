import React, { useState } from "react";
import { HITLApproval, SSOUser, UserRole, ChangeRecord } from "../types";
import { 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  User, 
  MessageSquare,
  AlertOctagon,
  Lock,
  ChevronRight,
  Video,
  Phone,
  Send,
  Users,
  ExternalLink,
  Volume2,
  Wifi,
  Terminal,
  RefreshCw,
  Activity
} from "lucide-react";
import { motion } from "motion/react";

interface ApprovalsViewProps {
  currentUser: SSOUser;
  approvals: HITLApproval[];
  onApproveAction: (approvalId: string, status: "APPROVED" | "DENIED", comment: string) => void;
  approving: boolean;
  changeRecords: ChangeRecord[];
  fetchState: () => void;
}

const getApprovalIncidentId = (approval?: HITLApproval): string => {
  const normalizedIncidentId = approval?.incidentId?.trim();
  if (normalizedIncidentId) return normalizedIncidentId;

  const legacyIncidentId: unknown = approval?.payload?.incidentId;
  return typeof legacyIncidentId === "string" ? legacyIncidentId.trim() : "";
};

export default function ApprovalsView({
  currentUser,
  approvals,
  onApproveAction,
  approving,
  changeRecords,
  fetchState
}: ApprovalsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    approvals.length > 0 ? approvals[0].id : null
  );
  const selectedApproval = approvals.find((a) => a.id === selectedId) || approvals[0];
  const selectedIncidentId = getApprovalIncidentId(selectedApproval);
  const relatedChangeRecords = React.useMemo(() => {
    if (!selectedIncidentId) return [];
    const explicitChangeId = typeof selectedApproval?.payload?.changeRecordId === "string" ? selectedApproval.payload.changeRecordId : "";
    const unique = new Map<string, ChangeRecord>();
    for (const record of changeRecords) {
      if (record.incidentId === selectedIncidentId || (explicitChangeId && record.id === explicitChangeId)) unique.set(record.id, record);
    }
    return [...unique.values()].sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));
  }, [changeRecords, selectedApproval, selectedIncidentId]);
  const [comment, setComment] = useState("");

  // Teams Crisis Call Bridge Simulator States
  const [teamsJoinState, setTeamsJoinState] = useState<"NOT_JOINED" | "JOINING" | "JOINED">("NOT_JOINED");
  const [teamsUrl, setTeamsUrl] = useState("");
  const [teamsMessages, setTeamsMessages] = useState<{ sender: string; avatar: string; role: string; content: string; time: string }[]>([]);
  const [userMsgInput, setUserMsgInput] = useState("");
  const [isTwinTyping, setIsTwinTyping] = useState(false);
  const [connectingStep, setConnectingStep] = useState("");
  const [voiceSynthesizerEnabled, setVoiceSynthesizerEnabled] = useState(true);
  const [restoredTeamsApprovalId, setRestoredTeamsApprovalId] = useState<string | null>(null);

  // Browser-native speech synthesizer voice speaker
  const speakMessage = (text: string) => {
    if (!("speechSynthesis" in window)) return;

    // Cancel any ongoing speaking to avoid overlap queue delays
    window.speechSynthesis.cancel();

    // Clean text of markdown characters before reading aloud
    const cleanText = text
      .replace(/\*\*|📢|🛠️|✅|⚡|🛡️|⚙️/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Dynamic selection of professional SRE voices
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.lang.startsWith("en") && 
      (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("David") || v.name.includes("Zira"))
    ) || voices.find(v => v.lang.startsWith("en")) || voices[0];

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 0.98;
    utterance.pitch = 0.96;
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
  };

  // Load call state from the PostgreSQL-backed server projection.
  React.useEffect(() => {
    let cancelled = false;
    setUserMsgInput("");
    setIsTwinTyping(false);

    if (!selectedApproval || selectedApproval.system !== "Teams") {
      setTeamsJoinState("NOT_JOINED");
      setTeamsUrl("");
      setTeamsMessages([]);
      setConnectingStep("");
      return;
    }

    const url = selectedApproval.payload?.teamsUrl || "";
    setTeamsUrl(url);
    if (restoredTeamsApprovalId !== selectedApproval.id) {
      void fetch(`/api/approvals/${encodeURIComponent(selectedApproval.id)}/teams-state`).then(response => response.json().then(data => ({ response, data }))).then(({ response, data }) => {
        if (cancelled) return;
        let restored = response.ok ? data.state : null;
        const legacyKey = `teams_state_${selectedApproval.id}`;
        if (!restored) {
          const legacy = localStorage.getItem(legacyKey);
          if (legacy) {
            try {
              restored = JSON.parse(legacy);
              void fetch(`/api/approvals/${encodeURIComponent(selectedApproval.id)}/teams-state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(restored) });
            } catch { restored = null; }
          }
        }
        localStorage.removeItem(legacyKey);
        if (restored) {
          setTeamsJoinState(restored.joinState || "NOT_JOINED");
          setTeamsMessages(Array.isArray(restored.messages) ? restored.messages : []);
          setConnectingStep(restored.connectingStep || "");
        }
        setRestoredTeamsApprovalId(selectedApproval.id);
      }).catch(error => { if (!cancelled) { console.error("Failed to restore PostgreSQL Teams state:", error); setRestoredTeamsApprovalId(selectedApproval.id); } });
      return () => { cancelled = true; };
    }

    // Approval grants permission; it never initiates or replays a bridge join.
    // Only handleJoinCall, reached through the explicit operator button, may join.
  }, [selectedId, selectedApproval?.status, restoredTeamsApprovalId]);

  // Save state to PostgreSQL; browser storage is not an operational datastore.
  React.useEffect(() => {
    if (!selectedApproval || selectedApproval.system !== "Teams" || restoredTeamsApprovalId !== selectedApproval.id) return;
    const controller = new AbortController();
    const stateToSave = {
      joinState: teamsJoinState,
      url: teamsUrl,
      messages: teamsMessages,
      connectingStep: connectingStep
    };
    
    const timer = setTimeout(() => {
      void fetch(`/api/approvals/${encodeURIComponent(selectedApproval.id)}/teams-state`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stateToSave), signal: controller.signal
      }).catch(error => { if (error?.name !== "AbortError") console.error("Failed to persist Teams state:", error); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedId, teamsJoinState, teamsUrl, teamsMessages, connectingStep, selectedApproval, restoredTeamsApprovalId]);

  // Monitor other approvals for proactive SRE Twin updates in the chat
  React.useEffect(() => {
    if (teamsJoinState !== "JOINED" || !selectedApproval) return;

    // Find the BGP route adjustment approval
    const bgpApp = approvals.find(a => a.id === "hitl-nre-001");
    if (!bgpApp || bgpApp.status !== "APPROVED") return;

    // Wait until the initial 4 briefing messages are fully loaded in the chat stream to prevent scrambling
    if (teamsMessages.length < 4) return;

    // Check if we have already posted the "Under Monitoring" update
    const hasMonitoringMsg = teamsMessages.some(m => 
      m.role === "twin" && m.content.includes("Under Monitoring")
    );

    if (!hasMonitoringMsg) {
      // Post the "Under Monitoring" update immediately
      const monitoringMsg = {
        sender: "Sync-Teams-Twin",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
        role: "twin",
        content: `The routing change is approved and has been applied on spine-switch-02. Traffic is moving from ISP-Alpha toward ISP-Beta now. I'm watching convergence and customer error rates; I'll keep this bridge updated as the paths settle.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      setTeamsMessages(prev => {
        if (prev.some(m => m.role === "twin" && m.content.includes("Under Monitoring"))) {
          return prev;
        }
        return [...prev, monitoringMsg];
      });

      // Schedule the "Resolved" update 8 seconds later
      const timer = setTimeout(() => {
        setTeamsMessages(prev => {
          if (prev.some(m => m.role === "twin" && m.content.includes("fully **Resolved**"))) {
            return prev;
          }
          const resolvedMsg = {
            sender: "Sync-Teams-Twin",
            avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
            role: "twin",
            content: `The routes have converged on ISP-Beta. Packet loss is back to 0.0%, ingress latency is 8 ms, and the 504s have cleared. Customer traffic is healthy again; I'm keeping the incident in monitoring until we complete the observation window, then we'll close it out.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          return [...prev, resolvedMsg];
        });
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [approvals, teamsJoinState, selectedApproval, teamsMessages.length]);

  const handleJoinCall = (overrideUrl?: string) => {
    if (!selectedApproval || selectedApproval.system !== "Teams" || selectedApproval.status !== "APPROVED") return;
    const activeUrl = overrideUrl || teamsUrl.trim() || (selectedApproval?.system === "Teams" ? selectedApproval.payload.teamsUrl : "") || "";
    if (!activeUrl) return;
    setTeamsJoinState("JOINING");
    setConnectingStep("Initializing Exchange VoIP Handshake...");
    
    setTimeout(() => {
      setConnectingStep("Securing outreach proxy tunnel...");
    }, 800);

    setTimeout(() => {
      setConnectingStep(`Syncing incident summary ${selectedIncidentId || "for this approval"}...`);
    }, 1600);

    setTimeout(() => {
      setTeamsJoinState("JOINED");
      // Add first message immediately
      const initialMsgs = [
        {
          sender: "Sync-Teams-Twin",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
          role: "twin",
          content: `Hi everyone, I'm on the bridge now. I'm pulling the latest ServiceNow notes and network telemetry, then I'll give you the customer impact, what we're doing about it, and what I need from the bridge.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ];
      setTeamsMessages(initialMsgs);
      if (voiceSynthesizerEnabled) {
        speakMessage("Hi everyone, I'm on the bridge now. I'm pulling the latest ServiceNow notes and network telemetry, then I'll give you the customer impact, what we're doing about it, and what I need from the bridge.");
      }

      // SRE assessment message 1 second later
      setTimeout(() => {
        setTeamsMessages(prev => [
          ...prev,
          {
            sender: "Sync-Teams-Twin",
            avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
            role: "twin",
            content: `The current read is a P1 on the production ingress path. ISP-Alpha is showing 2.1% packet loss, which is driving BGP flaps on spine-switch-02; we're seeing intermittent 504s on about 14.2% of incoming transactions. I'm validating the affected services before we change routing, so we don't trade a lossy path for a wider connection reset.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }, 1000);

      // Required fix message 2.2 seconds later
      setTimeout(() => {
        setTeamsMessages(prev => [
          ...prev,
          {
            sender: "Sync-Teams-Twin",
            avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
            role: "twin",
            content: `My proposed mitigation is to prepend our AS path three times on spine-switch-02 and move ingress toward ISP-Beta. That should let existing sessions drain while new traffic converges, but I haven't applied it: the change is waiting on the HITL approval. Once approved, I'll watch route convergence, packet loss, and 504s before I call the incident stable.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }, 2200);

      // Head of Infra Audrey Chen asks first question 4.0 seconds later
      setTimeout(() => {
        setTeamsMessages(prev => [
          ...prev,
          {
            sender: "Audrey Chen (Head of Infrastructure)",
            avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=80",
            role: "executive",
            content: `Thanks. Can you check ServiceNow and confirm which customer-facing services are actually degraded? I want the impact list before we make the routing change.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }, 4000);

    }, 2400);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userMsgInput.trim() || isTwinTyping) return;

    if (!selectedApproval || selectedApproval.system !== "Teams" || teamsJoinState !== "JOINED") {
      return;
    }

    const incidentId = getApprovalIncidentId(selectedApproval);
    if (!incidentId) {
      setTeamsMessages(prev => [
        ...prev,
        {
          sender: "Sync-Teams-Twin",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
          role: "twin",
          content: "This Teams approval is not bound to an incident. Select an incident-linked approval before requesting an incident answer.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
      return;
    }

    const userText = userMsgInput;
    setUserMsgInput("");

    // Append user message
    const updatedMsgs = [
      ...teamsMessages,
      {
        sender: "You (Incident Commander)",
        avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80",
        role: "user",
        content: userText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
    setTeamsMessages(updatedMsgs);
    setIsTwinTyping(true);

    try {
      const response = await fetch("/api/teams-call/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId,
          messageHistory: updatedMsgs.map(m => ({ role: m.role, content: m.content })),
          userQuestion: userText
        })
      });

      if (response.ok) {
        const data = await response.json();
        setTeamsMessages(prev => [
          ...prev,
          {
            sender: "Sync-Teams-Twin",
            avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
            role: "twin",
            content: data.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        if (voiceSynthesizerEnabled) {
          speakMessage(data.text);
        }
        fetchState();
      } else {
        throw new Error("Failed to get twin response");
      }
    } catch (err) {
      console.error(err);
      // Do not substitute fabricated incident details when grounding fails.
      setTeamsMessages(prev => [
        ...prev,
        {
          sender: "Sync-Teams-Twin",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80",
          role: "twin",
          content: `A grounded response for incident ${incidentId} could not be retrieved. No incident claims or remediation recommendation were generated.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsTwinTyping(false);
    }
  };

  // Keep selectedId in sync with the first pending approval or the top approval when list updates
  React.useEffect(() => {
    if (approvals.length > 0) {
      const currentExists = approvals.some((a) => a.id === selectedId);

      // If nothing is selected, or current selection no longer exists
      if (!selectedId || !currentExists) {
        const firstPending = approvals.find((a) => a.status === "PENDING");
        setSelectedId(firstPending ? firstPending.id : approvals[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [approvals]);

  const handleAction = (status: "APPROVED" | "DENIED") => {
    if (!selectedApproval) return;
    onApproveAction(selectedApproval.id, status, comment);
    setComment("");
  };

  const getSystemColor = (sys: string) => {
    switch (sys) {
      case "ServiceNow": return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20";
      case "Teams": return "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20";
      case "AWS": return "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20";
      case "Kubernetes": return "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20";
      case "AristaSwitches": return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20";
      case "GitHubActions": return "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20";
      case "Cloudflare": return "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20";
      case "CiscoWireless": return "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20";
      case "CiscoSwitches": return "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400 border border-teal-200 dark:border-teal-500/20";
      case "ACIFabric": return "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20";
      case "CiscoRouters": return "bg-pink-50 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400 border border-pink-200 dark:border-pink-500/20";
      case "CiscoFirewalls": return "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20";
      case "PaloAltoFirewalls": return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20";
      case "CiscoISE": return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20";
      default: return "bg-slate-50 text-slate-700 dark:bg-zinc-800/60 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700";
    }
  };

  const isCallActive = (app: HITLApproval) => {
    if (app.system !== "Teams") return false;
    let isJoined = false;
    if (selectedId === app.id && teamsJoinState === "JOINED") {
      isJoined = true;
    } else {
      try {
        const saved = localStorage.getItem(`teams_state_${app.id}`);
        if (saved) {
          isJoined = JSON.parse(saved).joinState === "JOINED";
        }
      } catch (e) {}
    }
    return app.status === "APPROVED" || isJoined;
  };

  const calculateSentimentScore = (messages: { sender: string; avatar: string; role: string; content: string; time: string }[]) => {
    if (messages.length === 0) return 50; // Neutral baseline
    
    let score = 50; // Start at neutral 50
    
    messages.forEach(msg => {
      const text = msg.content.toLowerCase();
      
      const positiveWords = ["resolved", "fix", "mitigated", "deployed", "remedy", "thank", "agree", "perfect", "good", "restored", "successful", "completed", "prepending", "divert"];
      const negativeWords = ["outage", "loss", "flap", "degraded", "timeout", "crisis", "severe", "failing", "critical", "issue", "error", "packet", "504", "intermittent", "problem"];
      
      positiveWords.forEach(word => {
        if (text.includes(word)) score += 8;
      });
      
      negativeWords.forEach(word => {
        if (text.includes(word)) score -= 10;
      });

      if (msg.role === "executive" && text.includes("?")) {
        score -= 5;
      }
    });
    
    return Math.max(12, Math.min(98, score));
  };

  const getSentimentDetails = (score: number) => {
    if (score <= 30) {
      return {
        label: "Critical Stress / P1 Outage Crisis",
        color: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30",
        barColor: "bg-rose-500",
        iconColor: "text-rose-500",
        threatLevel: "CRITICAL",
        threatLabel: "CRITICAL OUTAGE RISK",
        threatBg: "bg-rose-500 dark:bg-rose-600",
        threatText: "text-rose-600 dark:text-rose-400",
        heatmapIndex: 3
      };
    } else if (score <= 55) {
      return {
        label: "Concerned / Under Active SRE Remediation",
        color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30",
        barColor: "bg-amber-500",
        iconColor: "text-amber-500",
        threatLevel: "ELEVATED",
        threatLabel: "ELEVATED SYSTEM STRESS",
        threatBg: "bg-amber-500 dark:bg-amber-600",
        threatText: "text-amber-600 dark:text-amber-400",
        heatmapIndex: 2
      };
    } else if (score <= 75) {
      return {
        label: "Guarded / Constructive Remediation Dialogue",
        color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30",
        barColor: "bg-blue-500",
        iconColor: "text-blue-500",
        threatLevel: "GUARDED",
        threatLabel: "GUARDED OPERATION",
        threatBg: "bg-blue-500 dark:bg-blue-600",
        threatText: "text-blue-600 dark:text-blue-400",
        heatmapIndex: 1
      };
    } else {
      return {
        label: "Stable / Resolution Confirmed",
        color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30",
        barColor: "bg-emerald-500",
        iconColor: "text-emerald-500",
        threatLevel: "MINIMAL",
        threatLabel: "MINIMAL THREAT / STABLE",
        threatBg: "bg-emerald-500 dark:bg-emerald-600",
        threatText: "text-emerald-600 dark:text-emerald-400",
        heatmapIndex: 0
      };
    }
  };

  const activeApprovals = approvals.filter(app => isCallActive(app));
  const pendingApprovals = approvals.filter(app => app.status === "PENDING" && !isCallActive(app));
  const completedApprovals = approvals.filter(app => app.status !== "PENDING" && !isCallActive(app));

  const canReview = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.DEVOPS || currentUser.role === UserRole.NRE;

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50 dark:bg-[#050505] text-slate-800 dark:text-[#e0e0e0] transition-colors duration-200 h-screen">
      
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-tight">
          <ShieldCheck className="w-5 h-5 text-blue-500" /> Human-in-the-Loop (HITL) Consent Center
        </h2>
        <p className="text-xs text-slate-500 dark:text-[#888] mt-1">
          Review, authorize, or decline critical autonomous system automation actions before they deploy across downstream environments.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100%-80px)] items-stretch">
        
        {/* Left Column: Approvals List */}
        <div className="lg:col-span-5 flex flex-col space-y-4 bg-white dark:bg-[#0d0d0d] p-4 rounded border border-slate-200 dark:border-[#222] shadow-sm overflow-y-auto max-h-[650px]">
          <div>
            <h3 className="text-xs font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-2">HITL Queue Pipeline</h3>
          </div>
          
          {approvals.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400">
              No approvals requested.
            </div>
          ) : (
            <div className="space-y-4">
              {/* SECTION 1: ACTIVE ONGOING CONVERSATIONS */}
              {activeApprovals.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                      Active Conversations ({activeApprovals.length})
                    </span>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold">Pinned</span>
                  </div>
                  <div className="space-y-2">
                    {activeApprovals.map((app) => {
                      const isSelected = selectedApproval?.id === app.id;
                      return (
                        <button
                          key={app.id}
                          onClick={() => setSelectedId(app.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-all cursor-pointer relative ${
                            isSelected 
                              ? "border-emerald-600 dark:border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 ring-1 ring-emerald-500"
                              : "border-emerald-100 dark:border-emerald-950/20 hover:bg-emerald-50/10 dark:hover:bg-emerald-950/10 bg-emerald-50/5 dark:bg-emerald-950/5"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <span className="text-[10px] font-semibold text-emerald-600/70 dark:text-emerald-500/70">
                              ID: {app.id}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/40">
                                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                LIVE BRIDGE
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${getSystemColor(app.system)}`}>
                                {app.system}
                              </span>
                            </div>
                          </div>
                          
                          <h4 className="font-bold text-xs text-slate-800 dark:text-zinc-200 truncate flex items-center gap-1.5">
                            <Video className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            {app.action}
                          </h4>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate mt-1">Requestor: {app.agentName}</p>

                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-zinc-900/50">
                            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
                              {new Date(app.requestedAt).toLocaleTimeString()}
                            </span>
                            
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                              Operator Joined
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION 2: PENDING QUEUE TASKS */}
              {pendingApprovals.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 pt-1">
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-widest flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-500" />
                      Pending Queue Tasks ({pendingApprovals.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pendingApprovals.map((app) => {
                      const isSelected = selectedApproval?.id === app.id;
                      return (
                        <button
                          key={app.id}
                          onClick={() => setSelectedId(app.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-all cursor-pointer relative ${
                            isSelected 
                              ? "border-amber-500 dark:border-amber-500 bg-amber-50/10 dark:bg-amber-950/10 ring-1 ring-amber-500"
                              : "border-slate-100 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-900/40 bg-white dark:bg-[#0e0e0e]"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                              ID: {app.id}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-amber-100 dark:border-amber-900/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                AWAITING ACTION
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${getSystemColor(app.system)}`}>
                                {app.system}
                              </span>
                            </div>
                          </div>
                          
                          <h4 className="font-bold text-xs text-slate-800 dark:text-zinc-200 truncate">{app.action}</h4>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate mt-1">Requestor: {app.agentName}</p>

                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-zinc-900/50">
                            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
                              {new Date(app.requestedAt).toLocaleTimeString()}
                            </span>
                            
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 animate-pulse">
                              {app.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION 3: COMPLETED PIPELINE */}
              {completedApprovals.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 pt-1 border-t border-slate-100 dark:border-zinc-900/30">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-600 uppercase tracking-widest flex items-center gap-1 mt-2">
                      Completed Pipeline ({completedApprovals.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {completedApprovals.map((app) => {
                      const isSelected = selectedApproval?.id === app.id;
                      return (
                        <button
                          key={app.id}
                          onClick={() => setSelectedId(app.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-all cursor-pointer relative opacity-75 hover:opacity-100 ${
                            isSelected 
                              ? "border-slate-400 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-900/30 ring-1 ring-slate-400"
                              : "border-slate-100 dark:border-zinc-800/40 hover:bg-slate-50 dark:hover:bg-zinc-900/20 bg-white dark:bg-[#0c0c0c]"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                              ID: {app.id}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${getSystemColor(app.system)}`}>
                              {app.system}
                            </span>
                          </div>
                          
                          <h4 className="font-bold text-xs text-slate-600 dark:text-zinc-400 truncate">{app.action}</h4>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate mt-1">Requestor: {app.agentName}</p>

                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-zinc-900/30">
                            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
                              {new Date(app.requestedAt).toLocaleTimeString()}
                            </span>
                            
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              app.status === "APPROVED"
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-500"
                                : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-500"
                            }`}>
                              {app.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Detailed View */}
        <div className="lg:col-span-7">
          {selectedApproval ? (
            <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 flex flex-col justify-between h-full min-h-[500px]">
              
              <div className="space-y-6">
                {/* Header Section */}
                <div className="flex justify-between items-start border-b border-slate-100 dark:border-[#222] pb-4">
                  <div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${getSystemColor(selectedApproval.system)}`}>
                      {selectedApproval.system} Target System
                    </span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mt-2 uppercase tracking-wide">
                      {selectedApproval.action}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#888] mt-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-500" />
                      Dispatched {new Date(selectedApproval.requestedAt).toLocaleString()} by <strong>{selectedApproval.agentName}</strong>
                    </p>
                  </div>
                  
                  <span className={`text-xs font-bold px-2.5 py-1 rounded uppercase border ${
                    selectedApproval.status === "PENDING"
                      ? "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 animate-pulse"
                      : selectedApproval.status === "APPROVED"
                      ? "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                      : "bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
                  }`}>
                    {selectedApproval.status}
                  </span>
                </div>

                {/* Description */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-2 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Action Summary
                  </h4>
                  <p className="text-xs text-slate-700 dark:text-zinc-300 leading-relaxed font-medium bg-slate-50 dark:bg-[#111] p-4 rounded border border-slate-100 dark:border-[#222]">
                    {selectedApproval.description}
                  </p>
                </div>

                {/* MS Teams Crisis Call Bridge integration */}
                {selectedApproval.system === "Teams" ? (
                  selectedApproval.status === "PENDING" ? (
                    <div className="border border-indigo-200 dark:border-indigo-900/40 rounded overflow-hidden bg-[#fafafa] dark:bg-[#070707] transition-all">
                      {/* Header */}
                      <div className="bg-[#4f46e5]/10 dark:bg-[#4f46e5]/20 border-b border-slate-200 dark:border-[#222] px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="w-4 h-4 text-[#4f46e5]" />
                          <span className="text-xs font-bold text-[#4f46e5] uppercase tracking-wider">
                            MS Teams Gatekeeper Request
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-zinc-400 bg-white dark:bg-[#111] px-2 py-0.5 rounded border border-slate-100 dark:border-[#222]">
                          <AlertOctagon className="w-3.5 h-3.5 text-amber-500 animate-pulse" /> Awaiting Consent
                        </span>
                      </div>

                      <div className="p-5 space-y-5">
                        {/* Summary */}
                        <div className="bg-white dark:bg-[#111] p-4 rounded border border-slate-100 dark:border-[#222] space-y-3">
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Requested Bridge URL</span>
                              <div className="text-xs font-mono font-medium text-blue-600 dark:text-blue-400 break-all select-all mt-0.5 flex items-center gap-1">
                                <span>{selectedApproval.payload.teamsUrl}</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              </div>
                            </div>
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/20">
                              ID: {selectedApproval.payload.bridgeId || "CZ-VOIP-3091"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 dark:border-[#222] text-[11px]">
                            <div>
                              <span className="text-slate-400">Incident Context:</span>
                              <strong className="block text-slate-700 dark:text-zinc-300 font-mono mt-0.5">{selectedApproval.payload.incidentId || "INC-2026-9041"}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400">Call Requestor:</span>
                              <strong className="block text-slate-700 dark:text-zinc-300 mt-0.5">{selectedApproval.payload.requestor || "Marcus Vance (Director SRE)"}</strong>
                            </div>
                          </div>
                        </div>

                        {/* Dialogue Context */}
                        <div className="space-y-2">
                          <h4 className="text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                            Ongoing Dialogue Context (Teams War-Room Bridge Feed)
                          </h4>

                          <div className="rounded-lg border border-slate-200/60 dark:border-[#222] bg-[#fdfdfd] dark:bg-[#090909] p-4 space-y-4 max-h-[220px] overflow-y-auto shadow-inner">
                            <div className="flex items-start gap-2.5">
                              <img
                                src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=80"
                                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800"
                                referrerPolicy="no-referrer"
                              />
                              <div className="bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded border border-slate-100 dark:border-zinc-800/50 max-w-[85%]">
                                <div className="flex justify-between items-baseline gap-4 mb-1">
                                  <span className="text-[9px] font-bold text-slate-700 dark:text-zinc-300">Audrey Chen (Head of Infrastructure)</span>
                                  <span className="text-[8px] text-slate-400">04:09 PM</span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-normal font-medium">
                                  We are losing checkout conversions on the main customer-portal due to these 504 timeouts. Marcus, did SRE identify the root cause?
                                </p>
                              </div>
                            </div>

                            <div className="flex items-start gap-2.5">
                              <img
                                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80"
                                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800"
                                referrerPolicy="no-referrer"
                              />
                              <div className="bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded border border-slate-100 dark:border-zinc-800/50 max-w-[85%]">
                                <div className="flex justify-between items-baseline gap-4 mb-1">
                                  <span className="text-[9px] font-bold text-slate-700 dark:text-zinc-300">Marcus Vance (Director SRE)</span>
                                  <span className="text-[8px] text-slate-400">04:10 PM</span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-normal font-medium">
                                  Yes, transit ISP-Alpha is reporting 2.1% packet loss, causing BGP flap on spine-switch-02. SRE-Twin recommends an AS-path prepend to divert to ISP-Beta immediately.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-start gap-2.5">
                              <img
                                src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=80"
                                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800"
                                referrerPolicy="no-referrer"
                              />
                              <div className="bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded border border-slate-100 dark:border-zinc-800/50 max-w-[85%]">
                                <div className="flex justify-between items-baseline gap-4 mb-1">
                                  <span className="text-[9px] font-bold text-slate-700 dark:text-zinc-300">Audrey Chen (Head of Infrastructure)</span>
                                  <span className="text-[8px] text-slate-400">04:11 PM</span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-normal font-medium">
                                  Understood, let's get the Sync-Teams-Twin agent on this bridge immediately to present the full incident summary and provide real-time coordination across downstream networks.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-start gap-2.5">
                              <img
                                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80"
                                className="w-7 h-7 rounded-full border border-slate-200 dark:border-zinc-800"
                                referrerPolicy="no-referrer"
                              />
                              <div className="bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded border border-slate-100 dark:border-zinc-800/50 max-w-[85%] border-l-2 border-indigo-500">
                                <div className="flex justify-between items-baseline gap-4 mb-1">
                                  <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400">Marcus Vance (Director SRE)</span>
                                  <span className="text-[8px] text-slate-400">04:11 PM</span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-normal font-medium italic">
                                  Sync-Teams-Twin is waiting for HITL Gatekeeper permission to establish its VoIP outbound bridge. Request dispatched to our Commander.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Inline Actions */}
                        <div className="pt-2">
                          {!canReview ? (
                            <div className="p-3 bg-rose-50/60 dark:bg-rose-950/20 rounded border border-rose-100/60 dark:border-rose-900/20 text-[11px] text-rose-700 dark:text-rose-400 flex items-start gap-2">
                              <Lock className="w-4 h-4 shrink-0" />
                              <div>
                                <strong>SSO Role Restricted</strong>: Only Administrator, DevOps, or NRE identities can authorize outbound bridge connections. Your role is: <strong>{currentUser.role}</strong>.
                              </div>
                            </div>
                          ) : (
                            <div className="bg-[#4f46e5]/5 dark:bg-[#4f46e5]/10 border border-indigo-100 dark:border-indigo-900/20 rounded p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                              <div className="space-y-0.5 text-center sm:text-left">
                                <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-semibold">
                                  Authorize Call Connection Request
                                </span>
                                <p className="text-[10px] text-slate-500 dark:text-zinc-400 leading-normal">
                                  By approving, you authorize the SRE agent to connect to this Teams meeting, sync ticket logs, and communicate.
                                </p>
                              </div>

                              <div className="flex gap-2.5 shrink-0 w-full sm:w-auto">
                                <button
                                  disabled={approving}
                                  onClick={() => {
                                    onApproveAction(
                                      selectedApproval.id,
                                      "DENIED",
                                      "VoIP Bridge Denied: Security compliance restrictions on outbound Teams bridges."
                                    );
                                  }}
                                  className="flex-1 sm:flex-initial px-3.5 py-1.5 bg-white hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-[11px] font-bold rounded border border-slate-200 dark:border-zinc-700 cursor-pointer shadow-sm uppercase tracking-wider transition-all"
                                >
                                  Decline
                                </button>
                                <button
                                  disabled={approving}
                                  onClick={() => {
                                    onApproveAction(
                                      selectedApproval.id,
                                      "APPROVED",
                                      "VoIP Bridge Authorized: Cleared Sync-Teams-Twin to connect to executive Teams call and sync diagnostics."
                                    );
                                  }}
                                  className="flex-1 sm:flex-initial px-4 py-1.5 bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11px] font-bold rounded cursor-pointer shadow-sm shadow-[#4f46e5]/25 uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" /> Approve & Join
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : selectedApproval.status === "DENIED" ? (
                    <div className="border border-rose-200 dark:border-rose-900/30 rounded overflow-hidden bg-rose-50/10 dark:bg-[#070101] p-6 text-center space-y-4">
                      <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/20 flex items-center justify-center text-rose-500">
                        <XCircle className="w-6 h-6" />
                      </div>
                      <div className="max-w-md mx-auto space-y-1.5">
                        <h4 className="text-sm font-bold text-rose-800 dark:text-rose-400 uppercase tracking-wider">
                          Teams Call Connection Rejected
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                          This gatekeeper connection request was rejected by <strong className="text-slate-800 dark:text-zinc-200">{selectedApproval.reviewedBy}</strong> on {new Date(selectedApproval.reviewedAt || "").toLocaleString()}.
                        </p>
                        <div className="bg-white dark:bg-zinc-900 p-3 rounded border border-rose-100 dark:border-zinc-800 text-[11px] text-slate-600 dark:text-zinc-400 font-medium italic mt-2">
                          &ldquo;{selectedApproval.comment}&rdquo;
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-[#222] rounded overflow-hidden bg-[#fafafa] dark:bg-[#070707] transition-all">
                      
                      {/* Header */}
                      <div className="bg-[#4f46e5]/10 dark:bg-[#4f46e5]/20 border-b border-slate-200 dark:border-[#222] px-4 py-3 flex flex-wrap gap-2 items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="w-4 h-4 text-[#4f46e5]" />
                          <span className="text-xs font-bold text-[#4f46e5] uppercase tracking-wider">
                            Microsoft Teams Crisis Call Bridge Simulator
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const nextState = !voiceSynthesizerEnabled;
                              setVoiceSynthesizerEnabled(nextState);
                              if (!nextState) {
                                if ("speechSynthesis" in window) {
                                  window.speechSynthesis.cancel();
                                }
                              }
                            }}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
                              voiceSynthesizerEnabled
                                ? "bg-indigo-600 border-transparent text-white shadow-sm"
                                : "bg-white dark:bg-[#111] border-slate-200 dark:border-[#222] text-slate-500 dark:text-zinc-400"
                            }`}
                          >
                            <Volume2 className={`w-3.5 h-3.5 ${voiceSynthesizerEnabled ? "animate-pulse" : ""}`} />
                            TTS Synthesizer: {voiceSynthesizerEnabled ? "ON" : "OFF"}
                          </button>
                          
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-zinc-400 bg-white dark:bg-[#111] px-2 py-1 rounded border border-slate-100 dark:border-[#222] hidden sm:inline-flex">
                            <Users className="w-3 h-3" /> Secure Dial-In Tunnel
                          </span>
                        </div>
                      </div>

                      {teamsJoinState === "NOT_JOINED" && (
                        <div className="p-6 text-center space-y-4">
                          <div className="mx-auto w-12 h-12 rounded-full bg-[#4f46e5]/10 flex items-center justify-center text-[#4f46e5]">
                            <Phone className="w-6 h-6 animate-bounce" />
                          </div>
                          <div className="max-w-md mx-auto space-y-1.5">
                            <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">
                              Sync-Teams-Twin requires external Call Bridge coordinates
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                              To join the active executive crisis war-room briefing, please paste or generate the meeting bridge URL coordinates. SRE-Twin will sync ServiceNow summaries instantly.
                            </p>
                          </div>

                          <div className="max-w-md mx-auto space-y-3 pt-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Enter Teams Bridge URL (https://teams.microsoft.com/...)"
                                value={teamsUrl}
                                onChange={(e) => setTeamsUrl(e.target.value)}
                                className="flex-1 bg-white dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded py-2 px-3 text-xs text-slate-700 dark:text-zinc-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#4f46e5] focus:border-[#4f46e5] shadow-inner"
                              />
                              <button
                                onClick={() => {
                                  setTeamsUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_US_EAST_VPC_B_Crisis_WarRoom%40thread.v2");
                                }}
                                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 text-[11px] font-bold rounded transition-colors cursor-pointer"
                              >
                                Generate Link
                              </button>
                            </div>

                            <button
                              disabled={!teamsUrl.trim()}
                              onClick={() => handleJoinCall()}
                              className="w-full py-2.5 bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-50 text-white rounded text-xs font-bold shadow-md shadow-[#4f46e5]/10 transition-all uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <Wifi className="w-4 h-4 animate-pulse" /> Establish Call Bridge Connection
                            </button>
                          </div>
                        </div>
                      )}

                      {teamsJoinState === "JOINING" && (
                        <div className="p-8 text-center space-y-4 bg-slate-50 dark:bg-[#070707] flex flex-col items-center justify-center">
                          <div className="relative flex h-10 w-10">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4f46e5] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-10 w-10 bg-[#4f46e5] flex items-center justify-center text-white font-bold text-xs">
                              <RefreshCw className="w-5 h-5 animate-spin" />
                            </span>
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold text-[#4f46e5] uppercase tracking-widest animate-pulse">
                              Establishing VoIP Bridge Sync
                            </h4>
                            <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 bg-slate-100 dark:bg-[#111] px-3 py-1.5 rounded border border-slate-200/50 dark:border-[#222]">
                              <Terminal className="w-3.5 h-3.5 shrink-0 text-[#4f46e5]" />
                              {connectingStep}
                            </p>
                          </div>
                        </div>
                      )}

                      {teamsJoinState === "JOINED" && (
                        <div className="flex flex-col h-[760px]">
                          
                          {/* Live Call Monitor Bar */}
                          <div className="bg-rose-500/10 border-b border-rose-500/20 px-4 py-1.5 flex items-center justify-between text-[10px] font-bold">
                            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 animate-pulse">
                              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                              <span>🔴 LIVE RECORDING | SECURE MEETING ID: {selectedApproval?.payload?.bridgeId || "CZ-VOIP-3091"}</span>
                            </div>
                            <span className="text-slate-500 font-mono">ELAPSED: 04:12</span>
                          </div>

                          {/* Call Sentiment Analyzer Widget */}
                          {(() => {
                            const score = calculateSentimentScore(teamsMessages);
                            const details = getSentimentDetails(score);
                            return (
                              <div className="bg-slate-50 dark:bg-[#0b0b0b] border-b border-slate-200 dark:border-[#222] px-4 py-3.5 space-y-3.5">
                                {/* Header Info */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-[#4f46e5] animate-pulse" />
                                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
                                      Real-Time Call Sentiment & Threat Level
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono font-bold text-slate-500">
                                      SCORE:
                                    </span>
                                    <span className={`text-sm font-black font-mono ${details.iconColor}`}>
                                      {score}%
                                    </span>
                                  </div>
                                </div>

                                {/* Threat Status Card */}
                                <div className={`px-3.5 py-2.5 rounded border flex items-center justify-between gap-3 ${details.color} transition-all duration-500`}>
                                  <div className="flex flex-col">
                                    <span className="text-[10px] uppercase font-bold tracking-widest opacity-75">
                                      Active Threat Classification
                                    </span>
                                    <span className="text-xs font-black uppercase tracking-wider mt-0.5">
                                      {details.threatLabel}
                                    </span>
                                    <span className="text-[10px] mt-0.5 opacity-90 font-medium">
                                      {details.label}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0 bg-white/20 dark:bg-[#000]/20 px-2.5 py-1.5 rounded-md border border-white/10">
                                    <span className={`w-2 h-2 rounded-full ${details.barColor} animate-ping`} />
                                    <span className="text-[10px] font-extrabold tracking-wider">{details.threatLevel}</span>
                                  </div>
                                </div>

                                {/* Threat Level Visual Heatmap Scale */}
                                <div className="space-y-1.5 pt-1">
                                  <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest px-1">
                                    <span>Critical Threat (Red)</span>
                                    <span>Elevated (Amber)</span>
                                    <span>Guarded (Blue)</span>
                                    <span>Minimal (Green)</span>
                                  </div>
                                  <div className="relative w-full h-3 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-visible">
                                    {/* Heatmap Spectrum Bar */}
                                    <div className="absolute inset-0 h-full w-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 via-blue-500 to-emerald-500 opacity-85" />
                                    
                                    {/* Active Highlight Glow Area */}
                                    <div 
                                      className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-rose-500 via-amber-500 via-blue-500 to-emerald-500 opacity-20 blur-sm transition-all duration-500"
                                    />

                                    {/* Grid markers/ticks */}
                                    <div className="absolute inset-y-0 left-[30%] w-[1px] bg-white/30" />
                                    <div className="absolute inset-y-0 left-[55%] w-[1px] bg-white/30" />
                                    <div className="absolute inset-y-0 left-[75%] w-[1px] bg-white/30" />

                                    {/* Current Score Overlay indicator */}
                                    <div 
                                      className="absolute top-1/2 -translate-y-1/2 -ml-2.5 w-5 h-5 bg-white dark:bg-zinc-900 rounded-full border-2 border-slate-800 dark:border-white shadow-md flex items-center justify-center transition-all duration-500 ease-out z-10"
                                      style={{ left: `${score}%` }}
                                    >
                                      <div className={`w-2.5 h-2.5 rounded-full ${details.barColor} animate-pulse`} />
                                    </div>
                                  </div>
                                </div>

                                {/* Heatmap Block Visual LEDs */}
                                <div className="grid grid-cols-4 gap-2 mt-2 pt-1">
                                  {[
                                    { id: "minimal", label: "Minimal", color: "bg-emerald-500 border-emerald-200 dark:border-emerald-900/50", range: "76% - 100%", activeIdx: 0 },
                                    { id: "guarded", label: "Guarded", color: "bg-blue-500 border-blue-200 dark:border-blue-900/50", range: "56% - 75%", activeIdx: 1 },
                                    { id: "elevated", label: "Elevated", color: "bg-amber-500 border-amber-200 dark:border-amber-900/50", range: "31% - 55%", activeIdx: 2 },
                                    { id: "critical", label: "Critical", color: "bg-rose-500 border-rose-200 dark:border-rose-900/50", range: "0% - 30%", activeIdx: 3 }
                                  ].map((level, i) => {
                                    const isActive = details.heatmapIndex === level.activeIdx;
                                    return (
                                      <div 
                                        key={level.id}
                                        className={`p-2 rounded border flex flex-col justify-between items-center text-center transition-all duration-500 relative ${
                                          isActive 
                                            ? `bg-white dark:bg-zinc-900 border-slate-300 dark:border-zinc-700 shadow-sm ring-1 ring-offset-0 ring-[#4f46e5]/10`
                                            : "bg-slate-100/30 dark:bg-zinc-900/10 border-slate-200/30 dark:border-zinc-900/30 opacity-40 text-slate-400 dark:text-zinc-600"
                                        }`}
                                      >
                                        <span className={`text-[9px] uppercase tracking-wider font-extrabold ${isActive ? details.threatText : "text-slate-400 dark:text-zinc-600"}`}>
                                          {level.label}
                                        </span>
                                        <div className="flex items-center gap-1 mt-1.5 mb-1">
                                          {isActive && (
                                            <span className={`w-1.5 h-1.5 rounded-full ${level.color} animate-ping`} />
                                          )}
                                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? level.color : "bg-slate-300 dark:bg-zinc-800"}`} />
                                        </div>
                                        <span className="text-[8px] font-mono mt-0.5 block opacity-85">
                                          {level.range}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Meeting Participants Grid */}
                          <div className="grid grid-cols-4 gap-2.5 p-3 bg-slate-100 dark:bg-[#111] border-b border-slate-200 dark:border-[#222]">
                            
                            {/* SRE Digital Twin */}
                            <div className={`p-2 rounded bg-white dark:bg-[#090909] border flex flex-col items-center justify-center text-center transition-all ${
                              isTwinTyping || teamsMessages.length < 4
                                ? "border-[#4f46e5] shadow-sm shadow-[#4f46e5]/10"
                                : "border-slate-200 dark:border-[#222]"
                            }`}>
                              <div className="relative">
                                <img
                                  src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80"
                                  className="w-8 h-8 rounded-full border border-slate-300 dark:border-[#333]"
                                  referrerPolicy="no-referrer"
                                />
                                {(isTwinTyping || teamsMessages.length < 4) && (
                                  <span className="absolute -bottom-1 -right-1 bg-[#4f46e5] p-0.5 rounded-full text-white animate-pulse">
                                    <Volume2 className="w-3 h-3" />
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-bold text-slate-800 dark:text-zinc-200 mt-1 truncate max-w-full">
                                SRE-Twin (AI)
                              </span>
                              <span className="text-[8px] text-slate-400 uppercase font-medium">
                                {isTwinTyping || teamsMessages.length < 4 ? "Speaking..." : "Listening"}
                              </span>
                            </div>

                            {/* Head of Infrastructure */}
                            <div className="p-2 rounded bg-white dark:bg-[#090909] border border-slate-200 dark:border-[#222] flex flex-col items-center justify-center text-center">
                              <img
                                src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=80"
                                className="w-8 h-8 rounded-full border border-slate-300 dark:border-[#333]"
                                referrerPolicy="no-referrer"
                              />
                              <span className="text-[10px] font-bold text-slate-800 dark:text-zinc-200 mt-1 truncate max-w-full">
                                Audrey Chen
                              </span>
                              <span className="text-[8px] text-slate-400 uppercase font-medium">
                                Head of Infra
                              </span>
                            </div>

                            {/* Director SRE */}
                            <div className="p-2 rounded bg-white dark:bg-[#090909] border border-slate-200 dark:border-[#222] flex flex-col items-center justify-center text-center">
                              <img
                                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80"
                                className="w-8 h-8 rounded-full border border-slate-300 dark:border-[#333]"
                                referrerPolicy="no-referrer"
                              />
                              <span className="text-[10px] font-bold text-slate-800 dark:text-zinc-200 mt-1 truncate max-w-full">
                                Marcus Vance
                              </span>
                              <span className="text-[8px] text-slate-400 uppercase font-medium">
                                Director SRE
                              </span>
                            </div>

                            {/* User */}
                            <div className="p-2 rounded bg-white dark:bg-[#090909] border border-slate-200 dark:border-[#222] flex flex-col items-center justify-center text-center">
                              <img
                                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80"
                                className="w-8 h-8 rounded-full border border-slate-300 dark:border-[#333]"
                                referrerPolicy="no-referrer"
                              />
                              <span className="text-[10px] font-bold text-slate-800 dark:text-zinc-200 mt-1 truncate max-w-full">
                                You
                              </span>
                              <span className="text-[8px] text-emerald-500 uppercase font-bold tracking-wider">
                                Commander
                              </span>
                            </div>

                          </div>

                          {/* Main Split Layout: Left Chat, Right Change Management Console */}
                          <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0 bg-slate-50 dark:bg-[#050505]">
                            
                            {/* Left Column: Teams Call Chat Bridge */}
                            <div className="flex-1 lg:flex-[3] flex flex-col overflow-hidden border-r border-slate-200 dark:border-[#222]">
                              
                              {/* Chat Messages Log */}
                              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#fafafa] dark:bg-[#060606]">
                                {teamsMessages.map((msg, i) => (
                                  <div
                                    key={i}
                                    className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                                  >
                                    <img
                                      src={msg.avatar}
                                      className="w-6 h-6 rounded-full border border-slate-200 dark:border-[#222]"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className={`max-w-[80%] rounded p-2.5 ${
                                      msg.role === "twin"
                                        ? "bg-blue-50 border border-blue-100 text-slate-800 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-zinc-200"
                                        : msg.role === "user"
                                        ? "bg-[#4f46e5] text-white"
                                        : "bg-slate-100 border border-slate-200/50 text-slate-800 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200"
                                    }`}>
                                      <div className="flex justify-between items-baseline gap-4 mb-1">
                                        <span className={`text-[9px] font-bold uppercase tracking-wider ${
                                          msg.role === "user" ? "text-indigo-200" : "text-[#4f46e5] dark:text-indigo-400"
                                        }`}>
                                          {msg.sender}
                                        </span>
                                        <span className={`text-[8px] font-medium ${
                                          msg.role === "user" ? "text-indigo-200" : "text-slate-400"
                                        }`}>
                                          {msg.time}
                                        </span>
                                      </div>
                                      <p className="text-[11px] leading-relaxed font-medium break-words whitespace-pre-wrap">
                                        {msg.content}
                                      </p>
                                    </div>
                                  </div>
                                ))}

                                {isTwinTyping && (
                                  <div className="flex items-start gap-2.5">
                                    <img
                                      src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80"
                                      className="w-6 h-6 rounded-full border border-slate-200 dark:border-[#222]"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="bg-blue-50 border border-blue-100 text-slate-500 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-zinc-400 rounded p-2.5 flex items-center gap-2">
                                      <span className="flex gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]"></span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]"></span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"></span>
                                      </span>
                                      <span className="text-[9px] font-bold uppercase tracking-widest font-mono">
                                        Sync-Teams-Twin SRE Agent is analyzing logs...
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Message Input Form */}
                              <form
                                onSubmit={handleSendMessage}
                                className="bg-slate-100 dark:bg-[#111] p-3 border-t border-slate-200 dark:border-[#222] flex gap-2"
                              >
                                <input
                                  type="text"
                                  disabled={isTwinTyping}
                                  value={userMsgInput}
                                  onChange={(e) => setUserMsgInput(e.target.value)}
                                  placeholder="Ask SRE-Twin questions about ServiceNow summaries or remediation risks..."
                                  className="flex-1 bg-white dark:bg-[#0d0d0d] border border-slate-200 dark:border-[#222] rounded py-1.5 px-3 text-xs text-slate-700 dark:text-zinc-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#4f46e5] focus:border-[#4f46e5]"
                                />
                                <button
                                  type="submit"
                                  disabled={isTwinTyping || !userMsgInput.trim()}
                                  className="bg-[#4f46e5] hover:bg-[#4338ca] text-white p-2 rounded disabled:opacity-40 transition-colors cursor-pointer"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                </button>
                              </form>

                            </div>

                            {/* Right Column: ServiceNow & Incident Change Control Console */}
                            <div className="w-full lg:w-auto lg:flex-[2] bg-white dark:bg-[#0a0a0a] flex flex-col overflow-y-auto p-4 space-y-4 border-t lg:border-t-0 border-slate-200 dark:border-[#222]">
                              
                              {/* Console Header */}
                              <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-zinc-900">
                                <FileText className="w-4 h-4 text-indigo-500" />
                                <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">
                                  ServiceNow Change Console
                                </h4>
                              </div>

                              {/* Incident Card Metadata */}
                              <div className="bg-slate-50 dark:bg-zinc-900/40 p-3 rounded border border-slate-150 dark:border-zinc-800/60 space-y-2">
                                <div className="flex items-center justify-between text-[10px] font-bold">
                                  <span className="text-[#4f46e5] dark:text-indigo-400">TICKET: {selectedIncidentId || "UNLINKED"}</span>
                                  <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded border border-rose-500/20 uppercase text-[8px] tracking-wider">P1 - CRITICAL</span>
                                </div>
                                <div className="text-[11px] text-slate-700 dark:text-zinc-300 leading-tight">
                                  <strong className="text-slate-900 dark:text-white">Issue context: </strong>
                                  {selectedApproval?.description || selectedApproval?.action || "No incident context is bound to this approval."}
                                </div>
                              </div>

                              {/* Active Change Records Loop */}
                              <div className="space-y-3.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-0.5 flex justify-between items-center">
                                  <span>ServiceNow Change Records (CR)</span>
                                  <span className="text-[9px] text-[#4f46e5] font-mono lowercase">sync-state: secure</span>
                                </div>

                                {relatedChangeRecords.length === 0 ? (
                                  <div className="p-6 text-center border border-dashed border-slate-200 dark:border-zinc-800 rounded bg-slate-50/20">
                                    <p className="text-[10px] text-slate-400 italic">No active change records found.</p>
                                    <button
                                      type="button"
                                      disabled={isTwinTyping}
                                      onClick={() => {
                                        setUserMsgInput("Sync-Teams-Twin, please open a change record with remediation steps");
                                      }}
                                      className="mt-3.5 w-full py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-[#4f46e5] dark:text-indigo-300 rounded text-[10px] font-bold border border-indigo-200/50 dark:border-indigo-900/30 transition-all uppercase tracking-wider cursor-pointer text-center"
                                    >
                                      Request Twin to Open CR
                                    </button>
                                  </div>
                                ) : (
                                  relatedChangeRecords.map((cr) => (
                                    <div key={cr.id} className="border border-slate-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-950 shadow-sm">
                                      {/* CR Header */}
                                      <div className="bg-slate-50 dark:bg-zinc-900/60 px-3 py-2 border-b border-slate-150 dark:border-zinc-800 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
                                          <span className="text-[11px] font-mono font-black text-slate-800 dark:text-zinc-100">{cr.id}</span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                                          cr.status === "EXECUTED"
                                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                            : cr.status === "PENDING_APPROVAL"
                                            ? "bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse"
                                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400"
                                        }`}>
                                          {cr.status}
                                        </span>
                                      </div>

                                      {/* CR Content */}
                                      <div className="p-3 space-y-3">
                                        <div className="space-y-0.5">
                                          <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Operational Context</span>
                                          <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed font-medium">
                                            {cr.context}
                                          </p>
                                        </div>

                                        {/* CR Steps */}
                                        <div className="space-y-1.5">
                                          <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Execution Steps</span>
                                          <div className="space-y-1.5 pl-0.5">
                                            {cr.steps.map((step) => (
                                              <div key={step.id} className="flex items-start gap-2 text-[10px] text-slate-700 dark:text-zinc-300 font-medium leading-tight">
                                                <span className={`w-3.5 h-3.5 mt-0.5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-black ${
                                                  step.status === "COMPLETED"
                                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                                                    : step.status === "RUNNING"
                                                    ? "bg-blue-500/10 text-blue-500 border border-blue-500/30 animate-pulse"
                                                    : "bg-slate-100 dark:bg-zinc-800 text-slate-400 border border-slate-200 dark:border-zinc-700"
                                                }`}>
                                                  {step.status === "COMPLETED" ? "✓" : "•"}
                                                </span>
                                                <span className={step.status === "COMPLETED" ? "line-through text-slate-400 dark:text-zinc-600" : ""}>
                                                  {step.description}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        {/* Dynamic Twin Interactions */}
                                        {cr.status !== "EXECUTED" && (
                                          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-zinc-900">
                                            <button
                                              type="button"
                                              disabled={isTwinTyping}
                                              onClick={() => {
                                                setUserMsgInput(`SRE-Twin, please add a context step: Verify DNS replication state`);
                                              }}
                                              className="py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded text-[9px] font-bold border border-slate-200 dark:border-zinc-700 text-center uppercase tracking-wider transition-colors cursor-pointer"
                                            >
                                              + Add SRE Step
                                            </button>
                                            <button
                                              type="button"
                                              disabled={isTwinTyping}
                                              onClick={() => {
                                                setUserMsgInput(`Sync-Teams-Twin, please execute the change record ${cr.id}`);
                                              }}
                                              className="py-1.5 bg-[#4f46e5]/10 hover:bg-[#4f46e5]/20 text-[#4f46e5] dark:text-indigo-300 rounded text-[9px] font-bold border border-[#4f46e5]/25 text-center uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                                            >
                                              ⚡ Execute CR
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              {/* Senior SRE / NRE Suggestion Prompts */}
                              <div className="pt-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 px-0.5">Senior SRE Prompt Actions</span>
                                <div className="space-y-2">
                                  {[
                                    { label: "Check ServiceNow Outage Impact", prompt: "Sync-Teams-Twin, can you check ServiceNow and clarify what specific customer-facing services are currently degraded because of this packet loss?" },
                                    { label: "Analyze Routing & Failover Risks", prompt: "SRE-Twin, what are the technical risks or potential packet drops when prepending our BGP AS-path?" },
                                    { label: "Ask for DNS and Kubernetes Details", prompt: "What network diagnostic data did you collect from spine-switch-02 regarding the canary deployment?" }
                                  ].map((item, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      disabled={isTwinTyping}
                                      onClick={() => {
                                        setUserMsgInput(item.prompt);
                                      }}
                                      className="w-full text-left p-2.5 bg-slate-50 hover:bg-[#4f46e5]/5 dark:bg-zinc-900/40 dark:hover:bg-indigo-950/15 text-slate-600 hover:text-[#4f46e5] dark:text-zinc-400 dark:hover:text-indigo-300 rounded-lg border border-slate-150 hover:border-[#4f46e5]/30 dark:border-zinc-800/60 dark:hover:border-indigo-500/20 text-[10px] font-medium transition-all flex items-center justify-between cursor-pointer group"
                                    >
                                      <span>{item.label}</span>
                                      <ChevronRight className="w-3 h-3 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                  ))}
                                </div>
                              </div>

                            </div>

                          </div>

                        </div>
                      )}

                    </div>
                  )
                ) : (
                  /* Payload parameters */
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-2">
                      Cryptographic Payload Properties (JSON)
                    </h4>
                    <pre className="text-[11px] font-mono text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-600/10 p-4 rounded border border-blue-100/50 dark:border-blue-600/20 overflow-x-auto select-all leading-tight">
                      {JSON.stringify(selectedApproval.payload, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Reviews info */}
                {selectedApproval.status !== "PENDING" && (
                  <div className="p-4 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] space-y-2 text-xs">
                    <h4 className="font-bold text-slate-500 dark:text-[#555] uppercase text-[10px] tracking-wider mb-1">Authorization Details</h4>
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-zinc-300">
                      <User className="w-3.5 h-3.5 text-blue-500" />
                      <span>Reviewed by: <strong className="text-slate-900 dark:text-white">{selectedApproval.reviewedBy}</strong></span>
                      <span className="text-slate-300 dark:text-zinc-700">|</span>
                      <span>Date: {new Date(selectedApproval.reviewedAt || "").toLocaleString()}</span>
                    </div>
                    {selectedApproval.comment && (
                      <div className="flex items-start gap-1.5 mt-2 pt-2 border-t border-slate-200/50 dark:border-[#222] text-slate-600 dark:text-zinc-400 font-medium">
                        <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        <span><em>&ldquo;{selectedApproval.comment}&rdquo;</em></span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons with RBAC Checks */}
              <div className="mt-8 border-t border-slate-100 dark:border-[#222] pt-6">
                {selectedApproval.status === "PENDING" ? (
                  !canReview ? (
                    <div className="p-4 bg-rose-50/60 dark:bg-rose-950/20 rounded border border-rose-100/60 dark:border-rose-900/20 text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2">
                      <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Authorization Blocked</strong>: Your active SSO identity (<strong>{currentUser.name}</strong>) has role properties matching <strong>{currentUser.role}</strong>. System modifications require Operator or Administrator authorization clearance.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 dark:text-[#555] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" /> Authorization Comment / Verification Notes (Required)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Confirmed diagnostic telemetry matches rollback requirements, executing action."
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded py-2.5 px-3.5 text-xs text-slate-700 dark:text-zinc-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 shadow-inner"
                        />
                      </div>

                      <div className="flex gap-3 justify-end">
                        <button
                          disabled={approving}
                          onClick={() => handleAction("DENIED")}
                          className="px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded text-xs font-bold border border-rose-200 dark:border-rose-900/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm uppercase tracking-wider"
                        >
                          <XCircle className="w-4 h-4" /> Decline Action
                        </button>
                        <button
                          disabled={approving || !comment.trim()}
                          onClick={() => handleAction("APPROVED")}
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow shadow-blue-500/10 uppercase tracking-wider"
                        >
                          <ShieldCheck className="w-4 h-4" /> Authorize & Deploy
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-2 text-xs font-bold text-slate-400 flex items-center justify-center gap-1.5 uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    This action is sealed and logged inside the Cloud Zero Secure Vault.
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center h-full">
              <ShieldCheck className="w-10 h-10 text-slate-200 dark:text-zinc-800 mb-3" />
              Select an action from the pipeline to review authorization logs.
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
