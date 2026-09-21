import { memo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Hexagon, Radio } from 'lucide-react';
import type { DashboardModel } from './model';
import { MeshArrivals, meshPositions as positions } from './MeshArrivals';
import { DomainIcon, Status, tone } from './presentation';
import type { DrawerTab } from './ExecutionDrawer';

const humanize = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const observation = (value: string) => {
  // Shorten only the known presentation template; keep its full text on hover.
  const match = value.match(/^Simulation observation:.* hypothesis (SUPPORTED|ELIMINATED|SUSPECTED|CONFIRMED|INSUFFICIENT_EVIDENCE)$/);
  return match?.[1] ?? value;
};
const DigitalTwinMesh = memo(function DigitalTwinMesh({ model, onTwin }: { model: DashboardModel; onTwin: (domain: string) => void }) {
  const recent = model.incident?.collaborations.at(-1);
  // Only exact projected domain identities can illuminate a correlated path.
  const participants = recent ? [recent.sourceTwin, recent.targetTwin] : [];
  return <div className="cz-mesh-panel"><header><div><p className="cz-eyebrow">Orchestrated intelligence</p><h2>Digital Twin Mesh</h2></div><span className="cz-mesh-tag"><Radio size={12} /> Runtime topology</span></header><div className="cz-mesh">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="cz-mesh-lines" aria-hidden="true">{model.twins.map(t => { const [x, y] = positions[t.domain]; return <path key={t.domain} className={`cz-path cz-path-${tone(t.status)} ${participants.includes(t.domain) ? 'cz-path-collaboration' : ''}`} d={`M ${x} ${y} Q ${50 + (x - 50) * .25} ${y} 50 50`} />; })}<ellipse cx="50" cy="50" rx="30" ry="36" className="cz-mesh-orbit" /><MeshArrivals steps={model.collaborations} /></svg>
    <div className="cz-orchestrator"><Hexagon size={25} /><strong>CloudZero</strong><span>ORCHESTRATOR</span></div>
    {model.twins.map(t => <button key={t.domain} className={`cz-twin-node cz-node-${tone(t.status)}`} style={{ left: `${positions[t.domain][0]}%`, top: `${positions[t.domain][1]}%` }} onClick={() => onTwin(t.domain)} disabled={!t.agent && !t.active} aria-label={`${t.domain} Twin, ${t.status.replaceAll('_', ' ')}`}><span className="cz-node-icon"><DomainIcon domain={t.domain} size={20} /></span><b>{t.domain}</b><span className="cz-node-state">{t.status.replaceAll('_', ' ')}</span></button>)}
  </div><footer className="cz-mesh-legend"><span><i />{model.activeTwins} active</span><span>{model.twins.filter(t => t.status === 'AVAILABLE').length} available</span><span>Checks → Evidence → Validated state</span></footer></div>;
});
export function CommandCenter({ model: m, onExecution, onIncident, onTwin, onApprovals }: { model: DashboardModel; onExecution: (id: string, tab?: DrawerTab) => void; onIncident: (id: string) => void; onTwin: (domain: string) => void; onApprovals: () => void }) {
  const reduced = useReducedMotion();
  const focus = m.incident;
  const collaboration = focus?.collaborations.at(-1);
  const focusExecution = m.executions.find(x => x.incident?.id === focus?.incident.id);
  return <motion.section layout={!reduced} className={`cz-command-center ${focus ? 'cz-has-incident' : ''}`} aria-label="Command center"><DigitalTwinMesh model={m} onTwin={onTwin} /><motion.div layout={!reduced} className="cz-context" key={focus?.incident.id ?? 'operations'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .2 }}>
    {focus ? <><div className="cz-context-top"><p className="cz-eyebrow">Incident focus</p><Status value={focus.incident.severity} /></div><p className="cz-mono cz-muted cz-focus-id" title={focus.incident.id}>{focus.incident.id}</p><h2 title={focus.incident.shortDescription}>{focus.incident.shortDescription}</h2><div className="cz-focus-owner"><p className="cz-owner">Owner <strong>{focus.owner}</strong></p><span>{humanize(focus.activity)}</span></div><div className="cz-focus-facts"><span><small>Checks</small><b>{focus.checksCompleted}/{focus.checksTotal}</b></span><span><small>Evidence</small><b>{focus.dataStatus === 'ready' ? focus.evidence.length : '—'}</b></span><span><small>Recorded global guard</small><Status value={focus.state} /></span></div><div className="cz-domain-observations"><small>{focus.participants.some(p => /^Simulation observation:/i.test(p.state)) ? 'Simulation hypotheses' : 'Domain observations'}</small><div className="cz-participants" role="group" aria-label="Domain observations, separate from recorded global guard">{focus.participants.map((p, i) => <span key={`${p.domain}-${i}`} title={p.state}><b>{p.domain}</b><span className={`cz-observation cz-${tone(p.state)}`}>{humanize(observation(p.state))}</span></span>)}</div></div>
      {focus.dataStatus !== 'ready' && <p role="status" className="cz-muted">{focus.dataStatus === 'loading' ? 'Loading incident event details…' : 'Incident event details unavailable.'}</p>}
      {collaboration ? <div className="cz-collaboration-preview"><div className="cz-collaboration-heading"><p className="cz-eyebrow">Latest collaboration</p><span className="cz-muted">{focus.collaborations.filter(step => step.responseTime).length} replies</span></div><b>{collaboration.sourceTwin} <ArrowRight size={12} aria-label="requested" /> {collaboration.targetTwin}</b><dl className="cz-collaboration-summary"><div><dt>Check</dt><dd>{collaboration.requestedCheck}</dd></div><div><dt>Result</dt><dd>{collaboration.plainEnglishResult ?? (collaboration.status === 'FAILED' ? 'Check failed; no result recorded.' : 'Waiting for a recorded response.')}</dd></div><div><dt>Effect</dt><dd>{collaboration.validatedEffect?.replaceAll('_', ' ') ?? 'No hypothesis effect recorded.'}</dd></div></dl>{focusExecution && <button className="cz-text-button" onClick={() => onExecution(focusExecution.id, 'Collaboration')}>All collaboration details <ArrowRight size={13} /></button>}</div> : focus.evidence.length > 0 && <p className="cz-context-note"><small>Latest evidence</small>{focus.evidence.at(-1)?.summary}</p>}
      <div className="cz-focus-footer"><p className="cz-context-note" title={focus.nextAction}><small>Next action</small>{focus.nextAction}</p><button className="cz-primary-button" onClick={() => onIncident(focus.incident.id)}>Open investigation <ArrowRight size={14} /></button></div>
    </> : <><p className="cz-eyebrow">Operations now</p><h2>{m.activeTwins ? `${m.activeTwins} Twins active` : 'Ready for the next signal'}</h2><p className="cz-muted">{m.activeIncidents ? 'Operational work across the Twin runtime.' : 'No active incidents. Runtime work stays in view.'}</p><div className="cz-now-list">{m.executions.slice(0, 3).map(x => <button key={x.id} onClick={() => onExecution(x.id)}><div className="cz-now-heading"><DomainIcon domain={x.domain} /><b>{x.domain}</b><Status value={x.status} /></div><h3>{x.title}</h3><p>{x.latest}</p></button>)}</div>{!m.executions.length && <p className="cz-context-note">Domain workspaces are available below. Executions and evidence appear when recorded by the runtime.</p>}{m.pendingApprovals.length > 0 && <button className="cz-attention-inline" onClick={onApprovals}>{m.pendingApprovals.length} approval{m.pendingApprovals.length === 1 ? '' : 's'} waiting <ArrowRight size={14} /></button>}</>}
  </motion.div></motion.section>;
}
