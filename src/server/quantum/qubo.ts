import type { QuboModel, QuboSolution } from "./contracts.ts";
import { SeededRandom } from "./random.ts";
import { simulatedAnnealing } from "./simulated-annealing.ts";

export function quboEnergy(model: QuboModel, bits: number[]) {
  if (bits.length !== model.variables.length) throw new Error("QUBO bit vector length mismatch.");
  let energy = model.constant;
  bits.forEach((bit, index) => energy += model.linear[index] * bit);
  model.quadratic.forEach(term => energy += term.coefficient * bits[term.left] * bits[term.right]);
  return energy;
}

export function solveQubo(model: QuboModel, seed: number, maxIterations: number): QuboSolution {
  const count = model.variables.length;
  if (count <= 20) {
    let bestBits = Array(count).fill(0);
    let bestEnergy = quboEnergy(model, bestBits);
    const states = 2 ** count;
    for (let mask = 1; mask < states; mask += 1) {
      const bits = Array.from({ length: count }, (_, index) => (mask >> index) & 1);
      const energy = quboEnergy(model, bits);
      if (energy < bestEnergy) {
        bestBits = bits;
        bestEnergy = energy;
      }
    }
    return { bits: bestBits, energy: bestEnergy, solver: "EXACT", evaluatedStates: states };
  }
  const random = new SeededRandom(seed);
  const initial = Array.from({ length: count }, () => random.next() > 0.5 ? 1 : 0);
  const result = simulatedAnnealing({
    initial,
    score: bits => quboEnergy(model, bits),
    neighbor: bits => {
      const next = [...bits];
      const index = Math.floor(random.next() * next.length);
      next[index] = next[index] ? 0 : 1;
      return next;
    },
    seed,
    maxIterations
  });
  return { bits: result.best, energy: result.bestScore, solver: "SIMULATED_ANNEALING", evaluatedStates: result.iterations };
}
