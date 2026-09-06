// ── Voice for Claude Chat ───────────────────────────────────────────────────
// Speech-to-text: Whisper running locally in the renderer via transformers.js
// (model downloads once from the HF CDN, then cached by the browser — no
// cloud STT service, no API key). Text-to-speech: the OS voices through
// speechSynthesis (offline, built into Chromium/Windows).

type ProgressCb = (info: { status: string; progress?: number; file?: string }) => void;

// the pipeline is loaded lazily and kept for the session
let asrPromise: Promise<(audio: Float32Array) => Promise<string>> | null = null;

export function ensureAsr(onProgress?: ProgressCb): Promise<(audio: Float32Array) => Promise<string>> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
        progress_callback: onProgress as unknown as (x: unknown) => void,
      });
      return async (audio: Float32Array) => {
        const out = await pipe(audio, { chunk_length_s: 30 }) as { text?: string };
        return String(out?.text || '').trim();
      };
    })();
    asrPromise.catch(() => { asrPromise = null; }); // allow retry after a failed download
  }
  return asrPromise;
}

// decode the recorded blob to 16 kHz mono PCM (Chromium resamples in
// decodeAudioData when the context is created at the target rate)
export async function transcribeBlob(blob: Blob, onProgress?: ProgressCb): Promise<string> {
  const run = await ensureAsr(onProgress);
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(buf);
    return await run(decoded.getChannelData(0));
  } finally {
    ctx.close();
  }
}

// ── text-to-speech ──────────────────────────────────────────────────────────

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
  if (t.length > 1200) t = `${t.slice(0, 1200)}… the rest is on screen.`;
  return t;
}

export function speak(text: string, onEnd?: () => void): void {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find(v => /en[-_]/i.test(v.lang) && /natural|neural/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (en) u.voice = en;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  } catch {
    onEnd?.();
  }
}

export function stopSpeaking(): void {
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}
