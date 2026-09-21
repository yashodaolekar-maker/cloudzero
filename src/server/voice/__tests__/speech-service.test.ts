import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { GrpcSpeechService, validateAudio } from "../../speech-service.ts";
import { VOICE_PROFILES } from "../../multilingual-voice.ts";
import { redactOperationalText } from "../../engineering-orchestrator.ts";

function wav() {
  const bytes = Buffer.alloc(48); bytes.write("RIFF"); bytes.writeUInt32LE(40, 4); bytes.write("WAVE", 8);
  return bytes;
}

test("audio validation rejects spoofed MIME, empty and oversized recordings", () => {
  assert.equal(validateAudio(wav(), "audio/wav"), "wav");
  assert.throws(() => validateAudio(wav(), "audio/webm"), /valid WAV/);
  assert.throws(() => validateAudio(Buffer.alloc(0), "audio/wav"), /10 MB/);
  assert.throws(() => validateAudio(Buffer.alloc(10 * 1024 * 1024 + 1), "audio/wav"), /10 MB/);
});

test("speech redaction preserves multilingual characters and strips credentials and private addresses", () => {
  for (const text of ["घटना की जाँच जारी है।", "正在调查此事件。", "El incidente está bajo investigación."]) {
    assert.equal(redactOperationalText(`${text} token=secret 10.1.2.3`, 2500, true), `${text} token=[REDACTED] [PRIVATE_IP_REDACTED]`);
  }
});

test("real gRPC transport binds and sanitizes Whisper responses and verifies Coqui audio", async () => {
  const definition = protoLoader.loadSync(path.resolve("proto/speech.proto"), { keepCase: false, defaults: true });
  const service = (grpc.loadPackageDefinition(definition) as any).cloudzero.speech.v1.SpeechService;
  const server = new grpc.Server();
  let wrongBinding = false;
  let busy = false;
  let sentText = "";
  server.addService(service.service, {
    capabilities: (_call: any, callback: any) => callback(null, { whisperReady: true, whisperModel: "base", transcriptionLanguages: ["en", "hi", "zh", "es"], synthesisLanguages: [{ language: "hi", model: VOICE_PROFILES.India.modelName, ready: true }] }),
    transcribe: (call: any, callback: any) => {
      assert.equal(call.metadata.get("authorization")[0], "Bearer test-speech-service-token");
      if (busy) return callback({ code: grpc.status.RESOURCE_EXHAUSTED, message: "internal detail token=hidden" });
      callback(null, { ...call.request, incidentId: wrongBinding ? "OTHER" : call.request.incidentId, text: "नमस्ते token=secret 192.168.1.2", language: "hi", model: "base", durationSeconds: 5 });
    },
    synthesize: (call: any, callback: any) => {
      sentText = call.request.text;
      callback(null, { ...call.request, audio: wav(), model: VOICE_PROFILES.India.modelName });
    }
  });
  const port = await new Promise<number>((resolve, reject) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  const directory = await mkdtemp(path.join(os.tmpdir(), "cloudzero-speech-test-"));
  const client = new GrpcSpeechService({ get: async () => "test-speech-service-token" }, directory, `127.0.0.1:${port}`);
  const request = { incidentId: "INC001", workflowId: "wf-001", correlationId: "corr-001", audio: wav(), format: "wav", language: "hi" };
  try {
    const readiness = await client.readiness();
    assert.equal(readiness.whisperReady, true);
    assert.equal(readiness.ready, false); // One ready language must not imply all four work.
    const result = await client.transcribe(request);
    assert.match(result.text, /नमस्ते/);
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.ok(!JSON.stringify(result).includes("192.168"));
    assert.equal("audio" in result, false);
    wrongBinding = true;
    await assert.rejects(client.transcribe(request), /could not be verified/);
    wrongBinding = false; busy = true;
    await assert.rejects(client.transcribe(request), error => !String(error).includes("hidden") && (error as any).code === "SPEECH_BUSY");
    const speech = await client.synthesize("INC001", "नमस्ते token=secret", VOICE_PROFILES.India);
    assert.equal(sentText, "नमस्ते token=[REDACTED]");
    assert.equal((await readFile(speech.outputPath)).toString("ascii", 0, 4), "RIFF");
    assert.equal(speech.audioSha256.length, 64);
    const liveVoiceAudio = await client.synthesizeVits("Hindi test", "hi");
    assert.equal(liveVoiceAudio.toString("ascii", 0, 4), "RIFF");
  } finally {
    client.close(); server.forceShutdown();
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("cloudzero-speech-test-")) throw new Error("Unexpected cleanup path.");
    await rm(directory, { recursive: true, force: true });
  }
});
