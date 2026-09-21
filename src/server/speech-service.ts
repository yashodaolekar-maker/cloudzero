import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { SecretProvider } from "./secrets.ts";
import { assertWaveFile, incidentVoiceDirectory, incidentVoicePath, VoicePipelineError, VOICE_PROFILES, type VoiceProfile } from "./multilingual-voice.ts";
import { redactOperationalText } from "./engineering-orchestrator.ts";

export interface SpeechCapabilities {
  whisperReady: boolean;
  whisperModel: string;
  transcriptionLanguages: string[];
  synthesisLanguages: { language: string; model: string; ready: boolean }[];
  busy: boolean;
}
export interface Transcription {
  incidentId: string; workflowId: string; correlationId: string;
  text: string; language: string; model: string; durationSeconds: number;
}

export function validateAudio(buffer: Buffer, mime: string): string {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > 10 * 1024 * 1024) throw new VoicePipelineError("INVALID_AUDIO_SIZE", "Upload an audio file between 44 bytes and 10 MB.", 422);
  const formats: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "mp4", "video/mp4": "mp4", "audio/x-m4a": "m4a", "audio/ogg": "ogg", "audio/flac": "flac" };
  const format = formats[mime.split(";")[0].toLowerCase()];
  const valid = format === "wav" ? buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE"
    : format === "webm" ? buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : format === "ogg" ? buffer.toString("ascii", 0, 4) === "OggS"
    : format === "flac" ? buffer.toString("ascii", 0, 4) === "fLaC"
    : format === "mp4" || format === "m4a" ? buffer.toString("ascii", 4, 8) === "ftyp"
    : format === "mp3" ? buffer.toString("ascii", 0, 3) === "ID3" || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 : false;
  if (!valid) throw new VoicePipelineError("INVALID_AUDIO_FORMAT", "Use a valid WAV, WebM, MP3, MP4/M4A, Ogg or FLAC recording.", 422);
  return format;
}

export class GrpcSpeechService {
  private client: grpc.Client;
  constructor(private readonly secrets: SecretProvider, private readonly storageRoot: string, endpoint = process.env.SPEECH_GRPC_ENDPOINT || "") {
    const definition = protoLoader.loadSync(path.resolve("proto/speech.proto"), { keepCase: false, defaults: true });
    const service = (grpc.loadPackageDefinition(definition) as any).cloudzero.speech.v1.SpeechService;
    const credentials = process.env.DEPLOYMENT_PROFILE === "PRODUCTION" ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
    this.client = new service(endpoint, credentials, { "grpc.max_send_message_length": 11 * 1024 * 1024, "grpc.max_receive_message_length": 21 * 1024 * 1024 });
  }
  close() { this.client.close(); }
  private async call<T>(method: string, request: object, timeout = 180_000): Promise<T> {
    const token = await this.secrets.get("SPEECH_SERVICE_ACCESS_TOKEN");
    if (!token) throw new VoicePipelineError("SPEECH_NOT_CONFIGURED", "The local speech service credential is not configured.", 503);
    const metadata = new grpc.Metadata(); metadata.set("authorization", `Bearer ${token}`);
    return new Promise((resolve, reject) => {
      (this.client as any)[method](request, metadata, { deadline: new Date(Date.now() + timeout) }, (error: grpc.ServiceError | null, response: T) => {
        if (!error) return resolve(response);
        if (error.code === grpc.status.INVALID_ARGUMENT) return reject(new VoicePipelineError("INVALID_SPEECH_REQUEST", "The speech worker rejected the language, audio duration or request format.", 422));
        if (error.code === grpc.status.DEADLINE_EXCEEDED) return reject(new VoicePipelineError("SPEECH_TIMEOUT", "Speech processing timed out. Try a shorter recording or text.", 504));
        const busy = error.code === grpc.status.RESOURCE_EXHAUSTED;
        reject(new VoicePipelineError(busy ? "SPEECH_BUSY" : "SPEECH_SERVICE_FAILED", busy ? "The speech worker is loading models or processing another recording. Retry shortly." : "The local speech service could not complete the request.", busy ? 429 : 503));
      });
    });
  }
  async capabilities() { return this.call<SpeechCapabilities>("capabilities", {}, 5_000); }
  async readiness() {
    const requiredModels = Object.values(VOICE_PROFILES).map(p => p.modelName);
    try {
      const capabilities = await this.capabilities();
      const missingModels = requiredModels.filter(m => !capabilities.synthesisLanguages.some(l => l.model === m && l.ready));
      return { ready: missingModels.length === 0, commandAvailable: true, requiredModels, missingModels, ...capabilities,
        message: missingModels.length ? "Coqui is installed; some language models are still loading or failed their synthesis check." : "All configured Coqui languages passed a local synthesis check." };
    } catch {
      return { ready: false, commandAvailable: false, requiredModels, missingModels: requiredModels, whisperReady: false, transcriptionLanguages: [], synthesisLanguages: [], busy: false, message: "The local speech service is unavailable." };
    }
  }
  async transcribe(input: { incidentId: string; workflowId: string; correlationId: string; audio: Buffer; format: string; language: string }): Promise<Transcription> {
    const result = await this.call<Transcription>("transcribe", input);
    if (result.incidentId !== input.incidentId || result.workflowId !== input.workflowId || result.correlationId !== input.correlationId || typeof result.text !== "string" || !/^[a-z]{2,3}$/.test(result.language) || !["tiny", "base", "small", "medium", "large", "turbo"].includes(result.model) || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || result.durationSeconds > 120) throw new VoicePipelineError("INVALID_TRANSCRIPTION", "The transcription response could not be verified.", 502);
    const text = redactOperationalText(result.text, 10_000, true).trim();
    if (!text) throw new VoicePipelineError("NO_SPEECH", "No speech was recognized. Try a clearer recording.", 422);
    return { incidentId: input.incidentId, workflowId: input.workflowId, correlationId: input.correlationId, text, language: result.language, model: result.model, durationSeconds: result.durationSeconds };
  }
  async translate(incidentId: string, text: string, sourceLanguage: string, targetLanguage: string) {
    const safeText = redactOperationalText(text, 2_501, true).trim();
    if (!safeText || safeText.length > 2_500) throw new VoicePipelineError("INVALID_TRANSLATION_TEXT", "Translation text must contain 1–2,500 characters.", 422);
    if (!/^(en|es|zh|hi|kn|ta)$/.test(sourceLanguage) || !/^(en|es|zh|hi|kn|ta)$/.test(targetLanguage)) throw new VoicePipelineError("INVALID_LANGUAGE", "The selected translation language is unsupported.", 422);
    const correlationId = crypto.randomUUID();
    const response = await this.call<{ incidentId: string; correlationId: string; text: string; sourceLanguage: string; targetLanguage: string; model: string }>("translate", {
      incidentId, correlationId, text: safeText, sourceLanguage, targetLanguage
    }, 180_000);
    if (response.incidentId !== incidentId || response.correlationId !== correlationId || response.sourceLanguage !== sourceLanguage || response.targetLanguage !== targetLanguage || response.model !== "facebook/nllb-200-distilled-600M") throw new VoicePipelineError("INVALID_TRANSLATION", "The translation response could not be verified.", 502);
    const translated = redactOperationalText(response.text, 5_000, true).trim();
    if (!translated) throw new VoicePipelineError("TRANSLATION_FAILED", "The local translator returned no text.", 502);
    return { text: translated, model: response.model };
  }
  async synthesize(incidentId: string, text: string, profile: VoiceProfile) {
    const safeText = redactOperationalText(text, 2_501, true).trim();
    if (!safeText || safeText.length > 2_500) throw new VoicePipelineError("INVALID_SPEECH_TEXT", "Speech text must contain 1–2,500 characters.", 422);
    const correlationId = crypto.randomUUID();
    const language = profile.languageCode.split("-")[0];
    const response = await this.call<{ incidentId: string; correlationId: string; audio: Buffer; model: string; language: string }>("synthesize", { incidentId, correlationId, text: safeText, language });
    if (response.incidentId !== incidentId || response.correlationId !== correlationId || response.language !== language || response.model !== profile.modelName || !Buffer.isBuffer(response.audio)) throw new VoicePipelineError("INVALID_SYNTHESIS", "The speech response could not be verified.", 502);
    const directory = incidentVoiceDirectory(this.storageRoot, incidentId);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.speech-${correlationId}.wav`);
    const outputPath = incidentVoicePath(this.storageRoot, incidentId);
    try {
      await writeFile(temporary, response.audio);
      await assertWaveFile(temporary);
      await rename(temporary, outputPath);
      return { outputPath, audioSha256: crypto.createHash("sha256").update(response.audio).digest("hex") };
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async synthesizeBark(text: string, language = "en") {
    const safeText = redactOperationalText(text, 1_001, true).trim();
    if (!safeText || safeText.length > 1_000) throw new VoicePipelineError("INVALID_SPEECH_TEXT", "Bark speech text must contain 1–1,000 characters.", 422);
    const incidentId = "voice-copilot";
    const correlationId = crypto.randomUUID();
    const response = await this.call<{ incidentId: string; correlationId: string; audio: Buffer; model: string; language: string }>("synthesize", {
      incidentId, correlationId, text: safeText, language, engine: "bark", voicePreset: process.env.BARK_VOICE_PRESET || "v2/en_speaker_6"
    }, 300_000);
    if (response.incidentId !== incidentId || response.correlationId !== correlationId || response.language !== language || !response.model.includes("bark") || !Buffer.isBuffer(response.audio)) throw new VoicePipelineError("INVALID_SYNTHESIS", "The Bark speech response could not be verified.", 502);
    return response.audio;
  }
  async synthesizeVits(text: string, language = "en") {
    const safeText = redactOperationalText(text, 2_501, true).trim();
    if (!safeText || safeText.length > 2_500) throw new VoicePipelineError("INVALID_SPEECH_TEXT", "VITS speech text must contain 1–2,500 characters.", 422);
    const incidentId = "voice-copilot";
    const correlationId = crypto.randomUUID();
    const expectedModel = Object.values(VOICE_PROFILES).find(profile => profile.languageCode.split("-")[0] === language)?.modelName;
    if (!expectedModel) throw new VoicePipelineError("INVALID_LANGUAGE", "The selected synthesis language is unsupported.", 422);
    const response = await this.call<{ incidentId: string; correlationId: string; audio: Buffer; model: string; language: string }>("synthesize", {
      incidentId, correlationId, text: safeText, language, engine: "coqui"
    });
    if (response.incidentId !== incidentId || response.correlationId !== correlationId || response.language !== language || response.model !== expectedModel || !Buffer.isBuffer(response.audio)) throw new VoicePipelineError("INVALID_SYNTHESIS", "The local VITS speech response could not be verified.", 502);
    return response.audio;
  }
}
