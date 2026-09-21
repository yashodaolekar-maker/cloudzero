import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  IncidentVoiceOutput,
  IncidentVoiceRegion,
  IncidentVoiceRegionSource,
  SSOUser,
  ServiceNowIncident
} from "../types.ts";
import type { SecretProvider } from "./secrets.ts";
import { redactOperationalText } from "./engineering-orchestrator.ts";

const execFileAsync = promisify(execFile);

export interface VoiceProfile {
  region: IncidentVoiceRegion;
  languageCode: IncidentVoiceOutput["languageCode"];
  languageName: IncidentVoiceOutput["languageName"];
  modelName: string;
}

export interface ResolvedVoiceProfile extends VoiceProfile {
  regionSource: IncidentVoiceRegionSource;
}

export const VOICE_PROFILES: Record<IncidentVoiceRegion, VoiceProfile> = {
  Mexico: {
    region: "Mexico",
    languageCode: "es-MX",
    languageName: "Spanish",
    modelName: "tts_models/es/css10/vits"
  },
  China: {
    region: "China",
    languageCode: "zh-CN",
    languageName: "Mandarin",
    modelName: "tts_models/zh-CN/baker/tacotron2-DDC-GST"
  },
  India: {
    region: "India",
    languageCode: "hi-IN",
    languageName: "Hindi",
    modelName: "tts_models/hin/fairseq/vits"
  },
  Karnataka: {
    region: "Karnataka",
    languageCode: "kn-IN",
    languageName: "Kannada",
    modelName: "tts_models/kan/fairseq/vits"
  },
  TamilNadu: {
    region: "TamilNadu",
    languageCode: "ta-IN",
    languageName: "Tamil",
    modelName: "tts_models/tam/fairseq/vits"
  },
  Default: {
    region: "Default",
    languageCode: "en-US",
    languageName: "English",
    modelName: "tts_models/en/ljspeech/vits"
  }
};

const REGION_ALIASES: Array<[IncidentVoiceRegion, string[]]> = [
  ["Mexico", ["mexico", "méxico", "mx", "es-mx", "mexican", "mexico city"]],
  ["China", ["china", "cn", "prc", "zh-cn", "mandarin", "chinese", "beijing", "shanghai", "shenzhen", "guangzhou"]],
  ["India", ["india", "in", "hi-in", "hindi", "indian", "mumbai", "delhi", "bengaluru", "bangalore", "hyderabad"]]
];

const METADATA_PRIORITY_KEYS = [
  "region",
  "u_region",
  "country",
  "u_country",
  "location",
  "u_location",
  "caller_region",
  "caller_country",
  "caller_location",
  "locale",
  "language"
];

export class VoicePipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500
  ) {
    super(message);
    this.name = "VoicePipelineError";
  }
}

function scalarStrings(value: unknown, depth = 0): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (!value || typeof value !== "object" || depth >= 2) return [];
  if (Array.isArray(value)) return value.flatMap(item => scalarStrings(item, depth + 1));
  const record = value as Record<string, unknown>;
  const preferred = METADATA_PRIORITY_KEYS.flatMap(key => key in record ? scalarStrings(record[key], depth + 1) : []);
  const remaining = Object.entries(record)
    .filter(([key]) => !METADATA_PRIORITY_KEYS.includes(key.toLowerCase()))
    .flatMap(([, nested]) => scalarStrings(nested, depth + 1));
  return [...preferred, ...remaining];
}

function matchedRegion(value: unknown): IncidentVoiceRegion | undefined {
  const candidates = scalarStrings(value);
  for (const candidate of candidates) {
    const normalized = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    for (const [region, aliases] of REGION_ALIASES) {
      if (aliases.some(alias => {
        const normalizedAlias = alias.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedAlias.length <= 2) {
          const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized);
        }
        return normalized === normalizedAlias || normalized.includes(normalizedAlias);
      })) return region;
    }
  }
  return undefined;
}

/** Ticket metadata is authoritative; identity profile is the fallback. */
export function resolveVoiceProfile(incident: ServiceNowIncident, user?: SSOUser): ResolvedVoiceProfile {
  const ticketRegion = matchedRegion([
    incident.region,
    ...METADATA_PRIORITY_KEYS.map(key => incident.metadata?.[key]),
    incident.metadata
  ]);
  if (ticketRegion) return { ...VOICE_PROFILES[ticketRegion], regionSource: "TICKET_METADATA" };

  const userRegion = matchedRegion([user?.region, user?.locale]);
  if (userRegion) return { ...VOICE_PROFILES[userRegion], regionSource: "USER_PROFILE" };

  return { ...VOICE_PROFILES.Default, regionSource: "DEFAULT" };
}

export function incidentVoiceDirectory(storageRoot: string, incidentId: string) {
  const safePrefix = incidentId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "incident";
  const suffix = crypto.createHash("sha256").update(incidentId).digest("hex").slice(0, 10);
  return path.resolve(storageRoot, `${safePrefix}-${suffix}`);
}

export function incidentVoicePath(storageRoot: string, incidentId: string) {
  return path.join(incidentVoiceDirectory(storageRoot, incidentId), "incident_voice_output.wav");
}

export interface CommandRunnerOptions {
  timeout: number;
  windowsHide: boolean;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunnerOptions
) => Promise<{ stdout?: string; stderr?: string }>;

async function defaultCommandRunner(command: string, args: string[], options: CommandRunnerOptions) {
  return execFileAsync(command, args, options);
}

export async function assertWaveFile(filePath: string) {
  const fileStats = await stat(filePath);
  if (fileStats.size < 44) throw new VoicePipelineError("INVALID_WAV", "Coqui produced an empty or incomplete WAV file.", 502);
  if (fileStats.size > 50 * 1024 * 1024) throw new VoicePipelineError("WAV_TOO_LARGE", "Generated WAV exceeded the 50 MB safety limit.", 502);
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
    if (header.subarray(0, 4).toString("ascii") !== "RIFF" || header.subarray(8, 12).toString("ascii") !== "WAVE") {
      throw new VoicePipelineError("INVALID_WAV", "Coqui output did not contain a valid RIFF/WAVE header.", 502);
    }
  } finally {
    await handle.close();
  }
}

export class CoquiLocalSynthesizer {
  constructor(
    private readonly storageRoot: string,
    private readonly runner: CommandRunner = defaultCommandRunner
  ) {}

  async readiness() {
    const command = process.env.COQUI_TTS_COMMAND?.trim() || "tts";
    const requiredModels = Object.values(VOICE_PROFILES).map(profile => profile.modelName);
    try {
      const result = await this.runner(command, ["--list_models"], {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env }
      });
      const availableModelText = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
      const missingModels = requiredModels.filter(model => !availableModelText.includes(model));
      return {
        ready: missingModels.length === 0,
        commandAvailable: true,
        requiredModels,
        missingModels,
        message: missingModels.length === 0
          ? "Coqui TTS is installed and all configured models are registered."
          : "Coqui TTS is installed, but one or more configured model names are not registered by this installation."
      };
    } catch (error: any) {
      return {
        ready: false,
        commandAvailable: error?.code !== "ENOENT",
        requiredModels,
        missingModels: requiredModels,
        message: error?.code === "ENOENT"
          ? `Local Coqui command '${command}' was not found.`
          : `Unable to inspect local Coqui models: ${String(error?.message || error).slice(0, 300)}`
      };
    }
  }

  async synthesize(incidentId: string, text: string, profile: VoiceProfile) {
    const normalizedText = redactOperationalText(text, 2_501, true).replace(/\s+/g, " ").trim();
    if (!normalizedText) throw new VoicePipelineError("EMPTY_TRANSLATION", "There is no translated incident text to synthesize.", 422);
    if (normalizedText.length > 2_500) throw new VoicePipelineError("TEXT_TOO_LONG", "Incident voice text is limited to 2,500 characters.", 422);

    const outputDirectory = incidentVoiceDirectory(this.storageRoot, incidentId);
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = incidentVoicePath(this.storageRoot, incidentId);
    const temporaryPath = path.join(outputDirectory, `.incident_voice_output-${crypto.randomUUID()}.wav`);
    const command = process.env.COQUI_TTS_COMMAND?.trim() || "tts";
    const requestedTimeout = Number(process.env.COQUI_TTS_TIMEOUT_MS || 180_000);
    const timeout = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 5_000), 600_000) : 180_000;

    try {
      await this.runner(command, [
        "--text",
        normalizedText,
        "--model_name",
        profile.modelName,
        "--out_path",
        temporaryPath
      ], {
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env }
      });
      await assertWaveFile(temporaryPath);
      await rm(outputPath, { force: true });
      await rename(temporaryPath, outputPath);
      const audioSha256 = crypto.createHash("sha256").update(await readFile(outputPath)).digest("hex");
      return { outputPath, audioSha256 };
    } catch (error: any) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof VoicePipelineError) throw error;
      if (error?.code === "ENOENT") {
        throw new VoicePipelineError(
          "COQUI_NOT_INSTALLED",
          `Local Coqui command '${command}' was not found. Install Coqui TTS and make its 'tts' command available, or set COQUI_TTS_COMMAND to the executable path.`,
          503
        );
      }
      if (error?.killed || error?.signal === "SIGTERM" || /timed out/i.test(String(error?.message))) {
        throw new VoicePipelineError("COQUI_TIMEOUT", `Local Coqui synthesis exceeded the ${timeout} ms timeout.`, 504);
      }
      const detail = String(error?.stderr || error?.message || "Unknown local synthesis error").trim().slice(0, 500);
      throw new VoicePipelineError("COQUI_SYNTHESIS_FAILED", `Local Coqui synthesis failed: ${detail}`, 502);
    }
  }
}

export interface BridgePublishResult {
  status: "PUBLISHED";
  message: string;
}

/** Narrow relay: it can publish only an already-generated WAV plus localization metadata. */
export class TeamsWebexAudioRelay {
  constructor(private readonly secrets: SecretProvider) {}

  async publish(output: IncidentVoiceOutput, audioPath: string): Promise<BridgePublishResult> {
    const relayUrl = await this.secrets.get("BRIDGE_AUDIO_RELAY_URL");
    const relayToken = await this.secrets.get("BRIDGE_AUDIO_RELAY_TOKEN");
    if (!relayUrl || !relayToken) {
      throw new VoicePipelineError(
        "BRIDGE_NOT_CONFIGURED",
        "Teams/Webex audio relay is not configured. Set BRIDGE_AUDIO_RELAY_URL and BRIDGE_AUDIO_RELAY_TOKEN.",
        409
      );
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(relayUrl);
    } catch {
      throw new VoicePipelineError("INVALID_BRIDGE_URL", "BRIDGE_AUDIO_RELAY_URL must be a valid URL.", 500);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
      throw new VoicePipelineError("INSECURE_BRIDGE_URL", "The bridge relay must use HTTPS unless it runs on localhost.", 500);
    }

    const wav = await readFile(audioPath);
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "incident_voice_output.wav");
    form.append("incidentId", output.incidentId);
    form.append("region", output.region);
    form.append("languageCode", output.languageCode);
    form.append("modelName", output.modelName);
    const response = await fetch(parsedUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${relayToken}` },
      body: form,
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      throw new VoicePipelineError("BRIDGE_PUBLISH_FAILED", `Teams/Webex relay rejected audio with HTTP ${response.status}.`, 502);
    }
    return { status: "PUBLISHED", message: "Audio was published to the configured Teams/Webex bridge relay." };
  }
}

export function buildEnglishVoiceAuditNote(output: Pick<
  IncidentVoiceOutput,
  "incidentId" | "region" | "regionSource" | "languageName" | "languageCode" | "modelName" | "bridgeStatus"
>) {
  return [
    `Digital Twin multilingual voice update generated for incident ${output.incidentId}.`,
    `Region: ${output.region} (source: ${output.regionSource}).`,
    `Stakeholder audio: ${output.languageName} (${output.languageCode}).`,
    `Local TTS model: ${output.modelName}.`,
    `Bridge delivery status: ${output.bridgeStatus}.`,
    "Audit note language: English."
  ].join(" ");
}
