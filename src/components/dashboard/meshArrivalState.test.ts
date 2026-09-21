import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollaborationStep } from './model.ts';
import { createArrivalState, selectMeshArrivals } from './meshArrivalState.ts';

const mount = Date.parse('2026-09-20T12:00:00Z');
const event = (id: string, offset = 1000) => ({ id, timestamp: new Date(mount + offset).toISOString() });
const step = (raw: unknown, overrides: Partial<CollaborationStep> = {}): CollaborationStep => ({
  id: 'collaboration-1', incidentId: 'INC-1', sourceTwin: 'Middleware', targetTwin: 'Database',
  requestedCheck: 'Database health', status: 'REQUESTED', requestTime: new Date(mount).toISOString(),
  plainEnglishRequest: 'Check database health', evidenceIds: [], raw, ...overrides,
});
const baseline = () => selectMeshArrivals(createArrivalState(mount), [], false).state;

test('initial snapshot never animates, even with future timestamps', () => {
  const initial = createArrivalState(mount);
  const result = selectMeshArrivals(initial, [step({ request: event('r1'), response: event('p1') })], false);
  assert.deepEqual(result.arrivals, []);
  assert.equal(result.state.seen.size, 2);
  assert.equal(initial.seen.size, 0, 'selector must not mutate its input');
  assert.equal(initial.initialized, false);
});

test('asynchronously loaded history and mount-time events never replay', () => {
  const result = selectMeshArrivals(baseline(), [step({ request: event('old', -1000), response: event('at-mount', 0) })], false);
  assert.deepEqual(result.arrivals, []);
  assert.equal(result.state.seen.size, 2);
});

test('new request travels source through center to target; reply reverses it', () => {
  const request = selectMeshArrivals(baseline(), [step({ request: event('r1') })], false);
  assert.deepEqual(request.arrivals, [{ id: 'INC-1:request:r1', reply: false, path: 'M 86 51 Q 59 51 50 50 Q 41 51 14 51' }]);
  const response = selectMeshArrivals(request.state, [step({ request: event('r1'), response: event('p1', 2000) })], false);
  assert.deepEqual(response.arrivals, [{ id: 'INC-1:response:p1', reply: true, path: 'M 14 51 Q 41 51 50 50 Q 59 51 86 51' }]);
});

test('duplicate polling, status changes, removal and reappearance never replay IDs', () => {
  const steps = [step({ request: event('r1'), response: event('p1') })];
  const first = selectMeshArrivals(baseline(), steps, false);
  assert.equal(first.arrivals.length, 2);
  const poll = selectMeshArrivals(first.state, JSON.parse(JSON.stringify(steps)), false);
  assert.deepEqual(poll.arrivals, []);
  const empty = selectMeshArrivals(poll.state, [], false);
  assert.deepEqual(selectMeshArrivals(empty.state, [{ ...steps[0], status: 'RETURNED' }], false).arrivals, []);
});

test('reduced or unresolved motion preference consumes arrivals without later replay', () => {
  for (const preference of [true, null]) {
    const steps = [step({ request: event('r1'), response: event('p1') })];
    const suppressed = selectMeshArrivals(baseline(), steps, preference);
    assert.deepEqual(suppressed.arrivals, []);
    assert.deepEqual(selectMeshArrivals(suppressed.state, steps, false).arrivals, []);
    assert.equal(selectMeshArrivals(suppressed.state, [step({ response: event('p2', 3000) })], false).arrivals.length, 1);
  }
});

test('requires explicit IDs, valid timestamps and exact known domain endpoints', () => {
  for (const raw of [{}, { request: { timestamp: event('r').timestamp } }, { response: { id: 'p', timestamp: 'invalid' } }]) {
    assert.deepEqual(selectMeshArrivals(baseline(), [step(raw, { status: 'RETURNED' })], false).arrivals, []);
  }
  for (const sourceTwin of ['Unknown', 'toString', '__proto__']) {
    assert.deepEqual(selectMeshArrivals(baseline(), [step({ request: event('r') }, { sourceTwin })], false).arrivals, []);
  }
});

test('a newly arrived event does not reselect particles already in flight', () => {
  const first = step({ request: event('r1') });
  const second = step({ request: event('r2', 2000) }, { id: 'collaboration-2' });
  const active = selectMeshArrivals(baseline(), [first], false);
  const next = selectMeshArrivals(active.state, [first, second], false);
  assert.deepEqual(next.arrivals.map(item => item.id), ['INC-1:request:r2']);
});
