import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UserRole, type ServiceNowIncident, type SSOUser } from "../../../types.ts";
import {
  CoquiLocalSynthesizer,
  VOICE_PROFILES,
  VoicePipelineError,
  incidentVoiceDirectory,
  incidentVoicePath,
  resolveVoiceProfile,
  type CommandRunner,
  type CommandRunnerOptions
} from "../../multilingual-voice.ts";

function incident(overrides: Partial<ServiceNowIncident> = {}): ServiceNowIncident {
  return {
    id: "INC-TEST-1001",
    cmdbItem: "test-service",
    cmdbName: "Test Service",
    category: "Wireless",
    shortDescription: "Regional service degradation detected.",
    status: "New",
    assignedTo: "Unassigned",
    severity: "P1 - Critical",
    openedAt: "2026-01-01T00:00:00.000Z",
    elapsedMinutes: 1,
    workNotes: [],
    ...overrides
  };
}

function user(overrides: Partial<SSOUser> = {}): SSOUser {
  return {
    id: "user-test",
    name: "Test Operator",
    email: "operator@example.test",
    role: UserRole.NRE,
    department: "Network Reliability Engineering",
    avatar: "",
    ...overrides
  };
}

function minimalWave(): Buffer {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(0, 40);
  return wav;
}

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cloudzero-voice-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("voice profiles use the exact required locale and Coqui model mapping", () => {
  assert.deepEqual(VOICE_PROFILES, {
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
  });
});

test("ticket metadata takes precedence over the user profile", () => {
  const profile = resolveVoiceProfile(
    incident({ metadata: { country: "Mexico" } }),
    user({ region: "India", locale: "hi-IN" })
  );

  assert.equal(profile.region, "Mexico");
  assert.equal(profile.regionSource, "TICKET_METADATA");
  assert.equal(profile.languageCode, "es-MX");
});

test("region aliases resolve case-insensitively and unsupported values default to English", () => {
  assert.equal(resolveVoiceProfile(incident({ region: "México" })).region, "Mexico");
  assert.equal(resolveVoiceProfile(incident({ metadata: { u_country: "PRC" } })).region, "China");
  assert.equal(resolveVoiceProfile(incident(), user({ locale: "HI-in" })).region, "India");

  const fallback = resolveVoiceProfile(incident({ metadata: { country: "Canada" } }), user({ region: "Canada" }));
  assert.equal(fallback.region, "Default");
  assert.equal(fallback.regionSource, "DEFAULT");
  assert.equal(fallback.languageCode, "en-US");
});

test("incident output remains inside its storage root and uses the required filename", async () => {
  await withTemporaryDirectory(async storageRoot => {
    const unsafeIncidentId = "../../outside/INC:1001?*";
    const outputDirectory = incidentVoiceDirectory(storageRoot, unsafeIncidentId);
    const outputPath = incidentVoicePath(storageRoot, unsafeIncidentId);
    const relativeDirectory = path.relative(path.resolve(storageRoot), outputDirectory);

    assert.equal(path.isAbsolute(outputDirectory), true);
    assert.equal(relativeDirectory === ".." || relativeDirectory.startsWith(`..${path.sep}`), false);
    assert.equal(path.isAbsolute(relativeDirectory), false);
    assert.equal(path.dirname(outputPath), outputDirectory);
    assert.equal(path.basename(outputPath), "incident_voice_output.wav");
    assert.notEqual(
      incidentVoiceDirectory(storageRoot, unsafeIncidentId),
      incidentVoiceDirectory(storageRoot, unsafeIncidentId.replace(":", "/")),
      "the hash suffix must prevent collisions between differently unsafe IDs"
    );
  });
});

test("Coqui invocation uses execFile-style arguments and returns a verified WAV checksum", async () => {
  await withTemporaryDirectory(async storageRoot => {
    const wav = minimalWave();
    let invocation: { command: string; args: string[]; options: CommandRunnerOptions } | undefined;
    const runner: CommandRunner = async (command, args, options) => {
      invocation = { command, args: [...args], options };
      const outputArgumentIndex = args.indexOf("--out_path");
      assert.notEqual(outputArgumentIndex, -1);
      await writeFile(args[outputArgumentIndex + 1], wav);
      return { stdout: "synthesized" };
    };
    const synthesizer = new CoquiLocalSynthesizer(storageRoot, runner);

    const result = await synthesizer.synthesize(
      "INC-MX-1001",
      "  Alerta   regional\nactiva.  ",
      VOICE_PROFILES.Mexico
    );

    assert.ok(invocation);
    assert.equal(invocation.command, "tts");
    assert.deepEqual(invocation.args.slice(0, 4), [
      "--text",
      "Alerta regional activa.",
      "--model_name",
      "tts_models/es/css10/vits"
    ]);
    assert.equal(invocation.args[4], "--out_path");
    assert.match(invocation.args[5], /\.incident_voice_output-[a-f0-9-]+\.wav$/);
    assert.equal(invocation.options.windowsHide, true);
    assert.equal(invocation.options.maxBuffer, 2 * 1024 * 1024);
    assert.equal(invocation.options.timeout, 180_000);
    assert.equal(result.outputPath, incidentVoicePath(storageRoot, "INC-MX-1001"));
    assert.equal(path.basename(result.outputPath), "incident_voice_output.wav");
    assert.deepEqual(await readFile(result.outputPath), wav);
    assert.equal(result.audioSha256, crypto.createHash("sha256").update(wav).digest("hex"));
  });
});

test("invalid Coqui output is rejected and never promoted to the final WAV", async () => {
  await withTemporaryDirectory(async storageRoot => {
    const runner: CommandRunner = async (_command, args) => {
      await writeFile(args[args.indexOf("--out_path") + 1], Buffer.alloc(44));
      return {};
    };
    const synthesizer = new CoquiLocalSynthesizer(storageRoot, runner);

    await assert.rejects(
      synthesizer.synthesize("INC-BAD-WAV", "Incident update", VOICE_PROFILES.Default),
      (error: unknown) => {
        assert.ok(error instanceof VoicePipelineError);
        assert.equal(error.code, "INVALID_WAV");
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
    await assert.rejects(readFile(incidentVoicePath(storageRoot, "INC-BAD-WAV")), { code: "ENOENT" });
  });
});

test("a missing local Coqui command produces a typed service-unavailable failure", async () => {
  await withTemporaryDirectory(async storageRoot => {
    const runner: CommandRunner = async () => {
      throw Object.assign(new Error("spawn tts ENOENT"), { code: "ENOENT" });
    };
    const synthesizer = new CoquiLocalSynthesizer(storageRoot, runner);

    await assert.rejects(
      synthesizer.synthesize("INC-NO-COQUI", "Incident update", VOICE_PROFILES.Default),
      (error: unknown) => {
        assert.ok(error instanceof VoicePipelineError);
        assert.equal(error.code, "COQUI_NOT_INSTALLED");
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /Coqui command 'tts' was not found/);
        return true;
      }
    );
  });
});
