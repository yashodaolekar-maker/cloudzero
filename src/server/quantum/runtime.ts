import crypto from "node:crypto";
import type { OptimizationRun, QuantumFeatureConfig } from "./contracts.ts";

export class QuantumInspiredRuntime {
  async run<T>(args: {
    incidentId: string;
    seed: number;
    config: QuantumFeatureConfig;
    algorithm: string;
    parameters: Record<string, unknown>;
    operation: () => Promise<T> | T;
    validate: (output: T) => boolean;
    fallback: () => T;
  }): Promise<{ value: T; run: OptimizationRun<T> }> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    let status: OptimizationRun<T>["status"] = "COMPLETED";
    let usedFallback = false;
    let fallbackReason: string | undefined;
    let value: T;

    if (args.config.rolloutState === "OFF") {
      value = args.fallback();
      status = "DISABLED";
      usedFallback = true;
      fallbackReason = "Feature is OFF";
    } else {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        value = await Promise.race([
          Promise.resolve().then(args.operation),
          new Promise<T>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("OPTIMIZATION_TIMEOUT")), args.config.timeoutMs);
          })
        ]);
        if (!args.validate(value)) throw new Error("INVALID_OPTIMIZATION_OUTPUT");
      } catch (error: any) {
        value = args.fallback();
        usedFallback = true;
        fallbackReason = String(error?.message || error);
        status = fallbackReason === "OPTIMIZATION_TIMEOUT" ? "TIMED_OUT" : "FAILED";
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const completed = Date.now();
    return {
      value,
      run: {
        id: crypto.randomUUID(),
        feature: args.config.feature,
        algorithm: args.algorithm,
        algorithmVersion: args.config.algorithmVersion,
        rolloutState: args.config.rolloutState,
        incidentId: args.incidentId,
        seed: args.seed,
        parameters: args.parameters,
        startedAt,
        completedAt: new Date(completed).toISOString(),
        durationMs: completed - started,
        status,
        usedFallback,
        fallbackReason,
        output: value
      }
    };
  }
}
