// The voice's sound, from agentitos' voice-sound skill, which keeps the one treatment of a spoken
// voice (clipping, hum, clicks, noise, a tone that stands out) and the numbers the platforms want
// of sound: VOICE_SOUND, else beside this skill, else in the machine's clone of the skills. This
// skill keeps no filters and no loudness numbers of its own for the voice; it runs the tool as a
// program.
//
//   voiceSoundTool()                    → its tools/voice.mjs, or null
//   cleanVoice(file, out, { log })      → its report ({ steps, left, notJudged, … }): the voice of
//                                         `file` mended into `out` (a .wav), its loudness kept
//                                         (--level off: the cut evens its takes, levelVoice
//                                         levels the cut's voice), one
//                                         channel (--mono: the voice is one track of the cut);
//                                         its progress lines to log; a refusal or a failure throws
//                                         the tool's sentence
//   levelVoice(file, out, args)         → { report } or { error }: its level stage on the cut's
//                                         voice, `clean <file> <out> --json --denoise off --tone off
//                                         --mono …args` (repair and tone ran on the whole
//                                         recording); a refusal or a failure is a sentence
//   soundTargets()                      → { lufs, peakAim, peakMax }: the master for video
//   mendedSaid(report)                  → the lines new prints: what was mended, what stays
//   NEEDS_VOICE_SOUND                   → the sentence for when it is missing

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NEEDS_VOICE_SOUND = "The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs).";

export function voiceSoundTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.VOICE_SOUND, path.join(skill, "..", "voice-sound", "tools", "voice.mjs"), "/home/sprite/skills/voice-sound/tools/voice.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// the tool's last word on stdout: its JSON ({"error": …} on a refusal), else its last line
function answer(said) {
  try { return JSON.parse(said); } catch { return { error: said.trim().split("\n").pop() || null }; }
}

export async function cleanVoice(file, out, { log = () => {} } = {}) {
  const tool = voiceSoundTool();
  if (!tool) throw new Error(NEEDS_VOICE_SOUND);
  const { code, said, last } = await new Promise((ok, no) => {
    const child = spawn(process.execPath, [tool, "clean", file, out, "--level", "off", "--mono", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let said = "", rest = "", last = "";
    child.stdout.on("data", (d) => { said += d; });
    // its estimate and its stages, line by line, as this skill's own log
    child.stderr.on("data", (d) => {
      const lines = (rest + d).split("\n");
      rest = lines.pop();
      for (const l of lines) if (l.trim()) { log(l); last = l.trim(); }
    });
    child.on("error", no);
    child.on("close", (c, signal) => { if (rest.trim()) { log(rest); last = rest.trim(); } ok({ code: signal ? `${signal}` : c, said, last }); });
  });
  const r = answer(said);
  if (code || r.error || !fs.existsSync(out)) throw new Error(r.error || `voice-sound stopped (exit ${code})${last ? `: ${last}` : " without a word"}`);
  return r;
}

export function levelVoice(file, out, args = []) {
  const tool = voiceSoundTool();
  if (!tool) return { error: NEEDS_VOICE_SOUND };
  const r = spawnSync(process.execPath, [tool, "clean", file, out, "--json", "--denoise", "off", "--tone", "off", "--mono", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  if (r.error) return { error: `voice-sound could not be started: ${r.error.message}` };
  const j = answer(r.stdout || "");
  if (r.status || j.error || !fs.existsSync(out)) return { error: j.error || `voice-sound stopped (exit ${r.status})${(r.stderr || "").trim() ? `: ${(r.stderr || "").trim().split("\n").pop().slice(0, 200)}` : ""}` };
  return { report: j };
}

let master = null;
export function soundTargets() {
  if (master) return master;
  const tool = voiceSoundTool();
  if (!tool) throw new Error(NEEDS_VOICE_SOUND);
  const r = spawnSync(process.execPath, [tool, "targets", "--json"], { encoding: "utf8" });
  const t = answer(r.stdout || "");
  const m = t.master;
  if (r.status || !Number.isFinite(m?.lufs) || !Number.isFinite(m?.truePeakDbtp?.aim) || !Number.isFinite(m?.truePeakDbtp?.max))
    throw new Error(`voice-sound's targets: ${t.error || (r.stderr || "").trim().split("\n").pop() || "no master for video"}`);
  master = { lufs: m.lufs, peakAim: m.truePeakDbtp.aim, peakMax: m.truePeakDbtp.max };
  return master;
}

// What new says of the voice's sound, from voice-sound's report: what it mended (repair and tone;
// its level stage only kept the loudness and made the peaks safe), what it could not mend, what
// it could not judge. Never more than the report says.
export function mendedSaid(r) {
  const done = (r.steps || []).filter((s) => s.stage !== "level" && s.id !== "channels");
  const out = [`voice-sound mended: ${done.length ? done.map((s) => `${s.id}: ${s.why}`).join(" ") : "nothing; nothing in it gave a reason"}`];
  if ((r.left || []).length) out.push(`voice-sound could not mend: ${r.left.map((x) => `${x.id}: ${x.why}`).join(" ")}`);
  if ((r.notJudged || []).length) out.push(`voice-sound could not judge: ${r.notJudged.map((x) => `${x.id}: ${x.why}`).join(" ")}`);
  return out;
}
