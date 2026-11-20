#!/usr/bin/env node
// The sound of a spoken voice for social media: what is wrong with a recording (loudness, noise,
// hum, clipping, tone, the room), in numbers; the recording mended and at the platforms'
// loudness; and what the platforms want. The one voice step of agentitos, which the other skills
// run as a program instead of keeping filters and loudness numbers of their own. Made for
// agents: it prints what it measured or did and what to do next.
//
//   node tools/voice.mjs clean <audio|video> <out> [--for <platform…>] [--loudness <LUFS>] [--peak <dBTP>]
//        [--denoise auto|off|gentle|strong] [--tone auto|off] [--level auto|plain|off] [--mono] [--audio <n>]
//        [--before <file>] [--json]
//   node tools/voice.mjs measure <audio|video> [--json]
//   node tools/voice.mjs targets [platform…] [--json]
//   node tools/voice.mjs targets list [--json]
//
//   clean     measures, then mends only what the numbers give a reason for, in three stages:
//             repair (channels, clipping, rumble, hum, clicks, noise), tone (what stands out in
//             the spectrum, sibilance), level (an even level, the loudness, a slow limiter for
//             the loudest peaks and a true-peak ceiling on the file as delivered). It refuses a
//             recording without a voice and one whose voice stands too little over the floor of
//             its recording to be raised; lib/clean.mjs says all of it.
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
import { Refusal } from "./lib/analyse.mjs";
import { measure, lines } from "./lib/measure.mjs";
import { targets, list, format, formatList } from "./lib/targets.mjs";

// (for a test or a script that takes them from the tool's own file)
export { measure, lines };

const USAGE = "Usage: voice.mjs clean <audio|video> <out> [options] | measure <audio|video> [--json] | targets [platform…] [--json] | targets list";
const TOOL = fileURLToPath(import.meta.url);
let json = false;
const fail = (msg) => { console.log(json ? JSON.stringify({ error: msg }) : msg); process.exit(1); };

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
  // (loaded when asked for: measure and targets need none of its stages)
  async clean(args) { await (await import("./lib/clean.mjs")).cleanCommand(args); },
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
