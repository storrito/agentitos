// The voice's sound, from agentitos' voice-sound skill, run as a program (its code is never
// imported): VOICE_SOUND, else beside this skill, else in the machine's clone of the skills. It
// mends each recording whole, before it is cut (the noise is read in its pauses), and gives the
// loudness and the true peak to aim at, and its level stage brings the cut's voice to that
// loudness. This skill keeps no filter and no loudness number of its own for the voice: it evens
// its takes against each other, and its finish sets the film's level with voice-sound's numbers.
//
//   voiceSoundTool()                  → its tools/voice.mjs, or null
//   NEEDS_VOICE_SOUND                 → the sentence for when it is missing
//   master()                          → { lufs, peak, max }: the master for video of `targets`
//                                       (LUFS as played on two speakers, the true peak aimed at
//                                       and the most accepted, dBTP), or null without the tool
//   cleanVoice(file, out, args)       → Promise of { report } or { error }: `clean <file> <out>
//                                       --json …args`, its lines of how long and how far to log;
//                                       a refusal or a failure is a sentence, never thrown
//   cleanVoiceSync(file, out, args)   the same, waited for
//   voiceSaid(report)                 → one line: what it mended, what it left, what it could not judge

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NEEDS_VOICE_SOUND = "The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs)";

export function voiceSoundTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.VOICE_SOUND, path.join(skill, "..", "voice-sound", "tools", "voice.mjs"), "/home/sprite/skills/voice-sound/tools/voice.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

let masterOf;
export function master() {
  if (masterOf !== undefined) return masterOf;
  masterOf = null;
  const tool = voiceSoundTool();
  if (!tool) return masterOf;
  const r = spawnSync(process.execPath, [tool, "targets", "--json"], { encoding: "utf8" });
  try {
    const m = JSON.parse(r.stdout).master;
    if (Number.isFinite(m.lufs) && Number.isFinite(m.truePeakDbtp.aim)) masterOf = { lufs: m.lufs, peak: m.truePeakDbtp.aim, max: m.truePeakDbtp.max ?? m.truePeakDbtp.aim };
  } catch {}
  return masterOf;
}

// what the tool's exit and stdout say: its report, or its sentence
function outcome(code, stdout, stderr) {
  let j = null;
  try { j = JSON.parse(stdout); } catch {}
  if (code === 0 && j && !j.error) return { report: j };
  if (j?.error) return { error: String(j.error) };
  const last = (stderr || stdout || "").trim().split("\n").filter(Boolean).pop() || "";
  return { error: `it stopped (exit ${code})${last ? `: ${last.slice(0, 200)}` : ""}` };
}

// (a run still going when this tool ends, a failed transcription say, is ended with it)
const running = new Set();
process.on("exit", () => { for (const c of running) c.kill("SIGTERM"); });

// the report beside the output, as the tool writes it (<out>.json), is the caller's to keep
export function cleanVoice(file, out, args = [], { log = () => {} } = {}) {
  const tool = voiceSoundTool();
  if (!tool) return Promise.resolve({ error: NEEDS_VOICE_SOUND, missing: true });
  return new Promise((ok) => {
    const child = spawn(process.execPath, [tool, "clean", file, out, "--json", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    running.add(child);
    child.on("close", () => running.delete(child));
    let said = "", err = "", rest = "";
    child.stdout.on("data", (d) => { said += d; });
    child.stderr.on("data", (d) => {
      err += d;
      const lines = (rest + d).split("\n");
      rest = lines.pop();
      for (const l of lines) if (l.trim()) log(l);
    });
    child.on("error", (e) => ok({ error: `it could not be started: ${e.message}` }));
    child.on("close", (code) => ok(outcome(code, said, err)));
  });
}

export function cleanVoiceSync(file, out, args = []) {
  const tool = voiceSoundTool();
  if (!tool) return { error: NEEDS_VOICE_SOUND, missing: true };
  const r = spawnSync(process.execPath, [tool, "clean", file, out, "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  if (r.error) return { error: `it could not be started: ${r.error.message}` };
  return outcome(r.status, r.stdout, r.stderr);
}

// What it did, in plain words, without the steps every recording gets (one channel of two equal
// ones, the high-pass under the voice, its loudness and peaks); what it left and why, as it says it
const MENDED = { declip: "clipped peaks redrawn", dehum: "the hum notched", declick: "clicks taken out", denoise: "the noise turned down",
  eq: "the tone corrected where it stood out", deess: "the hiss of its s-sounds softened", leveller: "its uneven phrases evened", bursts: "knocks turned down" };
export function voiceSaid(report, none = "nothing to mend but the rumble under the voice") {
  const steps = report.steps || [];
  const done = [...new Set(steps.filter((s) => !(s.id === "denoise" && s.method === "off")).map((s) => MENDED[s.id]).filter(Boolean))];
  const left = (report.left || []).map((l) => l.why).filter(Boolean);
  const unjudged = (report.notJudged || []).map((n) => n.why || n.id).filter(Boolean);
  // (the denoiser that failed on the machine: the person passes it on to whoever runs it)
  const failed = steps.some((s) => s.fallback && !s.fallback.voice);
  return `${done.length ? done.join(", ") : none}.${failed ? " The neural denoiser failed on this machine, so ffmpeg's simpler method did the noise." : ""}${left.length ? ` Left: ${left.join(" ")}` : ""}${unjudged.length ? ` Not judged: ${unjudged.join(" ")}` : ""}`;
}
