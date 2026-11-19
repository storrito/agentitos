// `voice.mjs measure`: a recording's numbers as one object, and the lines an agent reads of them.
// lib/analyse.mjs computes every number, lib/findings.mjs turns them into what stands out; this
// file puts the two together. It is a file of its own because the command (voice.mjs) and the
// cleaning (lib/clean.mjs, which measures before and after) both need it.
//
//   measure(file)  → { file, duration, sound, analysed, loudness, speech, levels, noise, hum,
//                      clipping, dc, bandwidth, tone, low, clicks, channels, room, findings }
//                    throws a Refusal (one sentence) for a file that is not there, has no sound
//                    or is silent all through
//   lines(m)       → the lines of `measure` without --json

import path from "node:path";
import { fileURLToPath } from "node:url";
import { facts, analyse, Refusal } from "./analyse.mjs";
import { findingsOf, noiseKind } from "./findings.mjs";

const TOOL = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "voice.mjs");
const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith("..") ? r : p; };

const minus = (s) => s.replace(/^-/, "−");
const f1 = (x) => minus((Math.round(x * 10) / 10 || 0).toFixed(1));
const i0 = (x) => minus(String(Math.round(x) || 0));
const sign = (x) => (x > 0 ? "+" : "") + i0(x);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const kHz = (hz) => (hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`);

export async function measure(file) {
  const f = facts(file);
  const m = await analyse(file, f);
  if (m.speech.silentShare >= 0.999) throw new Refusal(`${f.name} is silent all through: there is no voice to measure.`);
  if (m.noise) m.noise.kind = noiseKind(m.noise, m.hum);
  const out = {
    file: f.name, duration: f.duration,
    sound: { codec: f.codec, sampleRate: f.sampleRate, channels: f.channels, bitRate: f.bitRate, video: f.video, placeInTags: f.placeInTags },
    analysed: { sampleRate: 48000, channels: m.channelsAnalysed, seconds: m.seconds },
    loudness: m.loudness, speech: m.speech, levels: m.levels, noise: m.noise, hum: m.hum, clipping: m.clipping, dc: m.dc,
    bandwidth: m.bandwidth, tone: m.tone, low: m.low, clicks: m.clicks, channels: m.channels, room: m.room,
  };
  out.findings = findingsOf(out);
  return out;
}

// the lines an agent reads
export function lines(m) {
  const s = m.sound, sp = m.speech, L = m.levels, n = m.noise, lo = m.loudness;
  const layout = s.channels === 1 ? "mono" : s.channels === 2 ? "stereo" : `${s.channels} channels (measured as two)`;
  const out = [`${m.file}: ${clock(m.analysed.seconds)} of sound${s.video ? " in a video" : ""}, ${s.sampleRate ? `${+(s.sampleRate / 1000).toFixed(1)} kHz ` : ""}${layout}, speech ${Math.round(sp.share * 100)} % of the time.`];
  if (!sp.seconds) out.push("No voice found in it: the level never rises far enough over its floor.");
  const loud = [lo.integratedLufs != null && `Loudness ${f1(lo.integratedLufs)} LUFS`, L.speechLufs != null && `the speech ${f1(L.speechLufs)} LUFS`,
    lo.rangeLu != null && `range ${f1(lo.rangeLu)} LU`, lo.truePeakDb != null && `true peak ${f1(lo.truePeakDb)} dBTP`].filter(Boolean);
  if (loud.length) out.push(`${loud.join(", ")}.`);
  const longest = sp.longest.find((p) => !p.silent);
  if (n && L.snrDb != null) {
    out.push(`Noise in the pauses ${f1(n.lufs)} LUFS, ${i0(L.snrDb)} dB under the speech (${i0(L.snrADb ?? L.snrDb)} dB A-weighted), ${n.kind}${n.fluctuationDb != null ? ` (it moves by ${f1(n.fluctuationDb)} dB)` : ""}; ${f1(sp.pauses.seconds)} s of pauses${longest ? `, the longest ${f1(longest.seconds)} s at ${clock(longest.from)}` : ""}.` +
      (sp.confidence === "low" ? " Few pauses: the floor is uncertain." : ""));
  } else if (sp.silentShare > 0.03) out.push("The pauses are digital silence: no noise to measure.");
  if (m.hum?.hz) out.push(`Hum at ${m.hum.hz} Hz, ${m.hum.harmonics} harmonic${m.hum.harmonics === 1 ? "" : "s"}, ${i0(m.hum.overDb)} dB over the noise beside it${m.hum.underSpeechDb != null ? `, ${i0(m.hum.underSpeechDb)} dB under the speech` : ""}.`);
  if (m.tone) {
    const d = (lo) => m.tone.bands.find((b) => b.lo === lo)?.diff;
    const parts = [[100, "100–250 Hz"], [250, "250–500 Hz"], [2000, "2–4 kHz"], [4000, "4–8 kHz"]].filter(([b]) => d(b) != null).map(([b, name]) => `${name} ${sign(d(b))} dB`);
    const bw = m.bandwidth;
    out.push(`Tone against a voice's average spectrum: ${parts.join(", ")}${m.tone.sibilanceDb != null ? `; sibilance ${f1(m.tone.sibilanceDb)} dB` : ""}` +
      (bw.topHz ? `; the voice reaches from ${kHz(bw.bottomHz ?? 0)} to ${kHz(bw.topHz)}.` : "."));
  }
  if (m.channels) {
    const c = m.channels;
    out.push(c.identical ? "Two channels, the same signal twice." : c.silentChannel ? `Two channels, the ${c.silentChannel} one silent.`
      : `Two channels: correlation ${c.correlation}, ${f1(Math.abs(c.levelDifferenceDb ?? 0))} dB apart, a mono mix ${f1(c.monoLossDb)} dB.`);
  }
  if (m.room?.rt60 != null && m.room.confidence !== "low") out.push(`The room: about ${m.room.rt60.toFixed(1)} s of reverberation (from ${m.room.decays} decays, confidence ${m.room.confidence}).`);
  if (s.placeInTags) out.push("Its tags name a place: whatever is made from it for publishing goes without them.");
  out.push(m.findings.length ? `Stands out: ${m.findings.map((x) => `${x.id} (${x.strength}): ${x.text}`).join(" ")}` : "Nothing stands out.");
  out.push(`Next: node ${rel(TOOL)} clean ${m.file} <out> ${m.findings.length ? "mends what stands out and brings it to the platforms' loudness" : "brings it to the platforms' loudness; nothing else needs mending"} (it measures again itself).`);
  return out;
}
