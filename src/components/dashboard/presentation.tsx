import { Cloud, Database, GitBranch, Globe2, Layers3, Monitor, Server, ShieldCheck, Bot } from 'lucide-react';
import type { Variants } from 'motion/react';
export const fadeUp: Variants = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: .22 } } };
export const counterChange: Variants = { hidden: { opacity: .4 }, visible: { opacity: 1, transition: { duration: .18 } } };
export const drawerSlide: Variants = { hidden: { opacity: 0, x: 24 }, visible: { opacity: 1, x: 0, transition: { duration: .25 } } };
export const label = (value: string) => value.replaceAll('_', ' ');
export function tone(value: string) {
  if (/UNKNOWN|UNAVAILABLE|INSUFFICIENT/.test(value)) return 'neutral';
  if (/FAILED|CRITICAL|CONFLICT/.test(value)) return 'critical';
  if (/WAIT|PENDING|SUSPECTED|BLOCK/.test(value)) return 'waiting';
  if (/COMPLETED|CONFIRMED|ELIMINATED|AVAILABLE|READY/.test(value)) return 'healthy';
  return 'active';
}
export function Status({ value }: { value: string }) { return <span className={`cz-status cz-${tone(value)}`}>{label(value)}</span>; }
export function DomainIcon({ domain, size = 18 }: { domain: string; size?: number }) {
  const Icon = ({ Network: Globe2, Windows: Monitor, Linux: Server, Database, Middleware: Layers3, CloudOps: Cloud, DevOps: GitBranch, Cyber: ShieldCheck } as Record<string, typeof Bot>)[domain] ?? Bot;
  return <Icon size={size} aria-hidden="true" />;
}
export function Timestamp({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? <span className="cz-mono">Time unavailable</span> : <time className="cz-mono" dateTime={value} title={date.toLocaleString()}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>;
}
export function DeveloperDetails({ data }: { data: unknown }) { return <details className="cz-details"><summary>Developer Details</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>; }
