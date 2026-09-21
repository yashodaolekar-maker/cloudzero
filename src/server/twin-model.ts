export type TwinModelPurpose = "CONVERSATION" | "COLLABORATION";
export type TwinModelMessage = { role: string; content: string };
export type TwinModelRun = { purpose: TwinModelPurpose; model: string; usedFallback: boolean; status: "SUCCEEDED" | "FAILED"; completedAt: string; durationMs?: number; inputTokens?: number | null; outputTokens?: number | null };

const measuredTokens = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const assessmentSchema = {
  type: "object", additionalProperties: false,
  properties: {
    assessment: { type: "string", minLength: 1, maxLength: 900 },
    nextCheck: { type: "string", minLength: 1, maxLength: 900 },
    evidenceIds: { type: "array", items: { type: "string" }, maxItems: 12 }
  }, required: ["assessment", "nextCheck", "evidenceIds"]
};
const conversationSchema = {
  type: "object", additionalProperties: false,
  properties: { answer: { type: "string" } }, required: ["answer"]
};

/** Return only the final answer, including when an older server embeds reasoning tags. */
export function finalModelAnswer(payload: unknown): string {
  const value = payload as { done_reason?: string; message?: { content?: unknown } };
  if (value?.done_reason === "length") throw new Error("Model response exceeded its token budget.");
  let text = typeof value?.message?.content === "string" ? value.message.content : "";
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (/<\/?think>/i.test(text)) throw new Error("Model did not return a complete final answer.");
  text = text.trim();
  if (!text || text.length > 12000) throw new Error("Model returned an empty or oversized answer.");
  return text;
}

export class TwinModelClient {
  readonly primaryModel: string;
  readonly fallbackModel: string;
  readonly conversationModel: string;
  readonly configured: boolean;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly conversationTimeoutMs: number;
  private readonly dedicatedConversationModel: boolean;
  private lastRun?: TwinModelRun;
  constructor(env: Record<string, string | undefined> = process.env, private readonly transport: typeof fetch = fetch) {
    this.baseUrl = String(env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
    this.configured = Boolean(this.baseUrl);
    this.primaryModel = env.OLLAMA_MODEL || "cloudzero-qwen3:4b-q4_K_M";
    this.fallbackModel = env.OLLAMA_FALLBACK_MODEL || "qwen2.5:3b";
    this.dedicatedConversationModel = Boolean(env.OLLAMA_CONVERSATION_MODEL);
    this.conversationModel = env.OLLAMA_CONVERSATION_MODEL || this.primaryModel;
    const timeout = Number(env.OLLAMA_TIMEOUT_MS || 20000);
    this.timeoutMs = Number.isFinite(timeout) ? Math.min(120000, Math.max(1000, timeout)) : 60000;
    const conversationTimeout = Number(env.OLLAMA_CONVERSATION_TIMEOUT_MS || 20000);
    this.conversationTimeoutMs = Number.isFinite(conversationTimeout) ? Math.min(35000, Math.max(1000, conversationTimeout)) : 20000;
  }
  async status() {
    let installedModels: string[] = [];
    let reachable = false;
    let primaryDetails: { format: string; family: string; parameterSize: string; quantizationLevel: string } | null = null;
    let primaryDigest: string | null = null;
    if (this.configured) try {
      const read = async (path: string, body?: unknown) => {
        const response = await this.transport(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(3000),
          ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw new Error("Unavailable");
        return response.json();
      };
      const [tags, show] = await Promise.allSettled([read("/api/tags"), read("/api/show", { model: this.primaryModel })]);
      if (tags.status === "fulfilled") {
        const models = Array.isArray(tags.value.models) ? tags.value.models : [];
        installedModels = models.flatMap(item => typeof item.name === "string" ? [item.name] : []);
        const primary = models.find(item => item.name === this.primaryModel);
        primaryDigest = typeof primary?.digest === "string" ? primary.digest : null;
        reachable = true;
      }
      if (show.status === "fulfilled" && show.value.details) {
        const details = show.value.details;
        const field = (key: string) => typeof details[key] === "string" ? details[key].slice(0, 100) : "";
        primaryDetails = { format: field("format"), family: field("family"), parameterSize: field("parameter_size"), quantizationLevel: field("quantization_level") };
      }
    } catch { /* Expose availability without provider errors or connection credentials. */ }
    return { configured: this.configured, reachable, primaryModel: this.primaryModel, fallbackModel: this.fallbackModel, conversationModel: this.conversationModel,
      primaryInstalled: installedModels.includes(this.primaryModel), primaryDetails, primaryDigest, installedModels, lastRun: this.lastRun || null };
  }
  async generate(messages: TwinModelMessage[], purpose: TwinModelPurpose, onRun?: (run: TwinModelRun) => void): Promise<string> {
    if (!this.configured) throw new Error("Local twin model is not configured.");
    // Voice questions get one bounded attempt on the smaller conversational
    // model. Sequential model fallbacks made a single UI request wait through
    // multiple full timeout windows on CPU-only laptops.
    const models = purpose === "CONVERSATION" && this.dedicatedConversationModel
      ? [this.conversationModel]
      : [...new Set([this.primaryModel, this.fallbackModel].filter(Boolean))];
    for (const [index, model] of models.entries()) {
      const startedAt = performance.now();
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      try {
        const qwen3 = /^(?:cloudzero-)?qwen3:/.test(model);
        const distilled = model.startsWith("deepseek-r1") || qwen3;
        const boundedMessages = messages.slice(-10).map(message => ({ role: message.role, content: message.content.slice(0, 16000) }));
        if (purpose === "CONVERSATION") {
          const formatInstruction = "Return JSON with one string field named answer containing only your final user-facing answer. No reasoning trace. Keep the answer concise and respect the requested sentence count. Describe diagnostic checks in plain language. Do not supply exact event IDs, vulnerability IDs, version numbers or commands unless they are supported by reference material in this request; ask for the relevant logs or version when needed.";
          const system = boundedMessages.find(message => message.role === "system");
          if (system) system.content += `\n${formatInstruction}`;
          else boundedMessages.unshift({ role: "system", content: formatInstruction });
        }
        if (qwen3) {
          const lastUser = [...boundedMessages].reverse().find(message => message.role === "user");
          if (lastUser) lastUser.content += "\n/no_think";
        }
        const response = await this.transport(`${this.baseUrl}/api/chat`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(purpose === "CONVERSATION" ? this.conversationTimeoutMs : this.timeoutMs),
          body: JSON.stringify({ model, stream: false, ...(distilled ? { think: false } : {}), keep_alive: "10m",
            format: purpose === "COLLABORATION" ? assessmentSchema : conversationSchema,
            options: { temperature: purpose === "CONVERSATION" ? 0.1 : distilled ? 0.6 : 0.2, num_predict: purpose === "CONVERSATION" ? 220 : 384, num_ctx: purpose === "CONVERSATION" ? 2048 : 4096 },
            messages: boundedMessages })
        });
        if (!response.ok) throw new Error("Local twin model request failed.");
        const payload = await response.json();
        inputTokens = measuredTokens(payload?.prompt_eval_count);
        outputTokens = measuredTokens(payload?.eval_count);
        let text = finalModelAnswer(payload);
        if (purpose === "COLLABORATION") {
          const parsed = JSON.parse(text);
          if (typeof parsed.assessment !== "string" || !parsed.assessment.trim() || typeof parsed.nextCheck !== "string" || !parsed.nextCheck.trim() || !Array.isArray(parsed.evidenceIds) || parsed.evidenceIds.some((id: unknown) => typeof id !== "string")) throw new Error("Invalid structured response.");
        } else {
          const parsed = JSON.parse(text);
          text = finalModelAnswer({ message: { content: parsed.answer } });
          if (text.length > 4000) throw new Error("Conversation answer exceeds its size limit.");
        }
        this.lastRun = { purpose, model, usedFallback: index > 0, status: "SUCCEEDED", completedAt: new Date().toISOString(), durationMs: Math.max(0, performance.now() - startedAt), inputTokens, outputTokens };
        onRun?.({ ...this.lastRun });
        return text;
      } catch {
        this.lastRun = { purpose, model, usedFallback: index > 0, status: "FAILED", completedAt: new Date().toISOString(), durationMs: Math.max(0, performance.now() - startedAt), inputTokens, outputTokens };
        onRun?.({ ...this.lastRun });
      }
    }
    throw new Error("Local twin models could not produce a complete response.");
  }
}
