import React, { useState, useEffect, useRef } from "react";
import { DigitalTwinAgent } from "../types";
import { KNOWLEDGE_BASE, KBArticle, findKBArticle } from "../data/kb";
import { 
  Cpu, 
  Terminal, 
  Sparkles, 
  FileText, 
  Download, 
  Play, 
  Layers, 
  AlertTriangle,
  RefreshCw,
  Clock,
  ExternalLink,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  HelpCircle,
  Send,
  MessageSquare,
  Check,
  CheckCircle,
  Wifi,
  Sliders,
  User,
  Bot,
  Video,
  Info,
  Activity,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import TwinObservabilityPanel from "./TwinObservabilityPanel";

interface AgentsViewProps {
  agents: DigitalTwinAgent[];
  onOpenTwin: (twinId: string) => void;
}

interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  groundingStatus?: "GROUNDED" | "PARTIAL" | "ABSTAINED";
  citations?: string[];
  limitations?: string[];
}

interface VoiceResponse {
  success?: boolean;
  text?: unknown;
  groundingStatus?: unknown;
  citations?: unknown;
  limitations?: unknown;
  engineerRole?: unknown;
}

interface VoicePipelineStatus {
  success: boolean;
  pipeline?: {
    reasoning?: { service: string; model: string; purpose: string };
    transcription?: { service: string; engine: string; model: string; ready: boolean; purpose: string };
    synthesis?: { service: string; defaultEngine: string; defaultModel: string; conversationalEngine: string; conversationalModel: string; purpose: string };
  };
}

type OutputLanguage = "en" | "es" | "zh" | "hi" | "kn" | "ta";
const outputLanguages: Array<{ code: OutputLanguage; label: string; speechTag: string }> = [
  { code: "en", label: "English", speechTag: "en-US" },
  { code: "es", label: "Spanish", speechTag: "es-ES" },
  { code: "zh", label: "Mandarin", speechTag: "zh-CN" },
  { code: "hi", label: "Hindi", speechTag: "hi-IN" },
  { code: "kn", label: "Kannada", speechTag: "kn-IN" },
  { code: "ta", label: "Tamil", speechTag: "ta-IN" },
];

const twinLabels: Record<string, string> = {
  NETWORK: "Network Digital Twin",
  WINDOWS: "Windows Digital Twin",
  CLOUDOPS: "CloudOps Digital Twin",
  DEVOPS: "DevOps Digital Twin",
  LINUX: "Linux Digital Twin",
  SECURITY: "Security Digital Twin",
  DATABASE: "Database Digital Twin"
};
const twinLabel = (role: string) => twinLabels[role] || "Engineering Digital Twin";

const isIncidentQuestion = (question: string) => {
  return /\b(?:INC|MIM)-[A-Z0-9-]+\b/i.test(question) ||
    /\b(?:incident|outage|root cause|rca|current status|service impact|incident timeline|what happened|actions? (?:were|was|have been) (?:executed|performed|recorded)|packet loss (?:was|is) measured)\b/i.test(question);
};

const extractWakeWordCommand = (text: string): string | null => {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^(?:hey\s+)?(?:apex|vijay)\b[\s,.:!?-]*(.*)$/i);
  return match ? match[1].trim() : null;
};

const formatGroundingCitation = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const citation = value as Record<string, unknown>;
  const kind = typeof citation.kind === "string" ? citation.kind : "SOURCE";
  const id = [citation.evidenceId, citation.eventId, citation.kbId].find(item => typeof item === "string");
  const source = typeof citation.source === "string" ? citation.source : undefined;
  return [kind, id, source].filter((item): item is string => typeof item === "string" && item.length > 0).join(": ");
};

export default function AgentsView({ agents, onOpenTwin }: AgentsViewProps) {
  // Tabs: "fleet" (department digital twins), "voice-copilot" (interactive voice assistant), "diagnostics" (log post-mortem)
  const [activeSubTab, setActiveSubTab] = useState<"fleet" | "voice-copilot" | "diagnostics" | "activity">(() => new URLSearchParams(window.location.search).get("twinActivity") === "1" ? "activity" : "fleet");
  const [activityRole, setActivityRole] = useState("");
  const workspaceAgents: DigitalTwinAgent[] = agents;
  const availableTwinCount = workspaceAgents.filter(agent => !["FAILED"].includes(agent.status)).length;
  const workspaceId = (agent: DigitalTwinAgent) => ({ "agent-nre": "networking", "agent-windows": "windows", "agent-database": "dba", "agent-cloudops": "cloudops", "agent-devops": "devops", "agent-middleware": "middleware", "agent-security": "security", "agent-sre": "sre", "agent-teams": "collaboration", "agent-linux": "linux" }[agent.id] || agent.department || agent.role);

  // ==========================================
  // SRE Log Diagnostics State (Original Module)
  // ==========================================
  const [selectedIncident, setSelectedIncident] = useState("INC-2026-9041");
  const [rawLogs, setRawLogs] = useState(
    `Aug 04 22:45:01 ingress-gateway nginx[904]: *50219 upstream timed out (110: Connection timed out) while connecting to upstream, client: 10.114.2.80, server: core.cloudzero.internal, request: 'POST /api/v1/auth/sso HTTP/1.1'\nAug 04 22:45:12 db-cluster-0 postgres[812]: FATAL: connection limit exceeded for non-superuser role 'sre_twin_auth'\nAug 04 22:45:15 aegis-kernel orchestrator[112]: WARNING: database query execution latency spike detected (7512 ms)\nAug 04 22:46:00 health-check status-monitor[04]: FAILURE: health probe failed on replica group us-east-vpc-b`
  );
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const incidents = [
    { id: "INC-2026-9041", title: "Ingress Socket Leak & DB Connection Exhaustion" },
    { id: "INC-2026-8912", title: "Active SAML SSO IDP Handshake Timeout" },
    { id: "INC-2026-7734", title: "Encrypted Backup Vault Re-key Collision" }
  ];

  const handleIncidentSelect = (id: string) => {
    setSelectedIncident(id);
    if (id === "INC-2026-9041") {
      setRawLogs(
        `Aug 04 22:45:01 ingress-gateway nginx[904]: *50219 upstream timed out (110: Connection timed out) while connecting to upstream, client: 10.114.2.80, server: core.cloudzero.internal, request: 'POST /api/v1/auth/sso HTTP/1.1'\nAug 04 22:45:12 db-cluster-0 postgres[812]: FATAL: connection limit exceeded for non-superuser role 'sre_twin_auth'\nAug 04 22:45:15 aegis-kernel orchestrator[112]: WARNING: database query execution latency spike detected (7512 ms)\nAug 04 22:46:00 health-check status-monitor[04]: FAILURE: health probe failed on replica group us-east-vpc-b`
      );
    } else if (id === "INC-2026-8912") {
      setRawLogs(
        `Aug 04 18:10:11 sso-portal auth-saml[512]: ERROR: SAML token signing assertion failed - cryptographic signature expired\nAug 04 18:10:20 sso-portal auth-saml[512]: WARNING: re-attempting SAML verification with backup hardware security module (HSM-9)\nAug 04 18:11:02 ingress-gateway nginx[904]: *1104 upstream timed out while executing verification callback on corporate IDP`
      );
    } else {
      setRawLogs(
        `Aug 03 12:00:00 backup-store vault[204]: ERROR: Automated backup serial generation failed - AES-GCM tag mismatch\nAug 03 12:00:15 backup-store vault[204]: SECURITY ALERT: Automated backup rotation halted. Key vault access blocked due to invalid token\nAug 03 12:01:00 core-kernel daemon[12]: Critical operational state dump triggered - system safety halt avoided`
      );
    }
  };

  const handleGeneratePostMortem = async () => {
    setLoading(true);
    setReport("");
    try {
      const response = await fetch("/api/generate-postmortem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: selectedIncident })
      });
      const data = await response.json();
      if (data.success) {
        setReport(data.report);
        setIsFallback(!!data.isFallback);
      } else {
        setReport("Failed to generate report from server endpoint.");
      }
    } catch (e: any) {
      setReport(`Network error generating AI diagnostics: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Simple custom markdown line parser to render output beautifully without adding huge node modules
  const renderMarkdown = (text: string) => {
    return text.split("\n").map((line, idx) => {
      let trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        return <h3 key={idx} className="text-lg font-bold text-slate-900 dark:text-white mt-4 mb-2 border-b border-slate-100 dark:border-[#222] pb-1">{trimmed.replace("# ", "")}</h3>;
      }
      if (trimmed.startsWith("## ")) {
        return <h4 key={idx} className="text-sm font-bold text-blue-500 mt-3 mb-1.5 uppercase tracking-wider">{trimmed.replace("## ", "")}</h4>;
      }
      if (trimmed.startsWith("### ")) {
        return <h5 key={idx} className="text-xs font-bold text-slate-800 dark:text-zinc-200 mt-2 mb-1">{trimmed.replace("### ", "")}</h5>;
      }
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        return <li key={idx} className="text-xs text-slate-600 dark:text-zinc-300 ml-4 list-disc py-0.5 leading-relaxed">{trimmed.substring(2)}</li>;
      }
      if (/^\d+\./.test(trimmed)) {
        return <li key={idx} className="text-xs text-slate-600 dark:text-zinc-300 ml-4 list-decimal py-0.5 leading-relaxed">{trimmed.replace(/^\d+\.\s*/, "")}</li>;
      }
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        return <p key={idx} className="text-xs font-bold text-slate-800 dark:text-zinc-100 my-1">{trimmed.replace(/\*\*/g, "")}</p>;
      }
      if (!trimmed) {
        return <div key={idx} className="h-2" />;
      }
      return <p key={idx} className="text-xs text-slate-600 dark:text-zinc-300 my-1 leading-relaxed">{trimmed}</p>;
    });
  };

  // ==========================================
  // Live Node Engineer Voice Co-Pilot State & Engine
  // ==========================================
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingState, setSpeakingState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [voiceHistory, setVoiceHistory] = useState<VoiceMessage[]>([
    {
      id: "v-init",
      role: "assistant",
      text: "Apex Twin voice link active. Connected to the local audio channel and ready to assist with engineering operations.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const [manualQuestion, setManualQuestion] = useState("");
  const [engineerRole, setEngineerRole] = useState("AUTO");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsEngine, setTtsEngine] = useState<"vits" | "bark">("vits");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");
  const [voicePipeline, setVoicePipeline] = useState<VoicePipelineStatus | null>(null);
  const [lowLatencyMode, setLowLatencyMode] = useState(false);
  const [serverTtsFailed, setServerTtsFailed] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(1.0);
  const voiceRateRef = useRef<number>(1.0);
  const voicePitchRef = useRef<number>(1.0);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [kbSearchQuery, setKbSearchQuery] = useState("");
  const [kbCategoryFilter, setKbCategoryFilter] = useState<"All" | "Routing" | "Security" | "Wireless" | "Core Services">("All");
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const [kbArticles, setKbArticles] = useState<KBArticle[]>([]);
  const [continuousListening, setContinuousListening] = useState(false);
  const selectedVoiceNameRef = useRef<string>("");
  const outputLanguageRef = useRef<OutputLanguage>("en");
  const elevenLabsAudioRef = useRef<HTMLAudioElement | null>(null);

  const recognitionRef = useRef<any>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Pre-loaded cheat questions for easy one-click demo simulation
  const cheatQuestions = [
    {
      label: "Take Up Questions",
      question: "Hey Apex can you takeup the questions"
    },
    {
      label: "Wi-Fi Drops",
      question: "What are the common causes and troubleshooting steps for corporate wireless client drops on Catalyst 9800 controller?"
    },
    {
      label: "STP Loop Storm",
      question: "How do we mitigate a Spanning-Tree topology loop storm in a switch stack?"
    },
    {
      label: "Palo Alto App-ID",
      question: "How do we troubleshoot active session drops or port shifting issues on Palo Alto Networks firewalls?"
    },
    {
      label: "AWS Direct Connect",
      question: "Explain Transit Gateway architecture and how we configure redundant Direct Connect interfaces."
    },
    {
      label: "Azure ExpressRoute",
      question: "How do we troubleshoot high latency across Azure VNet Peering and route traffic via Azure Firewall hub?"
    },
    {
      label: "GCP Cloud Router",
      question: "How does Multi-Chassis Dedicated Interconnect and Shared VPC work in GCP?"
    },
    {
      label: "GlobalProtect Remote Access",
      question: "Why do GlobalProtect remote-access connections experience drops and how do we resolve it?"
    },
    {
      label: "BGP Path Prepend",
      question: "Explain how to steer dual-homed WAN uplink traffic using BGP AS-Path Prepending."
    },
    {
      label: "Zero-Day Criticality",
      question: "What is the criticality of a Zero-Day vulnerability and how should our security teams triage it?"
    },
    {
      label: "Platform ROI",
      question: "What operational values is this platform bringing or what problem is it solving?"
    }
  ];

  // Fetch and Sync backend telemetry knowledge base in real-time
  useEffect(() => {
    const loadTelemetryKB = async () => {
      try {
        const response = await fetch("/api/kb");
        const data = await response.json();
        if (data.success && data.articles) {
          setKbArticles(data.articles);
        } else {
          setKbArticles(KNOWLEDGE_BASE);
        }
      } catch (err) {
        console.warn("Failed to load synced backend telemetry KB, fallback to local:", err);
        setKbArticles(KNOWLEDGE_BASE);
      }
    };
    loadTelemetryKB();
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/voice/readiness")
      .then(async response => ({ response, data: await response.json() as VoicePipelineStatus }))
      .then(({ data }) => { if (active) setVoicePipeline(data); })
      .catch(() => { if (active) setVoicePipeline({ success: false }); });
    return () => { active = false; };
  }, []);

  // Load OS voices
  useEffect(() => {
    if ("speechSynthesis" in window) {
      const loadAllVoices = () => {
        const available = window.speechSynthesis.getVoices();
        setSystemVoices(available);
        const language = outputLanguageRef.current;
        const languageVoices = available.filter(voice => voice.lang.toLowerCase().startsWith(language));
        const selected = available.find(voice => voice.name === selectedVoiceNameRef.current);
        if (!selected || !selected.lang.toLowerCase().startsWith(language)) {
          const preferred = languageVoices.find(voice => /google|natural|microsoft|samantha|zira/i.test(voice.name)) || languageVoices[0] || available[0];
          const name = preferred?.name || "";
          setSelectedVoiceName(name);
          selectedVoiceNameRef.current = name;
        }
      };

      loadAllVoices();
      window.speechSynthesis.onvoiceschanged = loadAllVoices;
    }
  }, []);

  useEffect(() => {
    outputLanguageRef.current = outputLanguage;
    setServerTtsFailed(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const languageVoices = systemVoices.filter(voice => voice.lang.toLowerCase().startsWith(outputLanguage));
    const selected = systemVoices.find(voice => voice.name === selectedVoiceNameRef.current);
    if (!selected || !selected.lang.toLowerCase().startsWith(outputLanguage)) {
      const preferred = languageVoices.find(voice => /google|natural|microsoft|samantha|zira/i.test(voice.name)) || languageVoices[0] || systemVoices[0];
      const name = preferred?.name || "";
      setSelectedVoiceName(name);
      selectedVoiceNameRef.current = name;
    }
  }, [outputLanguage, systemVoices]);

  // Initialize browser speech engine based on continuous listening option
  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (err) {}
    }

    setSpeechSupported(true);
    const rec = new SpeechRecognitionClass();
    rec.continuous = continuousListening;
    rec.interimResults = false;
    rec.lang = "en-US";

    rec.onstart = () => {
      setIsListening(true);
      setSpeakingState("listening");
    };

    rec.onresult = async (event: any) => {
      const resultIndex = event.resultIndex || 0;
      const text = event.results[resultIndex][0].transcript;
      if (text && text.trim() !== "") {
        const cleanText = text.trim();

        if (continuousListening) {
          const command = extractWakeWordCommand(cleanText);
          if (command) {
            const isTakeupRequest = /\b(?:take\s*up|takeup)\b.*\bquestions?\b|\bquestions?\b.*\b(?:take\s*up|takeup)\b/i.test(command);
            handleAskAgent(isTakeupRequest ? "Hey Apex can you takeup the questions" : command);
          } else if (command === "") {
            const wakeResponse = "Yes?";
            setVoiceHistory(prev => [...prev, {
              id: `v-ai-${Date.now()}`,
              role: "assistant",
              text: wakeResponse,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }]);
            speakMessage(wakeResponse);
          }
        } else {
          handleAskAgent(cleanText);
        }
      }
    };

    rec.onerror = (e: any) => {
      console.error("Speech Recognition Error:", e);
      if (!continuousListening) {
        setIsListening(false);
        setSpeakingState("idle");
      }
    };

    rec.onend = () => {
      setIsListening(false);
      setSpeakingState(prev => (prev === "listening" ? "idle" : prev));
      if (continuousListening) {
        // Keep listening in continuous mode
        try {
          rec.start();
        } catch (err) {}
      }
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch (err) {}
    };
  }, [continuousListening]);

  // Scroll timeline when logs change
  useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [voiceHistory, speakingState]);

  // Handle voice synthesis (TTS with premium Google Cloud TTS / ElevenLabs and browser fallback)
  const speakMessage = async (text: string) => {
    if (!ttsEnabled) {
      setSpeakingState("idle");
      return;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (elevenLabsAudioRef.current) {
      elevenLabsAudioRef.current.pause();
      elevenLabsAudioRef.current = null;
    }

    // Direct client-side engine bypass when in low latency mode or if server-side TTS previously failed.
    if (lowLatencyMode || serverTtsFailed) {
      speakNativeFallback(text);
      return;
    }

    setSpeakingState("thinking");

    const endpoint = ttsEngine === "bark" ? "/api/node-engineer/bark-synthesize" : "/api/node-engineer/vits-synthesize";
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ttsEngine === "bark" ? 120_000 : 45_000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: outputLanguageRef.current }),
        signal: controller.signal
      });
      const data = await response.json();
      
      if (data.success && data.audio) {
        const audio = new Audio(data.audio);
        elevenLabsAudioRef.current = audio;
        
        audio.onplay = () => {
          setSpeakingState("speaking");
        };
        audio.onended = () => {
          setSpeakingState("idle");
          elevenLabsAudioRef.current = null;
        };
        audio.onerror = () => {
          setSpeakingState("idle");
          elevenLabsAudioRef.current = null;
          setServerTtsFailed(true); // Flag server failure to instantly bypass next time
          speakNativeFallback(text);
        };

        await audio.play();
        return;
      } else {
        console.warn(`${ttsEngine} returned unsuccessful:`, data.reason || "unknown reason");
        setServerTtsFailed(true); // Flag server failure to instantly bypass next time
      }
    } catch (err) {
      console.warn(`${ttsEngine} synthesis failed. Falling back to tuned browser speech engine:`, err);
      setServerTtsFailed(true); // Flag server failure to instantly bypass next time
    } finally {
      window.clearTimeout(timeoutId);
    }

    speakNativeFallback(text);
  };

  const speakNativeFallback = (text: string) => {
    if (!("speechSynthesis" in window)) {
      setSpeakingState("idle");
      return;
    }

    const cleanText = text
      .replace(/[\*\#\`]/g, "")
      .replace(/SLA/g, "S L A")
      .replace(/WLC/g, "W L C")
      .replace(/CAPWAP/g, "cap-wap")
      .replace(/CCIE/g, "C C I E")
      .replace(/BGP/g, "B G P")
      .replace(/STP/g, "S T P")
      .replace(/VLAN/g, "v-lan")
      .replace(/LACP/g, "L A C P")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = voiceRateRef.current;
    utterance.pitch = voicePitchRef.current;
    const language = outputLanguageRef.current;
    const languageConfig = outputLanguages.find(item => item.code === language) || outputLanguages[0];
    utterance.lang = languageConfig.speechTag;

    const voices = window.speechSynthesis.getVoices();
    const matchingVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith(language));
    const selectedVoice = voices.find(voice => voice.name === selectedVoiceNameRef.current);
    const chosenVoice = (selectedVoice?.lang.toLowerCase().startsWith(language) ? selectedVoice : undefined) ||
      matchingVoices.find(voice => /google|natural|microsoft|samantha|zira/i.test(voice.name)) || matchingVoices[0] || selectedVoice || voices[0];

    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    utterance.onstart = () => setSpeakingState("speaking");
    utterance.onend = () => setSpeakingState("idle");
    utterance.onerror = () => setSpeakingState("idle");

    window.speechSynthesis.speak(utterance);
  };

  // Submit questions to server agent
  const handleAskAgent = async (question: string) => {
    if (!question.trim()) return;

    setSpeakingState("thinking");
    const newUserMsg: VoiceMessage = {
      id: `v-user-${Date.now()}`,
      role: "user",
      text: question,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    setVoiceHistory(prev => [...prev, newUserMsg]);

    // 1. Client-side instant Greeting Phase check to guarantee zero hallucination
    const cleanQ = question.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ");
    const isConversationalGreeting = cleanQ.length <= 120 && (
      /\bhow are you(?: doing)?(?: today)?$/.test(cleanQ) ||
      /\bhow is it going(?: today)?$/.test(cleanQ) ||
      /^(?:(?:so|well|okay|ok|hey apex|apex|hi|hello|hey|howdy|hola|good morning|good afternoon|good evening)\s*)+$/.test(cleanQ)
    );
    if (isConversationalGreeting) {
      const greetingResponse = cleanQ.includes("how are you") ? "I'm ready and listening. What would you like help with?" : "Hello. What would you like help with?";
      const newAiMsg: VoiceMessage = {
        id: `v-ai-${Date.now()}`,
        role: "assistant",
        text: greetingResponse,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      setVoiceHistory(prev => [...prev, newAiMsg]);
      speakMessage(greetingResponse);
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 35_000);
      const requestBody = {
        userQuestion: question,
        engineerRole,
        conversationContext: voiceHistory.slice(-6).map(({ role, text }) => ({ role, text })),
        ...(isIncidentQuestion(question) ? { incidentId: selectedIncident } : {})
      };
      const response = await fetch("/api/node-engineer/voice-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
      const data = await response.json() as VoiceResponse;
      if (response.ok && data.success && typeof data.text === "string") {
        const aiResponse = data.text;
        const groundingStatus = data.groundingStatus === "GROUNDED" || data.groundingStatus === "PARTIAL" || data.groundingStatus === "ABSTAINED"
          ? data.groundingStatus
          : undefined;
        const citations = Array.isArray(data.citations)
          ? data.citations.map(formatGroundingCitation).filter((citation): citation is string => citation !== null)
          : undefined;
        const limitations = Array.isArray(data.limitations)
          ? data.limitations.filter((limitation): limitation is string => typeof limitation === "string")
          : undefined;
        const newAiMsg: VoiceMessage = {
          id: `v-ai-${Date.now()}`,
          role: "assistant",
          text: aiResponse,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          groundingStatus,
          citations,
          limitations
        };
        setVoiceHistory(prev => [...prev, newAiMsg]);
        speakMessage(aiResponse);
      } else {
        throw new Error("Invalid server answer");
      }
    } catch (e) {
      console.error(e);
      const errAiMsg: VoiceMessage = {
        id: `v-ai-err-${Date.now()}`,
        role: "assistant",
        text: e instanceof DOMException && e.name === "AbortError"
          ? "The local model did not answer within 35 seconds. I stopped this request so the co-pilot remains responsive. Please retry with the affected system, time window, and one relevant log or incident ID."
          : "The co-pilot could not complete that response. Please retry with the affected system, time window, and one relevant log or incident ID.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      setVoiceHistory(prev => [...prev, errAiMsg]);
      speakMessage(errAiMsg.text);
    }
  };

  const toggleListen = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (elevenLabsAudioRef.current) {
        elevenLabsAudioRef.current.pause();
        elevenLabsAudioRef.current = null;
      }
      try {
        recognitionRef.current.start();
      } catch (err) {}
    }
  };

  // Force stop speaking loop
  const handleMuteSpeaker = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (elevenLabsAudioRef.current) {
      elevenLabsAudioRef.current.pause();
      elevenLabsAudioRef.current = null;
    }
    setSpeakingState("idle");
  };

  const selectedLanguage = outputLanguages.find(item => item.code === outputLanguage) || outputLanguages[0];
  const matchingBrowserVoices = systemVoices.filter(voice => voice.lang.toLowerCase().startsWith(outputLanguage));
  const orderedBrowserVoices = [...systemVoices].sort((left, right) => Number(right.lang.toLowerCase().startsWith(outputLanguage)) - Number(left.lang.toLowerCase().startsWith(outputLanguage)) || left.name.localeCompare(right.name));
  const selectedBrowserVoice = systemVoices.find(voice => voice.name === selectedVoiceName);
  const browserVoiceMatchesLanguage = Boolean(selectedBrowserVoice?.lang.toLowerCase().startsWith(outputLanguage));

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50 dark:bg-[#050505] text-slate-800 dark:text-[#e0e0e0] transition-colors duration-200 h-screen flex flex-col space-y-6">
      
      {/* Tab Selector Ribbon */}
      <div className="flex flex-col 2xl:flex-row justify-between items-start 2xl:items-center bg-white dark:bg-[#0d0d0d] p-4 rounded border border-slate-200 dark:border-[#222] shadow-sm gap-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/10">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">AI Digital Twins Workspace</h2>
              <span className="px-2 py-0.5 text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 rounded-full border border-indigo-200/40 dark:border-indigo-800/30 font-mono">CCIE ENGINE ARMORED</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Toggle between log post-mortem analysis and real-time voice guidance for Screenshares & Teams briefings.</p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-[#151515] p-1 rounded border border-slate-200 dark:border-zinc-800 self-stretch 2xl:self-auto">
          <button
            onClick={() => setActiveSubTab("fleet")}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeSubTab === "fleet"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> {workspaceAgents.length}-Department Twins
          </button>
          <button
            onClick={() => setActiveSubTab("voice-copilot")}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeSubTab === "voice-copilot"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
            }`}
          >
            <Mic className="w-3.5 h-3.5" /> Live Voice Co-Pilot
          </button>
          <button
            onClick={() => setActiveSubTab("diagnostics")}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeSubTab === "diagnostics"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" /> SRE Log Diagnostics
          </button>
          <button onClick={() => { setActivityRole(""); setActiveSubTab("activity"); }} className={`flex-1 md:flex-none px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${activeSubTab === "activity" ? "bg-indigo-600 text-white shadow" : "text-slate-600 dark:text-zinc-400 hover:text-indigo-500"}`}><Activity className="w-3.5 h-3.5" />Activity & reviews</button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {activeSubTab === "activity" && <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><TwinObservabilityPanel initialRole={activityRole} /></motion.div>}
          
          {/* ==========================================
              SUB-TAB: DEPARTMENT DIGITAL TWINS FLEET
              ========================================== */}
          {activeSubTab === "fleet" && (
            <motion.div
              key="fleet"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              <div className="bg-white dark:bg-[#0d0d0d] p-5 rounded-2xl border border-slate-200 dark:border-[#222] shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Federated Multi-Department Digital Twins Roster
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                      Each infrastructure department operates a dedicated digital twin agent with live telemetry reflection, automated diagnostic runbooks, and inter-agent A2A message routing.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {availableTwinCount} Twins Available
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {workspaceAgents.map((agent) => (
                  <div 
                    key={agent.id}
                    className="bg-white dark:bg-[#0d0d0d] rounded-2xl border border-slate-200 dark:border-[#222] p-5 shadow-sm space-y-4 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            {agent.department || "Enterprise"} Team
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {agent.id}
                          </span>
                        </div>
                        <h4 className="text-base font-bold text-slate-900 dark:text-white">
                          {agent.name}
                        </h4>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        agent.status === "RUNNING"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/30"
                          : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {agent.status === "RUNNING" ? "INVESTIGATING" : agent.status === "IDLE" ? "MONITORING" : agent.status.replaceAll("_", " ")}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed min-h-[36px]">
                      {agent.specialty || agent.role}
                    </p>

                    <div className="p-3 bg-slate-50 dark:bg-[#141414] rounded-xl border border-slate-200 dark:border-[#222] space-y-2 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider block">
                          Current Active Task
                        </span>
                        <p className="font-mono text-slate-800 dark:text-zinc-200 text-[11px] truncate">
                          {agent.currentTask || "Monitoring domain telemetry and incident signals"}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-200 dark:border-[#222]">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider block mb-1">
                          Connected Operational Systems
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(agent.systemConnected || []).map((sys, idx) => (
                            <span 
                              key={idx}
                              className="px-2 py-0.5 text-[10px] font-mono font-medium rounded bg-white dark:bg-black/50 border border-slate-200 dark:border-[#333] text-slate-700 dark:text-zinc-300"
                            >
                              {sys}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-[#1a1a1a] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400 dark:text-zinc-500 font-mono text-[11px]">
                        Recorded tasks: <strong className="text-slate-700 dark:text-zinc-300">{agent.tasksCompleted}</strong>
                      </span>
                      <div className="flex items-center gap-3">
                        <button onClick={() => { const role = (agent.department || agent.role || "OTHER").toUpperCase(); setActivityRole(["NETWORK", "WINDOWS", "LINUX", "CLOUDOPS", "DEVOPS", "SECURITY", "DATABASE", "MIDDLEWARE"].includes(role) ? role : "OTHER"); setActiveSubTab("activity"); }} className="text-slate-600 dark:text-zinc-300 text-[11px] font-semibold hover:underline focus:ring-2 focus:ring-indigo-500">Activity</button>
                        <button onClick={() => onOpenTwin(workspaceId(agent))} className="inline-flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 text-[11px] font-bold hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-400">Open workspace <ExternalLink className="w-3 h-3"/></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ==========================================
              SUB-TAB: VOICE CO-PILOT (Live Interactive)
              ========================================== */}
          {activeSubTab === "voice-copilot" && (
            <motion.div
              key="voice-copilot"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0 items-stretch"
            >
              
              {/* Left Column: Voice Engine Controls & Status Dashboard (5 Cols) */}
              <div className="lg:col-span-5 flex flex-col space-y-6">
                
                {/* Voice Status Card with Pulse Waveform */}
                <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] p-5 shadow-sm flex flex-col items-center justify-center text-center relative overflow-hidden">
                  
                  {/* Subtle Background Net Grid */}
                  <div className="absolute inset-0 bg-grid-slate-100 dark:bg-grid-[#222]/10 [mask-image:linear-gradient(0deg,transparent,white)] pointer-events-none opacity-40" />

                  <span className="absolute top-4 right-4 inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-widest border border-indigo-200/40 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400">
                    <Video className="w-3 h-3 animate-pulse" /> Active Teams Bridge Mode
                  </span>

                  {/* Robot Head / Avatar Icon with Interactive Glowing Circles */}
                  <div className="relative z-10 my-6">
                    <div className={`absolute -inset-4 rounded-full blur-xl opacity-30 transition-all duration-500 ${
                      speakingState === "listening" 
                        ? "bg-rose-500 animate-pulse" 
                        : speakingState === "thinking"
                        ? "bg-amber-400 animate-spin-slow"
                        : speakingState === "speaking"
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-indigo-500"
                    }`} />
                    
                    <div className={`w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-300 relative bg-slate-900 ${
                      speakingState === "listening"
                        ? "border-rose-500 ring-4 ring-rose-500/20 shadow-lg shadow-rose-500/15"
                        : speakingState === "thinking"
                        ? "border-amber-400 ring-4 ring-amber-400/20 shadow-lg shadow-amber-400/15"
                        : speakingState === "speaking"
                        ? "border-emerald-500 ring-4 ring-emerald-500/20 shadow-lg shadow-emerald-500/15"
                        : "border-indigo-600"
                    }`}>
                      {speakingState === "listening" ? (
                        <Mic className="w-8 h-8 text-rose-500 animate-pulse" />
                      ) : speakingState === "thinking" ? (
                        <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                      ) : speakingState === "speaking" ? (
                        <Volume2 className="w-8 h-8 text-emerald-400" />
                      ) : (
                        <Bot className="w-8 h-8 text-indigo-400" />
                      )}
                    </div>
                  </div>

                  {/* AI Copilot Description */}
                  <div className="z-10 space-y-1">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                      Apex Twin (Engineering Copilot)
                    </h3>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Practical help across network, Windows, cloud, DevOps and Linux operations. Say "Hey Apex" to begin.
                    </p>
                    <label className="block text-xs text-slate-400 pt-2">
                      Engineering role
                      <select aria-label="Engineering role" value={engineerRole} onChange={event => setEngineerRole(event.target.value)} className="block w-full mt-1 rounded border border-slate-500 bg-white dark:bg-zinc-900 p-2 text-slate-900 dark:text-white">
                        <option value="AUTO">Auto-select from the conversation</option>
                        <option value="NETWORK">Network engineer</option>
                        <option value="WINDOWS">Windows administrator</option>
                        <option value="CLOUDOPS">CloudOps engineer</option>
                        <option value="DEVOPS">DevOps engineer</option>
                        <option value="LINUX">Linux engineer</option>
                        <option value="SECURITY">Security engineer</option>
                        <option value="DATABASE">Database engineer</option>
                      </select>
                    </label>
                  </div>

                  {/* Glowing Waveform Visualization */}
                  <div className="w-full h-12 flex items-center justify-center gap-[4px] mt-6 z-10 px-8">
                    {[...Array(24)].map((_, idx) => {
                      // Determine amplitude based on status to simulate high fidelity voice modulation
                      let heightClass = "h-1";
                      let bgClass = "bg-slate-300 dark:bg-zinc-800";
                      
                      if (speakingState === "listening") {
                        const randomHeight = Math.floor(Math.random() * 24) + 8;
                        heightClass = `h-[${randomHeight}px]`;
                        bgClass = "bg-rose-500";
                      } else if (speakingState === "thinking") {
                        const waveHeight = Math.sin((idx + Date.now()/150) * 0.8) * 12 + 16;
                        heightClass = `h-[${Math.max(4, Math.floor(waveHeight))}px]`;
                        bgClass = "bg-amber-400";
                      } else if (speakingState === "speaking") {
                        const waveHeight = Math.abs(Math.sin(idx * 0.5 + Date.now()/100)) * 40 + 6;
                        heightClass = `h-[${Math.floor(waveHeight)}px]`;
                        bgClass = "bg-emerald-500";
                      } else {
                        // flat line or tiny static
                        heightClass = idx % 4 === 0 ? "h-[3px]" : "h-[2px]";
                      }

                      return (
                        <div
                          key={idx}
                          className={`w-[4px] rounded-full transition-all duration-150 ${bgClass}`}
                          style={{
                            height: speakingState === "idle" ? undefined : heightClass.replace("h-[", "").replace("px]", "") + "px"
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Current Active Status Message */}
                  <div className="mt-4 text-xs font-bold uppercase tracking-wider">
                    {speakingState === "listening" && <span className="text-rose-500 animate-pulse">LISTENING ON MICROPHONE...</span>}
                    {speakingState === "thinking" && <span className="text-amber-500 animate-pulse">{twinLabel(engineerRole)} is preparing a response...</span>}
                    {speakingState === "speaking" && <span className="text-emerald-500 animate-pulse">SPEAKING OUT LOUD TO SPEAKER OUT</span>}
                    {speakingState === "idle" && <span className="text-slate-400">STANDBY • READY FOR QUESTIONS</span>}
                  </div>

                  {/* Main Action Vocal Capture Button */}
                  <div className="w-full mt-6 grid grid-cols-1 gap-2 shrink-0 z-10">
                    {speechSupported ? (
                      <button
                        onClick={toggleListen}
                        className={`w-full py-3 rounded text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                          isListening
                            ? "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20 border border-transparent"
                            : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20 border border-transparent"
                        }`}
                      >
                        {isListening ? (
                          <>
                            <MicOff className="w-4 h-4 animate-pulse" /> Stop Listening
                          </>
                        ) : (
                          <>
                            <Mic className="w-4 h-4 animate-ping" /> Push To Talk (Activate Mic)
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded text-[10px] text-rose-500 font-bold leading-relaxed">
                        ⚠️ Browsers with restricted framing permissions or missing Speech SDK cannot stream local microphones. Please use the Manual keyboard input panel or one-click Simulations below.
                      </div>
                    )}

                    {speakingState === "speaking" && (
                      <button
                        onClick={handleMuteSpeaker}
                        className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#222] border border-slate-200 dark:border-[#333] rounded text-[10px] font-bold text-slate-600 dark:text-zinc-400 flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase"
                      >
                        <VolumeX className="w-3.5 h-3.5 text-rose-500" /> Interrupt Speaking
                      </button>
                    )}
                  </div>
                </div>

                {/* Speech Synthesis Settings Card */}
                <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-[#222]">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-500" />
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Audio Output & Natural Voice Calibration</h4>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex items-center justify-between bg-slate-50 dark:bg-[#060606] p-2.5 rounded border border-slate-200/50 dark:border-[#1e1e1e] cursor-pointer select-none">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                            Read Aloud (TTS)
                          </span>
                          <span className="text-[9px] text-slate-400">Speak answers automatically</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={ttsEnabled}
                          onChange={(e) => setTtsEnabled(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded focus:ring-indigo-500 dark:bg-[#1a1a1a] dark:border-[#333]"
                        />
                      </label>

                      <label className="flex items-center justify-between bg-slate-50 dark:bg-[#060606] p-2.5 rounded border border-slate-200/50 dark:border-[#1e1e1e] cursor-pointer select-none">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                            Hotword Wakeup
                          </span>
                          <span className="text-[9px] text-slate-400">Trigger on "Hey Apex"</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={continuousListening}
                          onChange={(e) => setContinuousListening(e.target.checked)}
                          className="w-4 h-4 text-rose-600 bg-slate-100 border-slate-300 rounded focus:ring-rose-500 dark:bg-[#1a1a1a] dark:border-[#333]"
                        />
                      </label>

                      <label className="flex items-center justify-between bg-slate-50 dark:bg-[#060606] p-2.5 rounded border border-slate-200/50 dark:border-[#1e1e1e] cursor-pointer select-none">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                            Zero-Lag Speech <span className="text-[8px] bg-emerald-100 dark:bg-emerald-950 text-emerald-600 px-1 py-0.2 rounded font-mono">FAST</span>
                          </span>
                          <span className="text-[9px] text-slate-400">Instant client fallback playback</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={lowLatencyMode}
                          onChange={(e) => setLowLatencyMode(e.target.checked)}
                          className="w-4 h-4 text-emerald-600 bg-slate-100 border-slate-300 rounded focus:ring-emerald-500 dark:bg-[#1a1a1a] dark:border-[#333]"
                        />
                      </label>
                    </div>

                    <div className="p-3 bg-emerald-500/5 border border-emerald-200/30 dark:border-emerald-900/40 rounded space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Cpu className="w-3 h-3" /> Separate local model pipeline</span>
                        <span className={`text-[8px] font-mono font-bold ${voicePipeline?.success ? "text-emerald-500" : "text-amber-500"}`}>{voicePipeline?.success ? "READY" : "CHECKING"}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1 text-[9px] text-slate-500 dark:text-zinc-400">
                        <p><strong className="text-slate-700 dark:text-zinc-200">Reasoning:</strong> {voicePipeline?.pipeline?.reasoning?.model || "local engineering model"} via Ollama</p>
                        <p><strong className="text-slate-700 dark:text-zinc-200">Speech input:</strong> browser recognition; Whisper {voicePipeline?.pipeline?.transcription?.model || "base"} is available in cloudzero-speech for uploaded incident audio</p>
                        <p><strong className="text-slate-700 dark:text-zinc-200">Speech output:</strong> {ttsEngine === "bark" ? (voicePipeline?.pipeline?.synthesis?.conversationalModel || "Bark Small") : (voicePipeline?.pipeline?.synthesis?.defaultModel || "Coqui VITS")} in cloudzero-speech · {selectedLanguage.label}</p>
                      </div>
                    </div>

                    <div className="rounded border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/25">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                        Output language
                        <select
                          value={outputLanguage}
                          onChange={(event) => { const language = event.target.value as OutputLanguage; outputLanguageRef.current = language; setOutputLanguage(language); setServerTtsFailed(false); }}
                          className="mt-1.5 block w-full rounded border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-800 dark:bg-[#08111f] dark:text-white"
                        >
                          {outputLanguages.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
                        </select>
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] leading-relaxed text-slate-600 dark:text-zinc-300">
                        <span className="rounded bg-indigo-100 px-2 py-1 font-bold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200">Speaking: {selectedLanguage.label}</span>
                        <span>Server synthesis automatically translates the English Twin response before generating audio.</span>
                      </div>
                      <p className={`mt-2 text-[9px] ${matchingBrowserVoices.length ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                        {matchingBrowserVoices.length ? `${matchingBrowserVoices.length} installed browser voice${matchingBrowserVoices.length === 1 ? "" : "s"} match ${selectedLanguage.label}.` : `No installed browser voice matches ${selectedLanguage.label}. If server synthesis is unavailable, the browser will use ${selectedBrowserVoice?.name || "its default voice"} and read the original response without translation.`}
                      </p>
                    </div>

                    <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono">
                      Speech output model
                      <select
                        value={ttsEngine}
                        onChange={(event) => { setTtsEngine(event.target.value as "vits" | "bark"); setServerTtsFailed(false); }}
                        className="block w-full mt-1 bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-200 rounded py-2 px-3 text-[11px] font-mono border border-slate-200 dark:border-[#333]"
                      >
                        <option value="vits">Coqui VITS · fast local voice (recommended)</option>
                        <option value="bark">Bark Small · expressive voice (slower on CPU)</option>
                      </select>
                    </label>

                    {/* Human Voice Profile Dropdown */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono">
                          Select Realistic Voice Model
                        </label>
                        <button
                          type="button"
                          onClick={() => speakMessage("Voice link verified. Apex Twin is calibrated and ready.")}
                          className="text-[9px] font-bold text-indigo-500 hover:text-indigo-400 transition-colors uppercase font-mono tracking-wider flex items-center gap-1"
                        >
                          ⚡ Test Voice Profile
                        </button>
                      </div>
                      <select
                        value={selectedVoiceName}
                        onChange={(e) => {
                          setSelectedVoiceName(e.target.value);
                          selectedVoiceNameRef.current = e.target.value;
                        }}
                        className="w-full bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-200 rounded py-2 px-3 text-[11px] font-mono border border-slate-200 dark:border-[#333] focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                      >
                        {!orderedBrowserVoices.length && <option value="">Browser default voice</option>}
                        {orderedBrowserVoices.map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name} ({v.lang}) {v.localService ? "• Local Human Engine" : ""}
                          </option>
                        ))}
                      </select>
                      <p className="text-[9px] text-slate-400 font-medium">Browser fallback for {selectedLanguage.label}: {selectedBrowserVoice ? `${selectedBrowserVoice.name} (${selectedBrowserVoice.lang})` : "system default"}. Matching voices are listed first.</p>
                      {!browserVoiceMatchesLanguage && selectedBrowserVoice && <p className="text-[9px] font-medium text-amber-700 dark:text-amber-300">Transparent fallback: this installed voice does not match {selectedLanguage.label}; pronunciation may differ and browser fallback reads the original response without translation.</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Speech Rate */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase font-mono">
                          <span>Voice Speed</span>
                          <span className="text-indigo-500">{voiceRate}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.8"
                          max="1.4"
                          step="0.05"
                          value={voiceRate}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setVoiceRate(val);
                            voiceRateRef.current = val;
                          }}
                          className="w-full accent-indigo-500 h-1 bg-slate-100 dark:bg-zinc-800 rounded-lg cursor-pointer"
                        />
                      </div>

                      {/* Voice Pitch */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase font-mono">
                          <span>Vocal Pitch</span>
                          <span className="text-indigo-500">{voicePitch}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.8"
                          max="1.2"
                          step="0.05"
                          value={voicePitch}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setVoicePitch(val);
                            voicePitchRef.current = val;
                          }}
                          className="w-full accent-indigo-500 h-1 bg-slate-100 dark:bg-zinc-800 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Searchable FAQ / Deterministic Knowledge Base Component */}
                <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-[#222]">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-500 animate-pulse" />
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                        SME Deterministic Knowledge Base
                      </h4>
                    </div>
                    <span className="text-[8px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono font-bold tracking-wider">
                      ZERO HALLUCINATION
                    </span>
                  </div>

                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                    Apex Twin references this Knowledge Base deterministically before contacting the LLM. Search, expand, or instantly trigger voice playbacks for standard Cisco/Palo Alto operational procedures.
                  </p>

                  {/* Search input field */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="text"
                      placeholder="Search DNS, DHCP, ASA firewall, VLAN, Wi-Fi..."
                      value={kbSearchQuery}
                      onChange={(e) => setKbSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-200 rounded pl-8 pr-8 py-1.5 text-xs border border-slate-200 dark:border-[#333] focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                    {kbSearchQuery && (
                      <button
                        onClick={() => setKbSearchQuery("")}
                        className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-100 text-[10px] font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Category filters */}
                  <div className="flex flex-wrap gap-1">
                    {(["All", "Routing", "Security", "Wireless", "Core Services"] as const).map((cat) => {
                      const isActive = kbCategoryFilter === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => setKbCategoryFilter(cat)}
                          className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all cursor-pointer ${
                            isActive
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                              : "bg-slate-50 dark:bg-zinc-900 border-slate-100 dark:border-[#222] text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>

                  {/* Articles list */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {kbArticles.filter(art => {
                      const matchesCat = kbCategoryFilter === "All" || art.category === kbCategoryFilter;
                      const matchesQuery = art.title.toLowerCase().includes(kbSearchQuery.toLowerCase()) ||
                                           art.procedure.toLowerCase().includes(kbSearchQuery.toLowerCase()) ||
                                           art.keywords.some(kw => kw.toLowerCase().includes(kbSearchQuery.toLowerCase()));
                      return matchesCat && matchesQuery;
                    }).map((art) => {
                      const isExpanded = expandedArticleId === art.id;
                      return (
                        <div
                          key={art.id}
                          className="border border-slate-100 dark:border-[#222] rounded bg-slate-50/50 dark:bg-[#070707] overflow-hidden"
                        >
                          <button
                            onClick={() => setExpandedArticleId(isExpanded ? null : art.id)}
                            className="w-full px-3 py-2 text-left flex justify-between items-center hover:bg-slate-100/50 dark:hover:bg-[#111] transition-colors cursor-pointer"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                  art.category === "Security" ? "bg-rose-500/10 text-rose-500" :
                                  art.category === "Routing" ? "bg-blue-500/10 text-blue-500" :
                                  art.category === "Wireless" ? "bg-purple-500/10 text-purple-500" :
                                  "bg-teal-500/10 text-teal-400"
                                }`}>
                                  {art.category}
                                </span>
                              </div>
                              <h5 className="text-[11px] font-bold text-slate-800 dark:text-zinc-200 truncate font-mono">
                                {art.title}
                              </h5>
                            </div>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-[#1e1e1e] space-y-2.5">
                              <p className="text-[10px] text-slate-400 dark:text-zinc-300 leading-relaxed font-mono whitespace-pre-wrap">
                                {art.procedure}
                              </p>
                              
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => {
                                    const mockMsg: VoiceMessage = {
                                      id: `v-ai-${Date.now()}`,
                                      role: "assistant",
                                      text: `[DETERMINISTIC KB: ${art.title}]\n${art.procedure}`,
                                      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                    };
                                    setVoiceHistory(prev => [...prev, mockMsg]);
                                    speakMessage(art.procedure);
                                  }}
                                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Volume2 className="w-3 h-3" /> Speak Out Loud
                                </button>
                                <button
                                  onClick={() => {
                                    handleAskAgent(art.keywords[0]);
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-[#333] text-slate-700 dark:text-zinc-300 rounded text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Play className="w-3 h-3" /> Trigger Copilot
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {kbArticles.filter(art => {
                      const matchesCat = kbCategoryFilter === "All" || art.category === kbCategoryFilter;
                      const matchesQuery = art.title.toLowerCase().includes(kbSearchQuery.toLowerCase()) ||
                                           art.procedure.toLowerCase().includes(kbSearchQuery.toLowerCase()) ||
                                           art.keywords.some(kw => kw.toLowerCase().includes(kbSearchQuery.toLowerCase()));
                      return matchesCat && matchesQuery;
                    }).length === 0 && (
                      <div className="p-4 text-center border border-dashed border-slate-200 dark:border-[#222] rounded text-[10px] text-slate-400">
                        No deterministic procedures found. Try searching for "DNS", "DHCP", "ASA", or "STP".
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Right Column: Simulated Questions (Cheat Sheet) & Vocal Transcript Terminal Logs (7 Cols) */}
              <div className="lg:col-span-7 flex flex-col space-y-6 h-full min-h-0">
                
                {/* One-Click QA Simulations (The Perfect Screen-Share Safeguard!) */}
                <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] p-5 shadow-sm space-y-3 shrink-0">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100 dark:border-[#222]">
                    <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Demo Cheat Sheet: One-Click Simulated QA
                    </h4>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                    <strong>Delivery Manager Safeguard:</strong> If they ask any of these standard tough questions, click a chip below. The system will type it instantly, query the CCIE Twin, and speak the flawless answer aloud. No microphone required!
                  </p>
                  
                  <div className="flex flex-wrap gap-2 pt-1">
                    {cheatQuestions.map((cq, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          if (speakingState === "thinking") return;
                          handleAskAgent(cq.question);
                        }}
                        disabled={speakingState === "thinking"}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-500 hover:text-white dark:bg-[#1a1a1a] dark:hover:bg-indigo-600 dark:text-zinc-300 rounded border border-slate-200 dark:border-[#2b2b2b] text-[10px] font-bold tracking-wide transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        title={cq.question}
                      >
                        <Play className="w-3 h-3 shrink-0 text-indigo-500 hover:text-white" />
                        {cq.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vocal Interactive Transcript Feed */}
                <div className="bg-[#0b0c10] rounded border border-slate-200 dark:border-[#1a1c23] shadow-lg flex-1 flex flex-col overflow-hidden min-h-[300px]">
                  
                  {/* Terminal Header */}
                  <div className="bg-slate-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-300 font-mono tracking-wider ml-1.5">
                        APEX-CO-PILOT-FEED_STREAM.log
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[8px] font-mono text-indigo-400 font-bold bg-indigo-950/50 px-2 py-0.5 rounded border border-indigo-900/40">
                      <Activity className="w-2.5 h-2.5 animate-pulse" /> MIC SYNC FEED
                    </div>
                  </div>

                  {/* Transcript Scroll Container */}
                  <div className="flex-1 p-5 overflow-y-auto space-y-4 font-mono text-[11px] select-text">
                    
                    {voiceHistory.map((vMsg) => {
                      const isUser = vMsg.role === "user";
                      return (
                        <div 
                          key={vMsg.id}
                          className={`flex items-start gap-3 p-3.5 rounded border transition-all ${
                            isUser
                              ? "bg-slate-950/80 border-[#333]/30 ml-8 text-indigo-300"
                              : "bg-[#111625] border-indigo-950/40 mr-8 text-emerald-400"
                          }`}
                        >
                          {/* Chat Avatar Bullet */}
                          <div className={`p-1 rounded shrink-0 ${isUser ? "bg-indigo-950/80 text-indigo-400" : "bg-emerald-950/80 text-emerald-400"}`}>
                            {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                          </div>

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex justify-between items-center text-[9px] font-black uppercase text-slate-500">
                              <span>{isUser ? "HUMAN PRESENTER" : "APEX NETWORK TWIN"}</span>
                              <span>{vMsg.timestamp}</span>
                            </div>
                            <p className="whitespace-pre-wrap leading-relaxed select-text">
                              {vMsg.text}
                            </p>

                            {!isUser && (vMsg.groundingStatus || vMsg.citations?.length || vMsg.limitations?.length) && (
                              <div className="mt-2 space-y-1 border-t border-[#2b3550] pt-2 text-[9px] leading-relaxed text-zinc-400">
                                {vMsg.groundingStatus && (
                                  <span className="inline-flex rounded border border-indigo-900/60 bg-indigo-950/50 px-1.5 py-0.5 font-bold text-indigo-300">
                                    GROUNDING: {vMsg.groundingStatus}
                                  </span>
                                )}
                                {vMsg.citations && vMsg.citations.length > 0 && (
                                  <p>
                                    Sources: {vMsg.citations.slice(0, 3).join(" | ")}
                                    {vMsg.citations.length > 3 ? ` | +${vMsg.citations.length - 3} more` : ""}
                                  </p>
                                )}
                                {vMsg.limitations && vMsg.limitations.length > 0 && (
                                  <p className="text-amber-300/80">
                                    Limits: {vMsg.limitations.slice(0, 2).join(" | ")}
                                    {vMsg.limitations.length > 2 ? ` | +${vMsg.limitations.length - 2} more` : ""}
                                  </p>
                                )}
                              </div>
                            )}

                            {!isUser && (
                              <button
                                onClick={() => speakMessage(vMsg.text)}
                                className="mt-2.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1c2336] text-[9px] text-zinc-400 hover:text-white border border-[#2b3550] transition-colors cursor-pointer uppercase"
                              >
                                <Volume2 className="w-3 h-3" /> Re-play Voice Audio
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {speakingState === "thinking" && (
                      <div className="flex items-center gap-2 p-3 bg-slate-900/40 border border-[#222]/30 text-amber-400 rounded max-w-sm">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span className="animate-pulse">{twinLabel(engineerRole)} is preparing an evidence-aware response...</span>
                      </div>
                    )}

                    <div ref={historyEndRef} />
                  </div>

                  {/* Manual Keyboard Query Panel */}
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!manualQuestion.trim() || speakingState === "thinking") return;
                      handleAskAgent(manualQuestion);
                      setManualQuestion("");
                    }}
                    className="p-4 bg-slate-900 border-t border-zinc-800 flex gap-2 shrink-0"
                  >
                    <input
                      type="text"
                      value={manualQuestion}
                      onChange={(e) => setManualQuestion(e.target.value)}
                      placeholder="Type a tough Cisco or wireless operations question to compile answer..."
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded py-2 px-3 text-[11px] font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 select-text"
                      disabled={speakingState === "thinking"}
                    />
                    <button
                      type="submit"
                      disabled={!manualQuestion.trim() || speakingState === "thinking"}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded text-xs font-bold font-mono transition-all flex items-center gap-1 cursor-pointer border border-transparent shrink-0"
                    >
                      <Send className="w-3 h-3" /> ASK
                    </button>
                  </form>

                </div>

                {/* Preparation checklist for delivery manager call */}
                <div className="bg-[#eff6ff] dark:bg-blue-950/10 rounded border border-blue-100 dark:border-blue-900/30 p-4 shrink-0 flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5 animate-bounce" />
                  <div className="space-y-1 text-slate-600 dark:text-zinc-300 text-[11px] leading-normal">
                    <p className="font-bold text-slate-800 dark:text-zinc-200">How to use this during your screenshare Teams call:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Ensure your browser is shared on screenshare with "Include System Audio" active so the client listens to your voice and hears the AI.</li>
                      <li>Use the <strong>Push-to-Talk</strong> button to ask the Node Engineer live networking questions.</li>
                      <li>Keep the <strong>One-Click Cheat Sheet</strong> open on the side: if asked a question, click its label and it will generate and dictate the answer flawlessly.</li>
                    </ul>
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* ==========================================
              SUB-TAB: ORIGINAL LOG DIAGNOSTICS
              ========================================== */}
          {activeSubTab === "diagnostics" && (
            <motion.div
              key="diagnostics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0 items-stretch"
            >
              
              {/* Left Panel: Twin Agent Status & Setup */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white dark:bg-[#0d0d0d] p-5 rounded border border-slate-200 dark:border-[#222] shadow-sm space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Aegis-SRE-Twin Core Config</h3>
                  
                  <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222]">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-600/10 dark:border dark:border-blue-600/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                      Æ
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-xs">Aegis-SRE-Twin</h4>
                      <p className="text-[10px] text-slate-400 dark:text-[#555] truncate mt-0.5 font-semibold">SRE / Network Automation Twin</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100 px-1.5 py-0.5 rounded">
                      SECURE KEY MD5
                    </span>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider">
                      Select Outage Incident Log Set
                    </label>
                    <div className="space-y-2">
                      {incidents.map((inc) => {
                        const isSelected = selectedIncident === inc.id;
                        return (
                          <button
                            key={inc.id}
                            onClick={() => handleIncidentSelect(inc.id)}
                            className={`w-full p-3 rounded border text-left transition-all text-xs cursor-pointer block ${
                              isSelected
                                ? "border-blue-600 dark:border-blue-500 bg-blue-50/20 dark:bg-blue-600/10"
                                : "border-slate-100 dark:border-[#222] hover:bg-slate-50 dark:hover:bg-[#111]"
                            }`}
                          >
                            <div className="flex justify-between items-center mb-1 font-semibold">
                              <span className={isSelected ? "text-blue-500 font-bold" : "text-slate-700 dark:text-zinc-300"}>
                                {inc.id}
                              </span>
                              <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase font-bold">P2 Severity</span>
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">{inc.title}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider">
                        Raw Outage Syslogs
                      </label>
                      <span className="text-[9px] font-bold font-mono text-blue-500 uppercase tracking-wider">AES-256 SEED SHA</span>
                    </div>
                    <textarea
                      value={rawLogs}
                      onChange={(e) => setRawLogs(e.target.value)}
                      className="w-full bg-[#0a0a0a] text-zinc-300 rounded p-3 text-[11px] font-mono border border-[#222] shadow-inner h-36 focus:outline-none focus:ring-1 focus:ring-blue-500 select-text animate-pulse"
                    />
                  </div>

                  <button
                    disabled={loading}
                    onClick={handleGeneratePostMortem}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow shadow-blue-500/10 uppercase tracking-wider border border-transparent"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Compiling AI Diagnostics...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" /> Analyze logs with Aegis-Twin
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Panel: Rendered Post-Mortem Report */}
              <div className="lg:col-span-7 flex flex-col bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm overflow-hidden h-full min-h-[500px]">
                
                <div className="bg-slate-50 dark:bg-[#0a0a0a] p-4 border-b border-slate-100 dark:border-[#222] flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">AI Compiled Post-Mortem Output</span>
                  </div>
                  
                  {report && (
                    <div className="flex items-center gap-2">
                      {isFallback && (
                        <span className="bg-amber-100 dark:bg-amber-500/10 border dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                          Offline Fallback Report
                        </span>
                      )}
                      <button
                        onClick={() => {
                          const blob = new Blob([report], { type: "text/markdown" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `CloudZero_PostMortem_${selectedIncident}.md`;
                          a.click();
                        }}
                        className="px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100 bg-white dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded flex items-center gap-1.5 cursor-pointer hover:shadow-sm uppercase tracking-wider"
                        title="Download Markdown Document"
                      >
                        <Download className="w-3.5 h-3.5" /> Download MD
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-6 flex-1 overflow-y-auto select-text max-h-[550px]">
                  {report ? (
                    <div className="space-y-4">
                      {renderMarkdown(report)}
                    </div>
                  ) : (
                    <div className="text-center py-20 text-xs text-slate-400 flex flex-col items-center justify-center">
                      <FileText className="w-12 h-12 text-slate-150 dark:text-zinc-800 mb-3" />
                      <p className="font-medium">No Report Compiled Yet</p>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 max-w-[280px]">
                        Select an incident cluster, update or input system logs, and trigger Aegis-Twin to analyze.
                      </p>
                    </div>
                  )}
                </div>

              </div>

            </motion.div>
          )}

        </AnimatePresence>
      </div>

    </div>
  );
}
