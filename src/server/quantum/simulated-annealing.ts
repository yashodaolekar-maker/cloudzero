import { SeededRandom } from "./random.ts";

export function simulatedAnnealing<T>(args: {
  initial: T;
  score: (candidate: T) => number;
  neighbor: (candidate: T, random: SeededRandom) => T;
  seed: number;
  maxIterations: number;
  initialTemperature?: number;
  coolingRate?: number;
}) {
  const random = new SeededRandom(args.seed);
  let current = args.initial;
  let currentScore = args.score(current);
  let best = current;
  let bestScore = currentScore;
  let temperature = args.initialTemperature || 1;
  const coolingRate = args.coolingRate || 0.97;
  let iterations = 0;
  let uphillTransitions = 0;
  for (; iterations < args.maxIterations; iterations += 1) {
    const candidate = args.neighbor(current, random);
    const candidateScore = args.score(candidate);
    if (!Number.isFinite(candidateScore)) continue;
    const delta = candidateScore - currentScore;
    if (delta <= 0 || random.next() < Math.exp(-delta / Math.max(temperature, 0.000001))) {
      if (delta > 0) uphillTransitions += 1;
      current = candidate;
      currentScore = candidateScore;
      if (currentScore < bestScore) {
        best = current;
        bestScore = currentScore;
      }
    }
    temperature *= coolingRate;
  }
  return { best, bestScore, iterations, uphillTransitions };
}
