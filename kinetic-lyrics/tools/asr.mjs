// Speech to word timings with Parakeet (through the HyperFrames CLI), in 10-minute chunks:
// long files in one go break the CLI's timeout.
//
//   transcribe(file) → [{ text, start, end }]   (seconds in the file)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const duration = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const wordsOf = (d) => (Array.isArray(d) ? d : d.words);

// the HyperFrames CLI: one on the PATH (e.g. installed by the host agent), else the version this project pins
function hyperframes() {
  const r = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? ["hyperframes"] : ["npx", "--yes", "hyperframes@0.8.141"];
}

export function transcribe(file, { log = () => {} } = {}) {
  const CH = 600, OV = 10; // 10-minute chunks, 10 s overlap so no word is cut in half
  const total = duration(file);
  const [cmd, ...pre] = hyperframes();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-asr-"));
  const all = [];
  try {
    for (let k = 0; k * CH < total; k++) {
      const dir = path.join(tmp, `c${k}`);
      fs.mkdirSync(dir);
      const wav = path.join(dir, "chunk.wav");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(k * CH), "-t", String(CH + OV), "-i", file, "-vn", "-ac", "1", "-ar", "16000", wav]);
      if (total > CH) log(`  transcribe: ${Math.round((k * CH) / 60)}–${Math.round(Math.min(total, (k + 1) * CH) / 60)} min …`);
      execFileSync(cmd, [...pre, "transcribe", "chunk.wav", "-e", "parakeet", "--json"], { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
      const words = wordsOf(JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8")));
      // keep each word once: a chunk owns [k*CH + OV/2, (k+1)*CH + OV/2)
      const lo = k ? OV / 2 : -1, hi = CH + OV / 2;
      for (const w of words) if (w.start >= lo && w.start < hi) all.push({ text: w.text, start: +(w.start + k * CH).toFixed(3), end: +(w.end + k * CH).toFixed(3) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return all;
}
