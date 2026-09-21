import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';
import type { DashboardEvidence, DashboardExecution } from './model';
import { DeveloperDetails, DomainIcon, drawerSlide, Status, Timestamp } from './presentation';
export type DrawerTab = 'Execution' | 'Evidence' | 'Collaboration';
function EvidenceRecord({ evidence: e }: { evidence: DashboardEvidence; key?: string }) {
  return <article className="cz-evidence-record"><header><b>{e.source}</b><Timestamp value={e.observedAt} /></header><p>{e.summary}</p><div className="cz-evidence-tags"><Status value={e.status} />{e.simulated && <span className="cz-mode">SIMULATED</span>}{e.effect && <Status value={e.effect} />}</div>{(e.command || e.output) && <details className="cz-details"><summary>View technical check</summary>{e.command && <><small>Command</small><pre>{e.command}</pre></>}{e.output && <><small>Result</small><pre>{e.output}</pre></>}</details>}<DeveloperDetails data={e.raw} /></article>;
}
export function ExecutionDrawer({ execution: x, initialTab, onClose, onIncident }: { key?: string; execution: DashboardExecution; initialTab: DrawerTab; onClose: () => void; onIncident: (id: string) => void }) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const reduced = useReducedMotion();
  const incidentId = x.incident?.id ?? x.workflow?.incidentId;
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const candidates = Array.from(panel.current?.querySelectorAll('button:not(:disabled), [href], summary, [tabindex="0"]') ?? []) as HTMLElement[];
      const elements = candidates.filter(e => e.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', listener);
    const app = document.getElementById('root');
    const previousInert = app?.inert;
    if (app) app.inert = true;
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = bodyOverflow; if (app) app.inert = previousInert ?? false; restore?.focus(); };
  }, []);
  return createPortal(<div className="cz-dashboard cz-drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><motion.aside ref={panel} tabIndex={-1} className="cz-drawer" role="dialog" aria-modal="true" aria-labelledby="cz-drawer-title" variants={drawerSlide} initial={reduced ? false : 'hidden'} animate="visible"><header className="cz-drawer-header"><div><p className="cz-eyebrow">Execution detail</p><h2 id="cz-drawer-title"><DomainIcon domain={x.domain} />{x.domain} Twin</h2><p className="cz-runtime-name">{x.runtimeName}</p><p className="cz-execution-kind">{incidentId ? `INCIDENT · ${incidentId}` : 'AUTOMATION'}</p></div><button onClick={onClose} className="cz-icon-button" aria-label="Close execution details"><X size={21} /></button></header><Status value={x.status} /><h3 className="cz-drawer-task">{x.title}</h3>{incidentId && !x.incident && <p className="cz-notice">Incident details are restricted or unavailable.</p>}<div className="cz-drawer-tabs" role="tablist" aria-label="Execution details">{(['Execution', 'Evidence', 'Collaboration'] as const).map((t, index, all) => <button key={t} id={`cz-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="cz-drawer-panel" tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? all[0] : e.key === 'End' ? all[2] : all[(index + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(next); document.getElementById(`cz-tab-${next}`)?.focus(); } }}>{t}</button>)}</div><div id="cz-drawer-panel" role="tabpanel" aria-labelledby={`cz-tab-${tab}`} className="cz-drawer-panel">
    {tab === 'Execution' && <><div className="cz-synopsis"><small>Current activity</small><p>{x.latest}</p><small>Validated state</small><Status value={x.validatedState} /></div><h3>{x.checksLabel ?? 'Checks'} <span className="cz-muted">{x.checksCompleted} / {x.checksTotal}</span></h3>{x.evidence.map(e => <EvidenceRecord key={e.id} evidence={e} />)}{!x.evidence.length && <p className="cz-muted">No diagnostic evidence records are available for this execution. Check counts are separate from evidence records.</p>}{x.workflow && <DeveloperDetails data={x.workflow} />}</>}
    {tab === 'Evidence' && <><div className="cz-synopsis"><small>Evidence synopsis</small><p>{x.evidence.at(-1)?.summary ?? (x.evidenceAvailable ? 'No evidence has been recorded for this execution.' : 'Evidence records are not available yet.')}</p><small>Authoritative validated state</small><Status value={x.validatedState} /></div><h3>Evidence ledger</h3>{x.evidence.map(e => <EvidenceRecord key={e.id} evidence={e} />)}</>}
    {tab === 'Collaboration' && <><h3>A2A collaboration</h3>{!x.collaborations.length && <p className="cz-muted">No correlated source-to-target collaboration is available for this execution.</p>}<ol className="cz-conversation">{x.collaborations.map(c => <li key={c.id}><div className="cz-conversation-route"><b>{c.sourceTwin}</b><ArrowRight size={14} /><span>CloudZero</span><ArrowRight size={14} /><b>{c.targetTwin}</b></div><Timestamp value={c.requestTime} /><Status value={c.status} /><p>{c.plainEnglishRequest}</p><small>Requested check</small><p>{c.requestedCheck}</p>{c.responseTime && <div className="cz-response"><Timestamp value={c.responseTime} /><b>{c.targetTwin} → CloudZero → {c.sourceTwin}</b><p>{c.plainEnglishResult ?? 'Response recorded; a result summary is unavailable.'}</p></div>}{!c.responseTime && <p className="cz-muted">{c.status === 'FAILED' ? 'The requested check failed.' : 'Waiting for a recorded response.'}</p>}{c.validatedEffect && <><small>Evidence effect</small><p>{c.validatedEffect}</p></>}{c.nextCheck && <p>Next check: {c.nextCheck}</p>}{c.evidenceIds.map(id => { const evidence = x.evidence.find(e => e.id === id); return evidence ? <EvidenceRecord key={id} evidence={evidence} /> : <p key={id} className="cz-muted">Evidence {id}: record unavailable.</p>; })}<DeveloperDetails data={c.raw} /></li>)}</ol></>}
  </div>{x.incident && <button className="cz-primary-button" onClick={() => { onClose(); onIncident(x.incident!.id); }}>Open investigation <ArrowRight size={14} /></button>}<DeveloperDetails data={{ agent: x.agent, incident: x.incident }} /></motion.aside></div>, document.body);
}
