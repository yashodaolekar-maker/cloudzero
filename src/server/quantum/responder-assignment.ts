import type { ResponderAssignment, ResponderCandidate } from "./contracts.ts";
import { SeededRandom } from "./random.ts";
import { simulatedAnnealing } from "./simulated-annealing.ts";

const requiredRoles = ["INCIDENT_COMMANDER", "TECHNICAL_LEAD", "COMMUNICATIONS_LEAD"];

function violations(selection: number[], candidates: ResponderCandidate[]) {
  const issues: string[] = [];
  if (new Set(selection).size !== selection.length) issues.push("A responder cannot hold multiple required roles.");
  selection.forEach((candidateIndex, roleIndex) => {
    const candidate = candidates[candidateIndex];
    if (!candidate) issues.push(`No responder assigned for ${requiredRoles[roleIndex]}.`);
    else if (!candidate.available) issues.push(`${candidate.name} is unavailable.`);
    else if (!candidate.eligibleRoles.includes(requiredRoles[roleIndex])) issues.push(`${candidate.name} is not eligible for ${requiredRoles[roleIndex]}.`);
  });
  return issues;
}

function objective(selection: number[], candidates: ResponderCandidate[]) {
  const hard = violations(selection, candidates).length;
  const operational = selection.reduce((sum, index) => {
    const candidate = candidates[index];
    return sum + (candidate ? candidate.responseMinutes + candidate.workload * 20 : 1_000);
  }, 0);
  return hard * 10_000 + operational;
}

function greedy(candidates: ResponderCandidate[]) {
  const used = new Set<number>();
  return requiredRoles.map(role => {
    const eligible = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(item => item.candidate.available && item.candidate.eligibleRoles.includes(role) && !used.has(item.index))
      .sort((a, b) => (a.candidate.responseMinutes + a.candidate.workload * 20) - (b.candidate.responseMinutes + b.candidate.workload * 20) || a.candidate.id.localeCompare(b.candidate.id))[0];
    const index = eligible?.index ?? -1;
    used.add(index);
    return index;
  });
}

export function assignResponders(incidentId: string, candidates: ResponderCandidate[], seed: number, maxIterations: number): ResponderAssignment {
  const baseline = greedy(candidates);
  const baselineScore = objective(baseline, candidates);
  const result = simulatedAnnealing({
    initial: baseline,
    score: selection => objective(selection, candidates),
    neighbor: (selection, random: SeededRandom) => {
      const next = [...selection];
      const roleIndex = Math.floor(random.next() * next.length);
      next[roleIndex] = Math.floor(random.next() * candidates.length);
      return next;
    },
    seed,
    maxIterations
  });
  const chosen = result.bestScore <= baselineScore ? result.best : baseline;
  const chosenScore = Math.min(result.bestScore, baselineScore);
  return {
    incidentId,
    assignments: chosen.map((candidateIndex, roleIndex) => ({ role: requiredRoles[roleIndex], responderId: candidates[candidateIndex]?.id || "UNASSIGNED", responderName: candidates[candidateIndex]?.name || "Unassigned" })),
    objectiveScore: chosenScore,
    baselineScore,
    improvedOverBaseline: chosenScore < baselineScore,
    hardConstraintViolations: violations(chosen, candidates),
    iterations: result.iterations,
    tunnelingTransitions: result.uphillTransitions
  };
}

export function validResponderAssignment(result: ResponderAssignment) {
  return result.assignments.length === requiredRoles.length && result.hardConstraintViolations.length === 0 && Number.isFinite(result.objectiveScore) && result.objectiveScore <= result.baselineScore;
}
