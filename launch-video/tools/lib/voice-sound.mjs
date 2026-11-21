// The sound of a recorded voice, and the numbers a film's sound aims at, from agentitos'
// voice-sound skill, which keeps the one voice step and the one table of loudness numbers:
// VOICE_SOUND, else beside this skill, else in the machine's clone of the skills. Run as a
// program, never imported. This skill keeps no filters or loudness numbers of its own.
//
//   voiceSoundTool()                       → its tools/voice.mjs, or null
//   cleanVoice(file, out, { mono })        → its report (`<out>.json`: steps, left, delivered);
//                                            its progress lines go to stderr; a refusal or an
//                                            error throws the tool's own sentence
//   master()                               → targets' master for video: { lufs, truePeakDbtp: { aim, max }, … }
//   NEEDS_VOICE_SOUND                      → the sentence for when it is missing

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NEEDS_VOICE_SOUND = "The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs).";

export function voiceSoundTool() {
  const skill = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const candidates = [process.env.VOICE_SOUND, path.join(skill, "..", "voice-sound", "tools", "voice.mjs"), "/home/sprite/skills/voice-sound/tools/voice.mjs"];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// one run of the tool with --json: its JSON on stdout, its progress passed through on stderr
function run(args) {
  const tool = voiceSoundTool();
  if (!tool) throw new Error(NEEDS_VOICE_SOUND);
  const r = spawnSync(process.execPath, [tool, ...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`voice-sound did not run: ${r.error.message}`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  if (j?.error) throw new Error(j.error);
  if (r.status !== 0 || !j) throw new Error(`voice-sound stopped (exit ${r.status ?? r.signal})${r.stdout.trim() ? `: ${r.stdout.trim().split("\n").pop()}` : ""}`);
  return j;
}

// the whole recording, before anything is cut from it (the noise is read in its pauses), at the
// platforms' loudness with its peaks held; --mono: one channel, at the target as HyperFrames
// plays it (both speakers get it whole)
export function cleanVoice(file, out, { mono = true } = {}) {
  return run(["clean", file, out, ...(mono ? ["--mono"] : [])]);
}

let masterOf = null;
export function master() {
  if (!masterOf) masterOf = run(["targets"]).master;
  if (!(Number.isFinite(masterOf?.lufs) && Number.isFinite(masterOf?.truePeakDbtp?.aim) && Number.isFinite(masterOf?.truePeakDbtp?.max))) throw new Error("voice-sound's targets have no master loudness and true peak");
  return masterOf;
}
