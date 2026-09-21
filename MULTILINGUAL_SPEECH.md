# Local Whisper and Coqui speech

Open **ServiceNow**, select an incident, and use **Listen and speak in your language**.

1. Record up to two minutes or upload WAV, WebM, MP3, MP4/M4A, Ogg or FLAC (10 MB maximum).
2. Select the spoken language or let Whisper detect it. The transcript remains in the original language.
3. Review the transcript. Recognition can mishear technical terms, numbers and names.
4. Select the speech language, enter or edit text in that language, and choose **Generate Coqui speech**.
5. Play the generated audio using the embedded player.

The new controls do not translate text, invoke incident commands, or publish to a bridge.
The existing automatic incident-summary translation flow still requires separately configured Gemini translation.

## Runtime

`compose.yaml` starts a private `cloudzero-speech` gRPC sidecar. It runs the actual
`openai-whisper` package locally with the multilingual `base` model on CPU, plus
Coqui TTS. No OpenAI API key or hosted transcription call is involved. Models are
downloaded on first startup and cached in `cloudzero_speech_models`; input recordings
are processed in temporary storage and deleted afterward. Only one inference runs at
a time to limit CPU/memory use. During model setup or another request, callers receive
an explicit busy response and can retry.

| Speech language | Coqui model |
| --- | --- |
| English | `tts_models/en/ljspeech/vits` |
| Spanish | `tts_models/es/css10/vits` |
| Mandarin | `tts_models/zh-CN/baker/tacotron2-DDC-GST` |
| Hindi | `tts_models/hin/fairseq/vits` |

These replace the invalid legacy Mandarin and Hindi model identifiers. Hindi uses
the Fairseq/MMS model through Coqui; its model weights have a noncommercial license.
Review the upstream model license before using those weights in a commercial deployment.
No voice cloning or custom speaker enrollment is used.

`GET /api/voice/readiness` reports Whisper availability, supported transcription
language codes, individual Coqui synthesis checks and worker busy state. A Coqui
language is marked ready only after generating a real sample WAV. Loading packages
alone does not mark a model ready.

Start or rebuild with `./scripts/podman-up.ps1`. On subsequent starts the model cache
is reused; a short synthesis warmup verifies each language again. CPU inference is
slower than GPU inference. `WHISPER_MODEL` in the speech service can select another
multilingual Whisper size if hardware permits.

## API

```text
POST /api/incidents/:incidentId/transcribe?language=hi
Content-Type: audio/wav
Body: binary audio (omit language for detection)

POST /api/incidents/:incidentId/speech
Content-Type: application/json
Body: {"language":"hi","text":"घटना की जाँच जारी है।"}

GET /api/incidents/:incidentId/voice-audio
GET /api/voice/readiness
```

The API requires an existing incident and an authorized engineering role. The server
creates the voice workflow binding; clients cannot pick an unrelated workflow.
Every inference request is recorded before dispatch. Completed transcripts are
redacted while retaining Unicode, marked unverified and recorded in the incident
ledger. Raw input audio is neither persisted in PostgreSQL nor added to the knowledge
index. Speech output is a checksum-verified WAV. User-entered text is explicitly
identified as user-provided rather than machine-verified incident evidence.

`proto/speech.proto` defines the authenticated service boundary. In production, use
TLS termination/service-mesh identity for the private sidecar and configure the Node
client's trusted TLS endpoint. The bundled Compose deployment uses the isolated
local container network and exposes no speech port on the host.

## Validation and references

`npm run test:voice` checks audio formats, Unicode redaction, response binding,
partial readiness, gRPC transport and WAV validation. Real model checks run during
sidecar startup; inspect readiness and container logs for setup failures.

- [OpenAI Whisper source and multilingual model documentation](https://github.com/openai/whisper)
- [Coqui installation](https://coqui-tts.readthedocs.io/en/latest/installation.html)
- [Coqui synthesis and Fairseq language models](https://coqui-tts.readthedocs.io/en/latest/inference.html)
- [Coqui model registry](https://github.com/idiap/coqui-ai-TTS/blob/dev/TTS/.models.json)
- [MMS model card and licensing](https://github.com/facebookresearch/fairseq/tree/main/examples/mms)
