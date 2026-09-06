// ── Voice for Claude Chat ───────────────────────────────────────────────────
// Speech-to-text: Whisper running locally in the renderer via transformers.js
// (model downloads once from the HF CDN, then cached by the browser — no
// cloud STT service, no API key). English uses the small English-only model;
// other languages use the multilingual model with a language hint.
// Text-to-speech: the OS voices through speechSynthesis (offline), chunked
// into sentences — Chromium silently drops very long utterances.

export interface VoiceLang {
  code: string;      // selector value
  label: string;     // shown in the dropdown (native script)
  name: string;      // English name — used in the "answer in …" instruction
  tts: string;       // BCP-47 tag for speech synthesis
  whisper: string;   // whisper language name
}

export const VOICE_LANGS: VoiceLang[] = [
  { code: 'en', label: 'English', name: 'English', tts: 'en-US', whisper: 'english' },
  { code: 'ar', label: 'العربية', name: 'Arabic', tts: 'ar-SA', whisper: 'arabic' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi', tts: 'hi-IN', whisper: 'hindi' },
  { code: 'ur', label: 'اردو', name: 'Urdu', tts: 'ur-PK', whisper: 'urdu' },
  { code: 'ml', label: 'മലയാളം', name: 'Malayalam', tts: 'ml-IN', whisper: 'malayalam' },
  { code: 'ta', label: 'தமிழ்', name: 'Tamil', tts: 'ta-IN', whisper: 'tamil' },
  { code: 'fr', label: 'Français', name: 'French', tts: 'fr-FR', whisper: 'french' },
];

export const voiceLangByCode = (code: string): VoiceLang =>
  VOICE_LANGS.find(l => l.code === code) || VOICE_LANGS[0];

type ProgressCb = (info: { status: string; progress?: number; file?: string }) => void;
type AsrFn = (audio: Float32Array, lang: VoiceLang) => Promise<string>;

// one pipeline per model, loaded lazily and kept for the session
const asrCache: Record<string, Promise<AsrFn>> = {};

function ensureAsr(model: string, onProgress?: ProgressCb): Promise<AsrFn> {
  if (!asrCache[model]) {
    asrCache[model] = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      const pipe = await pipeline('automatic-speech-recognition', model, {
        progress_callback: onProgress as unknown as (x: unknown) => void,
      });
      return async (audio: Float32Array, lang: VoiceLang) => {
        const opts: Record<string, unknown> = { chunk_length_s: 30 };
        if (!model.endsWith('.en')) { opts.language = lang.whisper; opts.task = 'transcribe'; }
        const out = await pipe(audio, opts) as { text?: string };
        return String(out?.text || '').trim();
      };
    })();
    asrCache[model].catch(() => { delete asrCache[model]; }); // allow retry after a failed download
  }
  return asrCache[model];
}

// decode the recorded blob to 16 kHz mono PCM (Chromium resamples in
// decodeAudioData when the context is created at the target rate)
export async function transcribeBlob(blob: Blob, langCode: string, onProgress?: ProgressCb): Promise<string> {
  const lang = voiceLangByCode(langCode);
  const model = lang.code === 'en' ? 'Xenova/whisper-base.en' : 'Xenova/whisper-base';
  const run = await ensureAsr(model, onProgress);
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(buf);
    return await run(decoded.getChannelData(0), lang);
  } finally {
    ctx.close();
  }
}

// ── text-to-speech ──────────────────────────────────────────────────────────

// voices load asynchronously in Chromium — warm the list early
try {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
} catch { /* no speechSynthesis (tests) */ }

function pickVoice(lang: VoiceLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const prefix = lang.tts.slice(0, 2).toLowerCase();
  const match = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  return match.find(v => /natural|neural|online/i.test(v.name)) || match[0];
}

// make an assistant answer speakable: drop code, replace tables with a cue,
// strip markdown, cap the length
export function speakableText(md: string): string {
  let t = md
    .replace(/```[\s\S]*?```/g, ' (code shown on screen) ')
    .replace(/(?:^\|.*\|[ \t]*$\n?)+/gm, ' The table is shown on screen. ')
    .replace(/\*\*/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 1600) t = `${t.slice(0, 1600)}…`;
  return t;
}

// a bumped session id cancels whatever is playing (neural audio or synth queue)
let speakSession = 0;
let currentAudio: HTMLAudioElement | null = null;

type TtsApi = { claudeVoiceTts?: (o: { text: string; lang: string }) => Promise<{ success: boolean; base64?: string; error?: string }> };

// Natural speech first: neural MP3 synthesized in the main process (Edge
// read-aloud voices — the same family mobile assistants use). Falls back to
// the OS speechSynthesis voices when the service is unreachable.
export function speak(text: string, langCode: string, onEnd?: () => void): void {
  const session = ++speakSession;
  stopPlayback();
  (async () => {
    const eAPI = (window as unknown as { electronAPI?: TtsApi }).electronAPI;
    if (eAPI?.claudeVoiceTts) {
      try {
        const r = await eAPI.claudeVoiceTts({ text: text.slice(0, 2500), lang: langCode });
        if (session !== speakSession) return; // superseded while synthesizing
        if (r?.success && r.base64) {
          const audio = new Audio(`data:audio/mp3;base64,${r.base64}`);
          currentAudio = audio;
          audio.onended = () => { if (session === speakSession) { currentAudio = null; onEnd?.(); } };
          audio.onerror = () => { if (session === speakSession) { currentAudio = null; speakWithSynth(text, langCode, session, onEnd); } };
          await audio.play();
          return;
        }
      } catch { /* fall through to synth */ }
      if (session !== speakSession) return;
    }
    speakWithSynth(text, langCode, session, onEnd);
  })();
}

// chunked speechSynthesis fallback: Chromium silently drops long utterances,
// so split into sentence-sized parts and queue them
function speakWithSynth(text: string, langCode: string, session: number, onEnd?: () => void): void {
  const lang = voiceLangByCode(langCode);
  try {
    window.speechSynthesis.cancel();
    // sentence split incl. Arabic ؟ and Devanagari ।, then merge to ≤ 220 chars
    const sentences = text.match(/[^.!?؟।]+[.!?؟।]*/g)?.map(s => s.trim()).filter(Boolean) ?? [text];
    const parts: string[] = [];
    let cur = '';
    for (const s of sentences) {
      if (cur && (`${cur} ${s}`).length > 220) { parts.push(cur); cur = s; }
      else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) parts.push(cur);

    let i = 0;
    const next = () => {
      if (session !== speakSession) return; // cancelled / superseded
      if (i >= parts.length) { onEnd?.(); return; }
      const u = new SpeechSynthesisUtterance(parts[i]);
      i += 1;
      u.lang = lang.tts;
      const v = pickVoice(lang);
      if (v) u.voice = v;
      u.rate = 1.02;
      u.onend = next;
      u.onerror = next;
      window.speechSynthesis.speak(u);
    };
    next();
  } catch {
    onEnd?.();
  }
}

function stopPlayback(): void {
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio = null;
  }
}

export function stopSpeaking(): void {
  speakSession += 1;
  stopPlayback();
}

// true when Windows has a voice installed for this language — used to warn
// instead of speaking silence
export function hasVoiceFor(langCode: string): boolean {
  try { return !!pickVoice(voiceLangByCode(langCode)); } catch { return false; }
}
