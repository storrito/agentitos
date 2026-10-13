// Stretches where the audio is clearly speech but the transcript has no words –
// the ASR skipped a passage. Shared by the QA (reports them) and repair.mjs (fills them).
import { execFileSync } from "node:child_process";

// 10 ms RMS envelope of the audio, mono 16 kHz
export function envelope(audio) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", audio, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const hop = 160, n = Math.floor(x.length / hop), env = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i]; env[f] = Math.sqrt(s / hop); }
  return env;
}

// [{a, b, voiced}] in seconds: word gaps ≥ minGap whose audio is voiced for more than `share`
export function voicedGaps(audio, words, { minGap = 1.5, share = 0.45 } = {}) {
  const env = envelope(audio), n = env.length;
  const thr = Math.max(Float32Array.from(env).sort()[Math.floor(n * 0.95)] * 0.1, 0.004);
  const ws = words;
  const gaps = [[0, ws[0]?.start ?? 0], ...ws.slice(1).map((w, i) => [ws[i].end, w.start]), [ws[ws.length - 1]?.end ?? 0, n / 100]];
  const out = [];
  for (const [a, b] of gaps) {
    if (b - a < minGap) continue;
    let v = 0;
    for (let f = Math.floor(a * 100); f < Math.min(n, Math.floor(b * 100)); f++) if (env[f] > thr) v++;
    const voiced = v / ((b - a) * 100);
    if (voiced > share) out.push({ a, b, voiced });
  }
  return out;
}
