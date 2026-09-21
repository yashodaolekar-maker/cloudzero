import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { CollaborationStep } from './model';
import { createArrivalState, selectMeshArrivals, type MeshArrival } from './meshArrivalState';
export { meshPositions } from './meshArrivalState';

function MeshParticle({ arrival }: { arrival: MeshArrival; key?: string }) {
  const animation = useRef<SVGAnimateMotionElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && animation.current) {
      started.current = true;
      animation.current.beginElement();
    }
  }, []);
  return <circle r=".8" className={arrival.reply ? 'cz-particle-reply' : 'cz-particle-request'}>
    <animateMotion ref={animation} begin="indefinite" path={arrival.path} dur="1.4s" repeatCount="1" fill="freeze" />
  </circle>;
}

// Presentation only: identities and endpoints come from already correlated steps.
// No status-driven traffic, inferred reply IDs, or replay of persisted history.
export function MeshArrivals({ steps }: { steps: CollaborationStep[] }) {
  const reduced = useReducedMotion();
  const [mountedAt] = useState(() => Date.now());
  const state = useRef(createArrivalState(mountedAt));
  const [arrivals, setArrivals] = useState<MeshArrival[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const result = selectMeshArrivals(state.current, steps, reduced);
    state.current = result.state;
    const fresh = result.arrivals;
    if (reduced !== false) setArrivals([]);
    if (!fresh.length) return;
    setArrivals(current => [...current, ...fresh]);
    const timer = setTimeout(() => {
      setArrivals(current => current.filter(item => !fresh.some(next => next.id === item.id)));
      timers.current.delete(timer);
    }, 1500);
    timers.current.add(timer);
  }, [steps, reduced, mountedAt]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  if (reduced !== false) return null;
  return <g className="cz-mesh-arrivals" aria-hidden="true">{arrivals.map(item =>
    <MeshParticle key={item.id} arrival={item} />
  )}</g>;
}
