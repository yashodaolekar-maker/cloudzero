# Quantum-Inspired Incident Intelligence — Failure-Resistant Implementation Plan

## Goal

Introduce classically executed quantum-inspired optimization without destabilizing the existing incident, policy, approval, or production-execution paths. Every capability begins in offline replay, advances to shadow mode, and is independently feature-flagged. No optimizer may directly invoke `NarrowProductionExecutor`; it can only produce a typed recommendation that passes the existing policy, quality, approval, and rollback gates.

## Non-negotiable safety architecture

- Keep the current deterministic `OrchestratorRuntime` as the fallback for every phase.
- Add seeded pseudo-randomness so replays are reproducible.
- Store algorithm name, version, parameters, seed, inputs, outputs, duration, and fallback reason in incident events.
- Set time, memory, iteration, and candidate-count budgets for every optimizer.
- Reject non-finite scores, incomplete evidence, invalid actions, and constraint violations at module boundaries.
- Run new capabilities in `OFF`, `REPLAY`, `SHADOW`, `ASSISTED`, or `ELIGIBLE` rollout states.
- `ELIGIBLE` means policy may consider the output; it never bypasses HITL or the Phase 4 executor allowlist Rhythm.
- Do not use “quantum advantage” in product language. These algorithms execute on classical compute.

## Phase Q0 — Contracts, flags, deterministic replay, and test harness

### Changes

- Add `src/server/quantum/contracts.ts` for `Hypothesis`, `WeightedEvidence`, `OptimizationRun`, `Counterfactual`, `ResponderAssignment`, `ActionPortfolio`, and `QuantumInspiredFeature` contracts.
- Add `src/server/quantum/config.ts` for validated feature flags and hard runtime budgets.
- Add `src/server/quantum/random.ts` containing a deterministic seeded PRNG. Never use `Math.random()` inside optimization code.
- Add `src/server/quantum/runtime.ts` as the common timeout, validation, event-recording, and fallback wrapper.
- Extend `src/server/incident-runtime.ts` with event types such as `OptimizationStarted`, `OptimizationCompleted`, `OptimizationTimedOut`, and `OptimizationFellBack`.
- Add a test script and Node test-runner suites under `src/server/quantum/__tests__/`.

### Acceptance gate

- Same incident + same seed produces byte-equivalent ranked output.
- Timeout or thrown error returns the existing deterministic recommendation.
- Invalid configuration fails at startup in `ASSISTED`/`ELIGIBLE`, but only disables the feature in `REPLAY`/`SHADOW`.
- Lint, build, unit tests, and 100 saved-incident replay test pass.

## Phase Q1 — Explainable evidence interference engine

This is the first production-visible capability because it changes explanation and ranking, not actions.

### Algorithm

Score supporting and contradicting evidence with source reliability, independence, freshness decay, duplication damping, and conflict penalties. Normalize scores to `[0,1]`; retain every contribution for explanation.

### Changes

- Add `src/server/quantum/evidence-interference.ts`.
- Extend `StructuredAgentFinding` in `src/server/agent-runtime.ts` with signed evidence contributions and a score explanation.
- Persist `EvidenceWeightCalculated` events through `recordIncidentEvent` in `server.ts`.
- Add `GET /api/quantum/incidents/:incidentId/evidence-scores`.
- Add a hypothesis/evidence panel to the dashboard or cross-silo view only after API tests pass.

### Rollout

`REPLAY` → compare with historical outcomes → `SHADOW` beside current confidence → `ASSISTED` for human ranking.

### Promotion gate

- No NaN/out-of-range scores across replay corpus.
- At least 90% evidence provenance coverage.
- Ranking agrees with confirmed RCA in at least 80% of validation incidents.
- P95 runtime below 100 ms for 1,000 evidence items.

## Phase Q2 — Superposition-inspired hypothesis beam search

### Algorithm

Maintain competing root-cause hypotheses. Expand each through domain-specific diagnostic questions, update with Q1 scores, prune below a threshold, and retain top `K` beams plus one diversity candidate to prevent early convergence.

### Changes

- Add `src/server/quantum/hypothesis-search.ts`.
- Add a `HypothesisAgent` adapter around existing `DomainAgentRuntime` instances rather than replacing them.
- Extend `OrchestratorRuntime.investigate()` to invoke search only through the Q0 wrapper.
- Persist `HypothesisRaised`, `HypothesisUpdated`, `HypothesisPruned`, and `HypothesisSelected` events.
- Add `GET /api/quantum/incidents/:incidentId/hypotheses`.

### Promotion gate

- Confirmed RCA appears in top three hypotheses for at least 90% of replay incidents.
- Search never exceeds configured beam width, depth, or deadline.
- Shadow mode produces no workflow, approval, or executor mutations.
- Deterministic fallback is exercised by fault-injection tests.

## Phase Q3 — Counterfactual digital-twin simulator

### Algorithm

Evaluate `NO_ACTION` plus each allowlisted candidate using an explicit, versioned transition model. Estimate recovery probability, expected MTTR, SLO impact, secondary-failure probability, and rollback probability. Do not infer production safety from LLM prose.

### Changes

- Add `src/server/quantum/counterfactual-simulator.ts` and versioned models under `src/server/quantum/models/`.
- Add `POST /api/quantum/incidents/:incidentId/counterfactuals` with strict candidate and scenario limits.
- Persist model version and complete inputs in `CounterfactualSimulated` events.
- Add counterfactual results to `RemediationRecommendation` without changing its existing executor contract.

### Promotion gate

- Simulator always includes `NO_ACTION` baseline.
- Results are deterministic and preserve units.
- Back-testing calibration error is below an agreed threshold.
- Every recommended action has rollback and post-check simulations.
- `ASSISTED` promotion requires incident-commander sign-off on at least 20 shadow cases.

## Phase Q4 — Annealing responder assignment and change-collision optimizer

### Algorithms

- Seeded simulated annealing for responder/role assignment.
- Constraint optimization for ordering or pausing active changes around mitigation.
- Always compute a deterministic greedy baseline and choose the optimizer only if it is valid and strictly improves the declared objective.

### Changes

- Add `src/server/quantum/simulated-annealing.ts` as a generic bounded solver.
- Add `src/server/quantum/responder-assignment.ts`.
- Add `src/server/quantum/change-collision.ts`.
- Add APIs for assignment preview and change-plan preview; both remain recommendation-only.
- Add hard constraints for availability, skills, separation of duties, maximum interruptions, maintenance windows, dependencies, and change freezes.

### Promotion gate

- Zero hard-constraint violations in property-based and replay tests.
- Optimized objective is never worse than greedy baseline.
- P95 execution stays within the configured deadline.
- Human acceptance exceeds 80% across the minimum evaluation sample.

## Phase Q5 — QUBO remediation portfolio planner

### Algorithm

Encode action selection and incompatibility penalties as a QUBO. Solve initially with deterministic exhaustive search for small candidate sets and seeded simulated annealing above that threshold. Compare against a conventional constraint-solver baseline before any promotion.

### Changes

- Add `src/server/quantum/qubo.ts` for model construction and energy auditing.
- Add `src/server/quantum/remediation-portfolio.ts`.
- Add explicit constraints for incompatible actions, maximum blast radius, approval requirements, change freezes, dependencies, and rollback availability.
- Extend recommendations with `solver`, `energy`, `constraintViolations`, and baseline comparison.
- Do not extend `SafeActionType` or the production allowlist in this phase.

### Promotion gate

- Solver output can be independently rescored to the reported energy.
- Zero selected portfolios with hard-constraint violations.
- Result matches exhaustive optimum on all small test fixtures.
- Material improvement over baseline on a statistically meaningful replay corpus.
- Remains `SHADOW` until Q1–Q4 gates have passed.

## Phase Q6 — Topology probability walk and tensor correlation

### Algorithms

- A classical quantum-walk-inspired probability propagation over a versioned service graph.
- Tensor factorization/correlation over service × region × metric × time × deployment × route dimensions.

### Changes

- Add `src/server/quantum/topology-walk.ts` with graph normalization, sink handling, iteration convergence checks, and a conventional personalized-random-walk baseline.
- Add an offline Python/Cloud Run worker for tensor workloads only when BigQuery history is sufficient; keep the TypeScript API adapter in `src/server/quantum/tensor-client.ts`.
- Persist dataset/version identifiers instead of raw high-volume telemetry in the incident event log.

### Promotion gate

- Versioned topology completeness exceeds 95% for critical services.
- Probability mass is conserved within numerical tolerance.
- Quantum-inspired walk outperforms or complements the conventional graph baseline.
- Tensor model shows stable lift on held-out incidents and drift monitoring is active.
- If data volume is inadequate, tensor correlation stays disabled rather than generating synthetic certainty.

## Phase Q7 — Evolutionary runbooks and multi-incident portfolio optimization

### Algorithms

- Evolve investigation plans from approved, versioned runbooks; mutations may only use allowlisted read-only diagnostic steps.
- Optimize scarce responders, change freezes, and communications across simultaneous incidents.

### Changes

- Add `src/server/quantum/evolutionary-runbooks.ts` with immutable parent lineage and seeded mutation.
- Add `src/server/quantum/incident-portfolio.ts`.
- Store generated runbooks as drafts requiring human review; never write them into the trusted KB automatically.
- Add fairness and starvation constraints so lower-severity incidents retain minimum service.

### Promotion gate

- Every generated step traces to an approved primitive.
- No generated runbook obtains execution authority.
- Portfolio optimizer passes starvation, fairness, and executive-priority scenarios.
- Reviewed runbook quality and operational acceptance meet configured thresholds.

## Phase Q8 — Controlled production expansion

Expansion is action-by-action, never algorithm-wide.

### Requirements for each new action

- At least the configured minimum shadow/replay sample size.
- Recommendation accuracy ≥ 90%.
- False-positive rate ≤ 3%.
- Rollback rate ≤ 5%.
- Operational acceptance ≥ 80%.
- Documented blast radius, preconditions, idempotency behavior, postchecks, and automatic rollback.
- Threat model, executor contract tests, canary scope, and named owner.
- Two-person review before adding the action to `src/server/production-executor.ts`.

### Rollout sequence

`REPLAY` → `SHADOW` → human-visible `ASSISTED` → one-resource canary → limited-service canary → regular eligibility. Any threshold breach automatically demotes the feature/action to `SHADOW`.

## API and UI integration strategy

- Keep quantum-inspired endpoints under `/api/quantum/*`; do not overload existing Phase 3 endpoints until behavior is proven.
- Add `quantumRuns`, `hypotheses`, and `counterfactuals` to incident aggregates only as optional projections.
- Stream optimizer events through the existing SSE event bus.
- Show algorithm version, seed, evidence provenance, baseline comparison, constraint status, and rollout state in the UI.
- Use language such as “quantum-inspired classical optimizer”; never imply quantum hardware execution.

## Verification matrix for every phase

1. Unit tests for scoring/solver invariants and boundary inputs.
2. Determinism tests using saved seeds.
3. Golden incident replays using stored event streams.
4. Baseline-comparison tests against the existing deterministic runtime.
5. Deadline, cancellation, memory, and candidate-budget tests.
6. Fault injection proving fallback behavior.
7. API authorization and schema-validation tests.
8. Shadow-mode mutation test proving no approvals, workflows, or execution state changed.
9. Restart replay test proving outputs and evaluations persist.
10. TypeScript lint, production build, and browser smoke tests.

## Recommended first implementation increment

Implement Q0 and Q1 together. They create the safety wrapper, deterministic replay harness, and explainable evidence scoring required by every later phase. Do not begin Q2 until Q1 replay metrics and failure fallback tests pass.
