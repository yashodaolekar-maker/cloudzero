"""Local CPU speech worker. Audio is temporary; user text/audio are never logged."""
import concurrent.futures
import gc
import hmac
import json
import logging
import os
from pathlib import Path
import re
import tempfile
import threading
import subprocess
import numpy as np

import grpc
import torch
import whisper
from TTS.api import TTS
from huggingface_hub import snapshot_download
from transformers import AutoProcessor, AutoTokenizer, AutoModelForSeq2SeqLM, BarkModel
from scipy.io.wavfile import write as write_wav

import speech_pb2 as pb
import speech_pb2_grpc as rpc

MODELS = {
    "en": "tts_models/en/ljspeech/vits",
    "es": "tts_models/es/css10/vits",
    "zh": "tts_models/zh-CN/baker/tacotron2-DDC-GST",
    "hi": "tts_models/hin/fairseq/vits",
    "kn": "tts_models/kan/fairseq/vits",
    "ta": "tts_models/tam/fairseq/vits",
}
SAMPLES = {
    "en": "The incident is under investigation. No changes have been made.",
    "es": "El incidente est\u00e1 bajo investigaci\u00f3n. No se han realizado cambios.",
    "zh": "\u6211\u4eec\u6b63\u5728\u8c03\u67e5\u6b64\u4e8b\u4ef6\u3002\u5c1a\u672a\u8fdb\u884c\u4efb\u4f55\u66f4\u6539\u3002",
    "hi": "\u0918\u091f\u0928\u093e \u0915\u0940 \u091c\u093e\u0902\u091a \u091c\u093e\u0930\u0940 \u0939\u0948. \u0905\u092d\u0940 \u0915\u094b\u0908 \u092c\u0926\u0932\u093e\u0935 \u0928\u0939\u0940\u0902 \u0915\u093f\u092f\u093e \u0917\u092f\u093e \u0939\u0948.",
    "kn": "\u0c98\u0c9f\u0ca8\u0cc6\u0caf \u0ca4\u0ca8\u0cbf\u0c96\u0cc6 \u0ca8\u0ca1\u0cc6\u0caf\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6.",
    "ta": "\u0b9a\u0bae\u0bcd\u0baa\u0bb5\u0bae\u0bcd \u0bb5\u0bbf\u0b9a\u0bbe\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bc1\u0b95\u0bbf\u0bb1\u0ba4\u0bc1.",
}
MODEL_ROOT = Path("/models")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
BARK_MODEL = os.environ.get("BARK_MODEL", "suno/bark-small")
BARK_VOICE_PRESET = os.environ.get("BARK_VOICE_PRESET", "v2/en_speaker_6")
TRANSLATION_MODEL = os.environ.get("TRANSLATION_MODEL", "facebook/nllb-200-distilled-600M")
NLLB_LANGUAGES = {"en": "eng_Latn", "es": "spa_Latn", "zh": "zho_Hans", "hi": "hin_Deva", "kn": "kan_Knda", "ta": "tam_Taml"}
if WHISPER_MODEL not in {"tiny", "base", "small", "medium", "large", "turbo"}:
    raise RuntimeError("WHISPER_MODEL must be a multilingual Whisper model name.")
TOKEN = os.environ.get("SPEECH_SERVICE_ACCESS_TOKEN", "")
if len(TOKEN) < 16:
    raise RuntimeError("A speech service credential of at least 16 characters is required.")
torch.set_num_threads(2)


def identifier(value):
    return bool(re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", value))


class Speech(rpc.SpeechServiceServicer):
    def __init__(self):
        self.lock = threading.Lock()
        self.whisper = None
        self.whisper_ready = False
        self.ready = set()
        self.tts = None
        self.tts_language = None
        self.bark_processor = None
        self.bark = None
        self.translator_tokenizer = None
        self.translator = None

    def authorize(self, context):
        supplied = dict(context.invocation_metadata()).get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {TOKEN}"):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, "Invalid speech service identity.")

    def Capabilities(self, request, context):
        self.authorize(context)
        return pb.CapabilitiesResponse(
            whisper_ready=self.whisper_ready, whisper_model=WHISPER_MODEL,
            transcription_languages=sorted(whisper.tokenizer.LANGUAGES),
            synthesis_languages=[pb.SpeechLanguage(language=lang, model=model, ready=lang in self.ready) for lang, model in MODELS.items()],
            busy=self.lock.locked(),
        )

    def load_whisper(self):
        self.tts = None
        self.tts_language = None
        self.bark_processor = None
        self.bark = None
        gc.collect()
        if self.whisper is None:
            self.whisper = whisper.load_model(WHISPER_MODEL, device="cpu", download_root=str(MODEL_ROOT / "whisper"))
        self.whisper_ready = True
        return self.whisper

    def load_tts(self, language):
        self.whisper = None
        self.bark_processor = None
        self.bark = None
        gc.collect()
        if self.tts_language != language:
            self.tts = None
            gc.collect()
            if language == "zh":
                # Use the model mirror now listed by Coqui upstream. The old release ZIP is unreliable.
                folder = Path(snapshot_download("tts-hub/tacotron2_ddc_gst-zh-baker", revision="a0627207dca748e6362fd2e842a2e2a7f411ad72", allow_patterns=["config.json", "model.pth", "scale_stats.npy"]))
                config = json.loads((folder / "config.json").read_text())
                # Legacy Tacotron checkpoints use top-level model arguments, not an empty nested Coqpit.
                if not config.get("model_args"):
                    config["model_args"] = None
                config["audio"]["stats_path"] = str(folder / "scale_stats.npy")
                from spacy_pkuseg.config import config as pkuseg_config
                pkuseg_config.pkuseg_home = str(MODEL_ROOT / "pkuseg")
                config_path = MODEL_ROOT / "mandarin-config.json"
                config_path.write_text(json.dumps(config))
                self.tts = TTS(model_path=str(folder / "model.pth"), config_path=str(config_path), progress_bar=False).to("cpu")
            else:
                self.tts = TTS(model_name=MODELS[language], progress_bar=False).to("cpu")
            self.tts_language = language
        return self.tts

    def load_bark(self):
        self.whisper = None
        self.tts = None
        self.tts_language = None
        gc.collect()
        if self.bark is None:
            self.bark_processor = AutoProcessor.from_pretrained(BARK_MODEL, cache_dir=str(MODEL_ROOT / "bark"))
            self.bark = BarkModel.from_pretrained(BARK_MODEL, cache_dir=str(MODEL_ROOT / "bark"), torch_dtype=torch.float32).to("cpu")
            self.bark.eval()
        return self.bark_processor, self.bark

    def load_translator(self, source_language):
        self.whisper = None
        self.tts = None
        self.tts_language = None
        self.bark_processor = None
        self.bark = None
        gc.collect()
        if self.translator is None:
            self.translator_tokenizer = AutoTokenizer.from_pretrained(TRANSLATION_MODEL, cache_dir=str(MODEL_ROOT / "translation"), src_lang=NLLB_LANGUAGES[source_language])
            self.translator = AutoModelForSeq2SeqLM.from_pretrained(TRANSLATION_MODEL, cache_dir=str(MODEL_ROOT / "translation"), torch_dtype=torch.float32).to("cpu")
            self.translator.eval()
        self.translator_tokenizer.src_lang = NLLB_LANGUAGES[source_language]
        return self.translator_tokenizer, self.translator

    def warmup(self):
        with self.lock:
            try:
                self.load_whisper()
                print("Whisper model loaded.", flush=True)
            except Exception as error:
                print(f"Whisper setup failed ({type(error).__name__}).", flush=True)
            for language in MODELS:
                try:
                    with tempfile.TemporaryDirectory() as directory:
                        self.load_tts(language).tts_to_file(text=SAMPLES[language], file_path=str(Path(directory) / "test.wav"))
                    self.ready.add(language)
                    print(f"Coqui synthesis verified: {language}", flush=True)
                except Exception as error:
                    # No request data enters warmup; identify setup failures without user content.
                    print(f"Coqui setup failed: {language} ({type(error).__name__}: {str(error)[:250]}).", flush=True)
            self.tts = None
            self.tts_language = None
            gc.collect()

    def Transcribe(self, request, context):
        self.authorize(context)
        if not all(identifier(v) for v in [request.incident_id, request.workflow_id, request.correlation_id]):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Invalid incident binding.")
        if request.format not in {"wav", "webm", "mp3", "mp4", "m4a", "ogg", "flac"} or not 44 <= len(request.audio) <= 10 * 1024 * 1024:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Unsupported audio format or size.")
        if request.language and request.language not in whisper.tokenizer.LANGUAGES:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Unsupported transcription language.")
        if not self.lock.acquire(blocking=False):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "Speech worker is busy; retry later.")
        try:
            with tempfile.TemporaryDirectory() as directory:
                audio_path = Path(directory) / f"input.{request.format}"
                audio_path.write_bytes(request.audio)
                decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-i", str(audio_path), "-t", "121", "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", "16000", "-"], capture_output=True, check=True, timeout=30)
                audio = np.frombuffer(decoded.stdout, np.int16).astype(np.float32) / 32768.0
                duration = len(audio) / whisper.audio.SAMPLE_RATE
                if not 0 < duration <= 120:
                    context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Audio must be between 0 and 120 seconds.")
                if not context.is_active():
                    context.abort(grpc.StatusCode.CANCELLED, "Request cancelled.")
                result = self.load_whisper().transcribe(audio, language=request.language or None, task="transcribe", fp16=False, verbose=None, temperature=0)
                return pb.TranscribeResponse(incident_id=request.incident_id, workflow_id=request.workflow_id,
                    correlation_id=request.correlation_id, text=result["text"], language=result["language"],
                    model=WHISPER_MODEL, duration_seconds=duration)
        except grpc.RpcError:
            raise
        except Exception:
            context.abort(grpc.StatusCode.INTERNAL, "Local transcription failed.")
        finally:
            self.lock.release()

    def Translate(self, request, context):
        self.authorize(context)
        if (not identifier(request.incident_id) or not identifier(request.correlation_id)
                or request.source_language not in NLLB_LANGUAGES or request.target_language not in NLLB_LANGUAGES
                or not 1 <= len(request.text.strip()) <= 2500):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Invalid translation request.")
        if not self.lock.acquire(blocking=False):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "Speech worker is busy; retry later.")
        try:
            tokenizer, model = self.load_translator(request.source_language)
            encoded = tokenizer(request.text, return_tensors="pt", truncation=True, max_length=768)
            with torch.inference_mode():
                output = model.generate(**encoded, forced_bos_token_id=tokenizer.convert_tokens_to_ids(NLLB_LANGUAGES[request.target_language]), max_new_tokens=768, num_beams=4)
            translated = tokenizer.batch_decode(output, skip_special_tokens=True)[0].strip()
            if not translated:
                context.abort(grpc.StatusCode.INTERNAL, "Translation returned no text.")
            return pb.TranslateResponse(incident_id=request.incident_id, correlation_id=request.correlation_id,
                text=translated, source_language=request.source_language, target_language=request.target_language, model=TRANSLATION_MODEL)
        except grpc.RpcError:
            raise
        except Exception as error:
            print(f"Translation failed: {type(error).__name__}: {str(error)[:300]}", flush=True)
            context.abort(grpc.StatusCode.INTERNAL, "Local translation failed.")
        finally:
            self.lock.release()

    def Synthesize(self, request, context):
        self.authorize(context)
        engine = request.engine or "coqui"
        if not identifier(request.incident_id) or not identifier(request.correlation_id) or request.language not in MODELS or engine not in {"coqui", "bark"} or not 1 <= len(request.text.strip()) <= 2500:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Invalid synthesis request.")
        if not self.lock.acquire(blocking=False):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "Speech worker is busy; retry later.")
        try:
            with tempfile.TemporaryDirectory() as directory:
                audio_path = Path(directory) / "output.wav"
                # Coqui prints input text during inference. Suppress it at the worker boundary.
                import contextlib
                previous_logging = logging.root.manager.disable
                try:
                    logging.disable(logging.CRITICAL)
                    with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                        if engine == "bark":
                            processor, model = self.load_bark()
                            preset = request.voice_preset or BARK_VOICE_PRESET
                            inputs = processor(request.text, voice_preset=preset, return_tensors="pt")
                            with torch.inference_mode():
                                samples = model.generate(**inputs, do_sample=True, temperature=0.6)
                            sampling_rate = model.generation_config.sample_rate
                            write_wav(str(audio_path), sampling_rate, samples.cpu().numpy().squeeze())
                        else:
                            self.load_tts(request.language).tts_to_file(text=request.text, file_path=str(audio_path))
                finally:
                    logging.disable(previous_logging)
                audio = audio_path.read_bytes()
                if len(audio) > 20 * 1024 * 1024:
                    context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "Synthesized audio exceeds the size limit.")
                self.ready.add(request.language)
                return pb.SynthesizeResponse(incident_id=request.incident_id, correlation_id=request.correlation_id,
                    audio=audio, model=BARK_MODEL if engine == "bark" else MODELS[request.language], language=request.language)
        except grpc.RpcError:
            raise
        except Exception as error:
            print(f"Speech synthesis failed ({engine}): {type(error).__name__}: {str(error)[:300]}", flush=True)
            context.abort(grpc.StatusCode.INTERNAL, "Local speech synthesis failed.")
        finally:
            self.lock.release()


if __name__ == "__main__":
    server = grpc.server(concurrent.futures.ThreadPoolExecutor(max_workers=4), options=[
        ("grpc.max_receive_message_length", 11 * 1024 * 1024), ("grpc.max_send_message_length", 21 * 1024 * 1024)])
    worker = Speech()
    rpc.add_SpeechServiceServicer_to_server(worker, server)
    server.add_insecure_port("0.0.0.0:50052")
    server.start()
    threading.Thread(target=worker.warmup, daemon=True).start()
    print("Local speech gRPC worker listening on port 50052.", flush=True)
    server.wait_for_termination()
