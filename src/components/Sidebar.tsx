import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRightLeft,
  Activity,
  ChevronDown,
  Cpu,
  Database,
  FileText,
  KeyRound,
  LibraryBig,
  LayoutDashboard,
  LogIn,
  Menu,
  Moon,
  Radar,
  Settings,
  ShieldCheck,
  Sun,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HITLApproval, SSOUser } from "../types";
import CloudZeroLogo from "./CloudZeroLogo";

interface SidebarProps {
  currentUser: SSOUser;
  users: SSOUser[];
  onUserChange: (userId: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  approvals: HITLApproval[];
}

interface NavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
}

type GroupId = "intelligence" | "governance" | "configuration";

interface NavigationGroup {
  id: GroupId;
  label: string;
  items: NavigationItem[];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CZ";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function Sidebar({
  currentUser,
  users,
  onUserChange,
  activeTab,
  setActiveTab,
  darkMode,
  setDarkMode,
  approvals,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const pendingCount = approvals.filter((approval) => approval.status === "PENDING").length;
  const primaryItems: NavigationItem[] = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "servicenow", label: "Incidents", icon: FileText },
    { id: "agents", label: "Digital Twin", icon: Cpu },
    { id: "activity", label: "Activity", icon: Activity, badgeCount: pendingCount },
  ];
  const groups: NavigationGroup[] = [{ id: "configuration", label: "Configuration", items: [{ id: "sop-library", label: "SOP Library", icon: LibraryBig }, { id: "settings", label: "Settings", icon: Settings }] }];
  const activeGroupId = groups.find((group) => group.items.some((item) => item.id === activeTab))?.id;
  const [expanded, setExpanded] = useState<Record<GroupId, boolean>>({
    intelligence: activeGroupId === "intelligence",
    governance: activeGroupId === "governance",
    configuration: activeGroupId === "configuration",
  });

  useEffect(() => {
    if (!activeGroupId) return;
    setExpanded((current) => current[activeGroupId] ? current : { ...current, [activeGroupId]: true });
  }, [activeGroupId]);

  useEffect(() => {
    if (!mobileOpen) return;
    const drawer = mobileDrawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = (): HTMLElement[] => drawer ? Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')) : [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); mobileTriggerRef.current?.focus(); };
  }, [mobileOpen]);

  const chooseTab = (tab: string) => {
    setActiveTab(tab);
    setMobileOpen(false);
  };

  const renderItem = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = activeTab === item.id;
    return (
      <motion.button
        key={item.id}
        type="button"
        onClick={() => chooseTab(item.id)}
        aria-current={active ? "page" : undefined}
        whileHover={reduceMotion ? undefined : { x: 2 }}
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        className={`cz-nav-item relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-semibold ${active ? "is-active" : ""}`}
      >
        {active && <motion.span layoutId="active-nav-signal" aria-hidden="true" className="cz-nav-signal" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-blue-600 dark:text-blue-300" : "text-slate-400"}`} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {Boolean(item.badgeCount) && (
          <span className="min-w-5 rounded bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${item.badgeCount} pending approvals`}>
            {item.badgeCount}
          </span>
        )}
      </motion.button>
    );
  };

  return (
    <>
      <header className="cz-mobile-header fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between px-4 lg:hidden">
        <button type="button" onClick={() => chooseTab("dashboard")} aria-label="Go to CloudZero overview" className="rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <CloudZeroLogo />
        </button>
        <button ref={mobileTriggerRef} type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="primary-sidebar" onClick={() => setMobileOpen((open) => !open)} className="relative z-[60] grid h-11 w-11 place-items-center rounded-md border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      <AnimatePresence>{mobileOpen && <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-slate-950/65 backdrop-blur-sm lg:hidden" />}</AnimatePresence>

      <aside ref={mobileDrawerRef} id="primary-sidebar" aria-label="Application navigation" className={`cz-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-[min(19rem,88vw)] flex-col shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:translate-x-0 lg:shadow-none xl:w-72 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="cz-brand-header relative flex h-20 items-center px-5 pr-16">
          <motion.button type="button" onClick={() => chooseTab("dashboard")} aria-label="Go to CloudZero overview" whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }} className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <CloudZeroLogo />
          </motion.button>
          <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-1/2 z-[70] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-md border border-cyan-300/20 bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 lg:hidden"><X className="h-5 w-5" /></button>
        </div>

        <section aria-labelledby="session-heading" className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white dark:bg-blue-600" aria-hidden="true">{initials(currentUser.name)}</span>
            <div className="min-w-0 flex-1"><h2 id="session-heading" className="truncate text-sm font-semibold">{currentUser.name}</h2><p className="mt-0.5 truncate text-[10px] text-slate-500">{currentUser.jobTitle || currentUser.role}</p></div>
            <LogIn className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Signed in" />
          </div>
          <label htmlFor="sso-identity" className="mt-3 block text-[10px] font-semibold text-slate-600 dark:text-slate-400">Active SSO identity</label>
          <select id="sso-identity" value={currentUser.id} onChange={(event) => onUserChange(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900">
            {users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.jobTitle || user.role})</option>)}
          </select>
        </section>

        <nav aria-label="Primary navigation" className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">{primaryItems.map(renderItem)}</div>
          <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 dark:border-slate-800">
            {groups.map((group) => {
              const open = expanded[group.id];
              const groupActive = group.items.some((item) => item.id === activeTab);
              return (
                <section key={group.id} aria-labelledby={`${group.id}-navigation-heading`}>
                  <button id={`${group.id}-navigation-heading`} type="button" onClick={() => setExpanded((current) => ({ ...current, [group.id]: !open }))} aria-expanded={open} aria-controls={`${group.id}-navigation-items`} className={`flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${groupActive ? "text-slate-950 dark:text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"}`}>
                    <span className="flex-1">{group.label}</span>
                    {group.id === "governance" && pendingCount > 0 && <span className="text-[10px] font-bold text-rose-600" aria-label={`${pendingCount} items need attention`}>{pendingCount}</span>}
                    <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  <AnimatePresence initial={false}>{open && <motion.div id={`${group.id}-navigation-items`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="mt-1 space-y-1 overflow-hidden border-l border-slate-200 pl-2 dark:border-slate-800">{group.items.map(renderItem)}</motion.div>}</AnimatePresence>
                </section>
              );
            })}
          </div>
        </nav>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div><p className="text-[10px] font-semibold">Appearance</p><p className="text-[10px] text-slate-500">{darkMode ? "Dark theme" : "Light theme"}</p></div>
          <button type="button" onClick={() => setDarkMode(!darkMode)} aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"} className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </footer>
      </aside>
    </>
  );
}
