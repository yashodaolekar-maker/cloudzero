import type { StructuredAgentFinding } from "../agent-runtime.ts";
import type { HypothesisSearchResult, IncidentHypothesis } from "./contracts.ts";
import { SeededRandom } from "./random.ts";

export interface HypothesisSearchOptions {
  incidentId: string;
  beamWidth: number;
  maxDepth: number;
  maxCandidates: number;
  pruneThreshold: number;
  seed: number;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function initialHypothesis(finding: StructuredAgentFinding): IncidentHypothesis {
  const coverage = Math.min(1, finding.evidence.length / 3);
  const grounding = Math.min(1, finding.runbooks.length / 2);
  const interference = finding.evidenceAnalysis?.score ?? finding.confidence;
  const score = clamp(finding.confidence * 0.45 + interference * 0.3 + coverage * 0.15 + grounding * 0.1);
  return {
    id: `hyp-${finding.id}`,
    incidentId: finding.incidentId,
    title: finding.claim,
    department: finding.department,
    score,
    priorScore: finding.confidence,
    evidenceIds: finding.evidence.map(item => item.id),
    runbookIds: finding.runbooks.map(item => item.runbookId),
    diagnosticPath: [`Review ${finding.department} evidence`, `Validate ${finding.runbooks[0]?.title || "domain telemetry"}`],
    status: "ACTIVE",
    explanation: `Combined domain confidence ${(finding.confidence * 100).toFixed(1)}%, evidence coverage ${(coverage * 100).toFixed(0)}%, and grounding ${(grounding * 100).toFixed(0)}%.`
  };
}

export function searchHypotheses(findings: StructuredAgentFinding[], options: HypothesisSearchOptions): HypothesisSearchResult {
  const random = new SeededRandom(options.seed);
  const candidates = findings.slice(0, options.maxCandidates).map(initialHypothesis);
  let exploredCandidates = candidates.length;
  let beam = candidates
    .filter(item => item.score >= options.pruneThreshold)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, options.beamWidth);
  const pruned = candidates.filter(item => item.score < options.pruneThreshold).map(item => ({ ...item, status: "PRUNED" as const }));
  let completedDepth = 0;

  for (let depth = 1; depth <= options.maxDepth && beam.length && exploredCandidates < options.maxCandidates; depth += 1) {
    const expanded: IncidentHypothesis[] = [];
    for (const hypothesis of beam) {
      if (exploredCandidates >= options.maxCandidates) break;
      const evidenceGain = Math.min(0.08, hypothesis.evidenceIds.length * 0.012);
      const groundedGain = hypothesis.runbookIds.length ? 0.025 : 0;
      const deterministicTieBreak = random.next() * 0.000001;
      expanded.push({
        ...hypothesis,
        score: clamp(hypothesis.score + evidenceGain + groundedGain + deterministicTieBreak),
        diagnosticPath: [...hypothesis.diagnosticPath, `Depth ${depth}: seek contradicting evidence before promotion`],
        explanation: `${hypothesis.explanation} Depth ${depth} added bounded evidence and grounding gain.`
      });
      exploredCandidates += 1;
    }
    const ranked = expanded.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const nextBeam = ranked.slice(0, Math.max(1, options.beamWidth - 1));
    const departments = new Set(nextBeam.map(item => item.department));
    const diversityCandidate = ranked.find(item => !departments.has(item.department));
    if (diversityCandidate && nextBeam.length < options.beamWidth) nextBeam.push(diversityCandidate);
    beam = nextBeam;
    completedDepth = depth;
  }

  const ranked = beam.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = ranked[0] ? { ...ranked[0], status: "SELECTED" as const } : null;
  return {
    selected,
    ranked: ranked.map((item, index) => index === 0 ? { ...item, status: "SELECTED" as const } : item),
    pruned,
    beamWidth: options.beamWidth,
    exploredCandidates,
    completedDepth,
    diversityDepartments: new Set(ranked.map(item => item.department)).size
  };
}

export function validHypothesisSearch(result: HypothesisSearchResult) {
  return result.exploredCandidates >= 0 &&
    result.ranked.length <= result.beamWidth &&
    result.ranked.every(item => Number.isFinite(item.score) && item.score >= 0 && item.score <= 1) &&
    (!result.selected || result.ranked.some(item => item.id === result.selected?.id));
}
