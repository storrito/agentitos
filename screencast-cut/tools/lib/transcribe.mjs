// The words of a recording, from agentitos' transcribe skill, which keeps the one transcription
// (ElevenLabs Scribe, or Gemini with speakers, through OpenRouter): TRANSCRIBE, else beside this
// skill, else in the machine's clone of the skills. This skill keeps no transcription of its own.
//
//   transcribeTool()                                → its tools/transcribe.mjs, or null
//   transcribeFile(file, { speakers, lang, log, timeout })   → { engine, model, duration, cost, words }
//                                                    (its progress lines go to log; an error throws
//                                                    the tool's sentence; timeout: seconds after which
//                                                    the tool and what it started are stopped, throws)
//   NEEDS_TRANSCRIBE                                → the sentence for when it is missing

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NEEDS_TRANSCRIBE = "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs).";

export function transcribeTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.TRANSCRIBE, path.join(skill, "..", "transcribe", "tools", "transcribe.mjs"), "/home/sprite/skills/transcribe/tools/transcribe.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export async function transcribeFile(file, { speakers = false, lang, log = () => {}, timeout = 0 } = {}) {
  const tool = transcribeTool();
  if (!tool) throw new Error(NEEDS_TRANSCRIBE);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-words-"));
  const out = path.join(tmp, "words.json");
  const args = [tool, file, "--out", out, ...(speakers ? ["--speakers"] : []), ...(lang && lang !== "auto" ? ["--lang", lang] : [])];
  try {
    const { code, said } = await new Promise((ok, no) => {
      // with a time limit the tool runs in a group of its own, so that its own children stop with it
      const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], ...(timeout ? { detached: true } : {}) });
      let said = "", rest = "", over = false;
      const timer = timeout ? setTimeout(() => { over = true; try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, timeout * 1000) : null;
      child.stdout.on("data", (d) => { said += d; });
      // its progress, line by line, as this skill's own log
      child.stderr.on("data", (d) => {
        const lines = (rest + d).split("\n");
        rest = lines.pop();
        for (const l of lines) if (l.trim()) log(l);
      });
      child.on("error", (e) => { if (timer) clearTimeout(timer); no(e); });
      child.on("close", (c) => { if (timer) clearTimeout(timer); if (rest.trim()) log(rest); if (over) no(new Error(`transcribe took over ${timeout} s and was stopped`)); else ok({ code: c, said }); });
    });
    if (code) throw new Error(said.trim().split("\n").pop() || `transcribe stopped (exit ${code}).`);
    return JSON.parse(fs.readFileSync(out, "utf8"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
