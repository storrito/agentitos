#!/usr/bin/env node
// The sound of a spoken voice for social media: what is wrong with a recording (loudness, noise,
// hum, clipping, tone, the room), in numbers. The one voice analysis of agentitos, which the
// other skills run as a program instead of keeping their own. Made for agents: it prints what it
// measured and what to do next.
//
//   node tools/voice.mjs measure <audio|video> [--json]
//   node tools/voice.mjs clean …                  (not built yet)
//   node tools/voice.mjs targets [platform…] [--json]
//   node tools/voice.mjs targets list [--json]
//
//   measure   the first audio stream, decoded once (ffmpeg, streamed, 48 kHz): ebur128's
//             loudness, range and true peak; where the voice speaks and the noise floor in its
//             pauses; the speech's level, the noise's level, kind and bands, their distance;
//             hum (50 or 60 Hz), clipping, DC, where the band ends, the tone against a voice's
//             average spectrum, sibilance, rumble and thumps, clicks, two channels against
//             each other, the room's reverberation. lib/analyse.mjs defines every number,
//             lib/findings.mjs every threshold that makes one a finding.
//   targets   what the platforms do with a video's sound and the master that works on them:
//             loudness, true peak, range, sample rate, channels, codec; per platform what is
//             known of its playback and of what it asks of an upload, each with its basis
//             (official, measured, ads, unknown). The platforms' names are platform-zones'
//             (reels, tiktok, shorts, …), with apple-podcasts and spotify for sound alone;
//             none named: the usual ones. lib/targets.mjs is the table, the one place a
//             loudness number is written.
//
// Prints a few lines: the file and what it is, the numbers that matter, what stands out and
// what to do next; with --json one object on stdout (the numbers, and `findings`: {id,
// strength: "some" | "strong", text}). An error is one sentence on stdout ({"error": …} with
// --json), exit 1. Never prints a file's tags: only that they name a place.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { facts, analyse, Refusal } from "./lib/analyse.mjs";
import { findingsOf, noiseKind } from "./lib/findings.mjs";
import { targets, list, format, formatList } from "./lib/targets.mjs";

const USAGE = "Usage: voice.mjs measure <audio|video> [--json] | targets [platform…] [--json] | targets list (clean comes later)";
const TOOL = fileURLToPath(import.meta.url);
const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith("..") ? r : p; };
let json = false;
const fail = (msg) => { console.log(json ? JSON.stringify({ error: msg }) : msg); process.exit(1); };

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
  out.push(`Next: clean it with node ${rel(TOOL)} clean ${m.file}; it takes these numbers.`);
  return out;
}

const COMMANDS = {
  async measure(args) {
    json = args.includes("--json");
    const pos = args.filter((a) => a !== "--json");
    const bad = pos.find((a) => a.startsWith("--"));
    if (bad) fail(`Unknown option ${bad}. ${USAGE}`);
    if (pos.length !== 1) fail(`Name one recording: measure <audio|video> [--json].`);
    let m;
    try { m = await measure(pos[0]); } catch (e) { if (e instanceof Refusal) fail(e.message); throw e; }
    console.log(json ? JSON.stringify(m, null, 1) : lines(m).join("\n"));
  },
  clean: () => fail("clean is not built yet: measure is; clean comes next."),
  targets(args) {
    json = args.includes("--json");
    const names = args.filter((a) => a !== "--json");
    const bad = names.find((a) => a.startsWith("--"));
    if (bad) fail(`Unknown option ${bad}. ${USAGE}`);
    if (names[0] === "list") {
      if (names.length > 1) fail("targets list names no platform: it lists them all.");
      const l = list();
      console.log(json ? JSON.stringify(l, null, 1) : formatList(l));
      return;
    }
    let t;
    // (a name the table does not have is the person's or the agent's slip, said in a sentence)
    try { t = targets(names); } catch (e) { if (/^There is no platform/.test(e.message)) fail(e.message); throw e; }
    console.log(json ? JSON.stringify(t, null, 1) : format(t));
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || !COMMANDS[cmd]) fail(cmd ? `Unknown command ${cmd}. ${USAGE}` : USAGE);
  await COMMANDS[cmd](args);
}
