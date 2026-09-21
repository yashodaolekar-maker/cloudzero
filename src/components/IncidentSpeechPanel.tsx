import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, Upload, Loader2 } from "lucide-react";

const languages = [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }, { code: "zh", name: "Mandarin" }, { code: "hi", name: "Hindi" }, { code: "kn", name: "Kannada" }, { code: "ta", name: "Tamil" }];
type Readiness = { whisperReady?: boolean; busy?: boolean; synthesisLanguages?: { language: string; ready: boolean }[] };

export const IncidentSpeechPanel: React.FC<{ incidentId: string }> = ({ incidentId }) => {
  const [inputLanguage, setInputLanguage] = useState("");
  const [outputLanguage, setOutputLanguage] = useState("en");
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"transcription" | "speech" | null>(null);
  const [readiness, setReadiness] = useState<Readiness>({});
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const base = `/api/incidents/${encodeURIComponent(incidentId)}`;

  useEffect(() => {
    mounted.current = true;
    const statusController = new AbortController();
    const check = () => fetch("/api/voice/readiness", { signal: statusController.signal }).then(r => r.json()).then(data => {
      if (mounted.current) setReadiness(data.coqui || {});
    }).catch(() => {});
    void check();
    const interval = setInterval(check, 15_000);
    return () => {
      mounted.current = false; clearInterval(interval); statusController.abort(); pending.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); }
      stream.current?.getTracks().forEach(track => track.stop());
      audioRef.current?.pause();
    };
  }, [incidentId]);

  const request = async (url: string, options: RequestInit) => {
    pending.current = new AbortController();
    const response = await fetch(url, { ...options, signal: pending.current.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The speech request failed. Please retry.");
    return data;
  };
  const transcribe = async (audio: Blob, mime: string) => {
    if (audio.size > 10 * 1024 * 1024) { setError("Recordings must be under 10 MB and two minutes."); return; }
    setBusy("transcription"); setError("");
    try {
      const data = await request(`${base}/transcribe?language=${encodeURIComponent(inputLanguage)}`, { method: "POST", headers: { "Content-Type": mime }, body: audio });
      if (!mounted.current) return;
      setTranscript(data.transcript.text);
      setText(data.transcript.text.slice(0, 2_500));
      setSourceLanguage(data.transcript.language || inputLanguage || "en");
      if (languages.some(l => l.code === data.transcript.language)) setOutputLanguage(data.transcript.language);
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(null); }
  };
  const toggleRecording = async () => {
    if (recorder.current?.state === "recording") { recorder.current.stop(); return; }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Microphone recording is unavailable here. Upload an audio file instead.");
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { capture.getTracks().forEach(t => t.stop()); return; }
      stream.current = capture;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) { capture.getTracks().forEach(t => t.stop()); throw new Error("This browser has no supported recording format. Upload an audio file instead."); }
      const active = new MediaRecorder(capture, { mimeType: mime });
      recorder.current = active;
      const chunks: Blob[] = [];
      let bytes = 0;
      active.ondataavailable = event => {
        chunks.push(event.data); bytes += event.data.size;
        if (bytes > 10 * 1024 * 1024 && active.state === "recording") active.stop();
      };
      active.onerror = () => { setError("Microphone recording failed. Upload a recording instead."); capture.getTracks().forEach(t => t.stop()); setRecording(false); };
      active.onstop = () => {
        capture.getTracks().forEach(t => t.stop());
        if (timer.current) clearTimeout(timer.current);
        if (mounted.current) { setRecording(false); void transcribe(new Blob(chunks, { type: mime }), mime); }
      };
      active.start(1_000); setRecording(true);
      timer.current = setTimeout(() => { if (active.state === "recording") active.stop(); }, 115_000);
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
  };
  const synthesize = async () => {
    setBusy("speech"); setError(""); setAudioUrl("");
    try {
      const data = await request(`${base}/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: outputLanguage, text, sourceLanguage, translate: outputLanguage !== "en" }) });
      const url = new URL(data.voice.audioUrl, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("The speech service returned an invalid audio URL.");
      if (mounted.current) { setAudioUrl(`${url.pathname}?v=${encodeURIComponent(data.voice.audioSha256)}`); setTranslatedText(data.voice.translatedSummary || ""); }
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(null); }
  };
  const inputClass = "rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  return <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40" aria-label="Multilingual speech tools">
    <h3 className="font-semibold text-slate-900 dark:text-white">Listen and speak in your language</h3>
    <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Whisper transcribes locally. The local language model translates; Coqui VITS creates speech. Recordings are deleted after processing.</p>
    <p className="mt-2 text-xs text-slate-500" role="status">{readiness.busy ? "Speech worker is busy or loading models." : readiness.whisperReady ? "Whisper is ready." : "Whisper is starting or unavailable."} Coqui ready: {languages.filter(l => readiness.synthesisLanguages?.some(s => s.language === l.code && s.ready)).map(l => l.name).join(", ") || "loading language models"}.</p>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <label className="text-xs">Recording language <select aria-label="Recording language" className={`${inputClass} ml-2`} value={inputLanguage} disabled={!!busy || recording} onChange={e => setInputLanguage(e.target.value)}>
        <option value="">Detect automatically</option>{languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select></label>
      <button type="button" disabled={!!busy} onClick={toggleRecording} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">{recording ? <Square size={15} /> : <Mic size={15} />}{recording ? "Stop and transcribe" : "Record"}</button>
      <label className={`${inputClass} inline-flex cursor-pointer items-center gap-2`}><Upload size={15} /> Upload audio
        <input aria-label="Upload audio for Whisper transcription" className="sr-only" type="file" accept=".wav,.webm,.mp3,.mp4,.m4a,.ogg,.flac" disabled={!!busy || recording} onChange={e => {
          const file = e.target.files?.[0]; e.target.value = "";
          if (file) {
            const extension = file.name.split(".").pop()?.toLowerCase();
            const mime = ({ wav: "audio/wav", webm: "audio/webm", mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac" } as Record<string, string>)[extension || ""] || file.type;
            void transcribe(file, mime);
          }
        }} />
      </label>
    </div>
    {transcript && <div className="mt-3"><p className="text-xs font-medium text-amber-700 dark:text-amber-400">Review the transcript before using it. Speech recognition may contain errors; it does not execute commands.</p><p className="mt-2 whitespace-pre-wrap text-sm" lang={inputLanguage || undefined}>{transcript}</p></div>}
    {!transcript && <p className="mt-2 text-xs text-slate-500">For short Hindi, Mandarin, Kannada or Tamil recordings, select the recording language instead of automatic detection for better accuracy.</p>}
    <div className="mt-4 flex items-center gap-2"><label className="text-xs">Speech language <select aria-label="Speech language" className={`${inputClass} ml-2`} value={outputLanguage} onChange={e => setOutputLanguage(e.target.value)}>{languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select></label></div>
    <label className="mt-3 block text-xs text-slate-500" htmlFor={`speech-text-${incidentId}`}>Text to translate and read aloud. Native text in the selected language is preserved.</label>
    <textarea id={`speech-text-${incidentId}`} className={`${inputClass} mt-2 min-h-24 w-full`} maxLength={2500} value={text} lang={sourceLanguage} onChange={e => { setText(e.target.value); if (!transcript || e.target.value !== transcript) setSourceLanguage("en"); }} placeholder="Type a briefing or review the transcript here…" />
    <button type="button" onClick={synthesize} disabled={!!busy || recording || !text.trim()} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy === "speech" ? <Loader2 size={15} className="animate-spin" /> : <Volume2 size={15} />}{busy === "speech" ? "Translating and generating speech…" : outputLanguage === "en" ? "Generate local speech" : "Translate & generate speech"}</button>
    {translatedText && outputLanguage !== "en" && <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-zinc-800"><p className="text-xs font-medium text-slate-500">Translated text used for speech</p><p className="mt-1 whitespace-pre-wrap text-sm" lang={outputLanguage}>{translatedText}</p></div>}
    {busy === "transcription" && <p className="mt-2 text-sm" role="status">Transcribing your recording…</p>}
    {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
    {audioUrl && <audio ref={audioRef} className="mt-3 w-full" controls src={audioUrl} aria-label="Generated Coqui speech" />}
  </section>;
};
