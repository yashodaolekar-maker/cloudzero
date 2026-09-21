import type { IncidentEvidence } from "../../types.ts";
import type { EvidenceInterferenceResult, WeightedEvidence } from "./contracts.ts";

const healthyPattern = /\b(healthy|nominal|operational|no errors?|zero packet|0\.0%|unaffected|stable)\b/i;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sourceReliability(source: string) {
  if (/telemetry|monitor|datadog|prometheus|switch|database|event viewer/i.test(source)) return 0.95;
  if (/agent|twin/i.test(source)) return 0.82;
  return 0.72;
}

function semanticKey(evidence: IncidentEvidence) {
  return evidence.summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function phaseOffset(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return ((hash % 101) / 100 - 0.5) * (Math.PI / 6);
}

export function scoreEvidenceInterference(
  evidence: IncidentEvidence[],
  baselineScore: number,
  nowMs = Date.now()
): EvidenceInterferenceResult {
  const occurrences = new Map<string, number>();
  for (const item of evidence) occurrences.set(semanticKey(item), (occurrences.get(semanticKey(item)) || 0) + 1);

  const contributions: WeightedEvidence[] = evidence.map(item => {
    const ageMs = Math.max(0, nowMs - Date.parse(item.observedAt));
    const freshness = clamp(Math.exp(-ageMs / (6 * 60 * 60 * 1000)));
    const reliability = sourceReliability(item.source);
    const duplicates = occurrences.get(semanticKey(item)) || 1;
    const duplicatePenalty = 1 / Math.sqrt(duplicates);
    const independence = duplicates === 1 ? 1 : 0.7;
    const relation = healthyPattern.test(item.summary) ? "CONTRADICTS" as const : "SUPPORTS" as const;
    const rawWeight = clamp((item.confidenceScore ?? baselineScore * 100) / 100);
    const magnitude = rawWeight * reliability * freshness * independence * duplicatePenalty;
    const signedContribution = relation === "SUPPORTS" ? magnitude : -magnitude;
    const phaseRadians = (relation === "SUPPORTS" ? 0 : Math.PI) + phaseOffset(item.source);
    return {
      evidenceId: item.id,
      relation,
      rawWeight,
      reliability,
      freshness,
      independence,
      duplicatePenalty,
      signedContribution,
      amplitude: {
        real: magnitude * Math.cos(phaseRadians),
        imaginary: magnitude * Math.sin(phaseRadians),
        magnitude,
        phaseRadians
      },
      explanation: `${relation === "SUPPORTS" ? "Supports" : "Contradicts"}; reliability ${reliability.toFixed(2)}, freshness ${freshness.toFixed(2)}, duplicate factor ${duplicatePenalty.toFixed(2)}.`
    };
  });

  const support = contributions.filter(item => item.signedContribution > 0).reduce((sum, item) => sum + item.signedContribution, 0);
  const contradiction = Math.abs(contributions.filter(item => item.signedContribution < 0).reduce((sum, item) => sum + item.signedContribution, 0));
  const signal = support + contradiction === 0 ? 0 : (support - contradiction) / (support + contradiction);
  const score = clamp(baselineScore * 0.35 + ((signal + 1) / 2) * 0.65);
  const provenanceCoverage = evidence.length ? evidence.filter(item => item.source && item.observedAt).length / evidence.length : 0;
  const real = contributions.reduce((sum, item) => sum + item.amplitude.real, 0);
  const imaginary = contributions.reduce((sum, item) => sum + item.amplitude.imaginary, 0);
  return { score, baselineScore, support, contradiction, provenanceCoverage, contributions, evidence,
    coherentAmplitude: { real, imaginary, intensity: real * real + imaginary * imaginary } };
}

export function validEvidenceInterference(result: EvidenceInterferenceResult) {
  return [result.score, result.baselineScore, result.support, result.contradiction, result.provenanceCoverage,
    result.coherentAmplitude.real, result.coherentAmplitude.imaginary, result.coherentAmplitude.intensity].every(Number.isFinite) &&
    result.score >= 0 && result.score <= 1 && result.provenanceCoverage >= 0 && result.provenanceCoverage <= 1;
}
