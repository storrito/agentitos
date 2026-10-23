#!/usr/bin/env node
// What an rragent bot did in a span of time, from the agent's own record (agent.sqlite): the
// person's messages, the tools the agent called with how long they took and what they answered,
// the agent's answers, and the spans in which it worked. Made for agents: for "what did you do
// while I recorded?", and for cutting a screencast, where the agent's work is a wait to speed
// up and a service's "executed" is the moment a result is out.
//
//   node tools/timeline.mjs <recording-folder>   the span of a recording of rragent's recorder
//                                     (its recording.json), the bot whose folder it lies in
//   node tools/timeline.mjs --from <time> --to <time> [--bot <id>]
//                                     a span: ISO time (2026-10-23T11:05:00+02:00), milliseconds,
//                                     or "-15m" (that long ago); --to defaults to now
//   --json <file>    the timeline as JSON too, times in seconds from the span's start
//   --bot <id>       the bot (default: the one whose folder the recording or the working
//                    directory lies in)   --home <dir>   the agent's home (default RRAGENT_HOME)

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { where, events, working, DONE } from "./lib/events.mjs";

function fail(message) {
  console.log(message);
  process.exit(1);
}

const args = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (i + 1 >= args.length) fail(`${args[i]} needs a value.`);
    opts[args[i].slice(2)] = args[++i];
  } else pos.push(args[i]);
}

const time = (s) => {
  if (s == null) return null;
  if (/^\d{10,}$/.test(s)) return Number(s);
  const ago = String(s).match(/^-(\d+(?:\.\d+)?)(s|m|h)$/);
  if (ago) return Date.now() - Number(ago[1]) * { s: 1e3, m: 60e3, h: 3600e3 }[ago[2]];
  const t = Date.parse(s);
  if (!Number.isFinite(t)) fail(`"${s}" is no time: ISO (2026-10-23T11:05:00+02:00), milliseconds, or -15m.`);
  return t;
};

// the span of a recording: from its earliest source's start, as long as its longest source
function recordingSpan(folder) {
  const file = path.join(folder, "recording.json");
  if (!fs.existsSync(file)) fail(`${folder} has no recording.json: give the folder rragent's recorder wrote (artifacts/recordings/<time>).`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const starts = Object.values(rec.started || {}).filter(Number.isFinite);
  if (!starts.length) fail(`${file} says no start times.`);
  const lengths = fs.readdirSync(folder).filter((f) => /\.(webm|mp4|mp3|m4a)$/.test(f)).map((f) => {
    const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(folder, f)], { encoding: "utf8" });
    return Number(r.stdout.trim()) || 0;
  });
  const from = Math.min(...starts);
  return { from, to: from + (Math.max(0, ...lengths) || 1800) * 1000 };
}

const clock = (s) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};
const wall = (ms) => new Date(ms).toLocaleTimeString("de-DE", { hour12: false });

const folder = pos[0];
const span = folder ? recordingSpan(folder) : { from: time(opts.from), to: time(opts.to) ?? Date.now() };
if (span.from == null) fail("Usage: timeline.mjs <recording-folder> | --from <time> [--to <time>] [--bot <id>] [--json <file>]");
const w = where({ folder, home: opts.home, bot: opts.bot });
if (!w) fail("No agent here: run it inside a bot's folder (its bash does), give a recording folder of one, or --home and --bot.");
let list;
try { list = await events(w.db, w.bot, span.from, span.to); } catch (e) { fail(`✗ ${e.message} (node:sqlite needs Node 22.5 or later)`); }
const busy = working(list);
const rel = (ms) => (ms - span.from) / 1000;

console.log(`Bot ${w.bot}, ${wall(span.from)}–${wall(span.to)} (${clock(rel(span.to))}); times from the start${folder ? " of the recording" : ""}:\n`);
for (const e of list) {
  const head = `${clock(rel(e.at)).padStart(6)} (${wall(e.at)})`;
  if (e.kind === "sent") console.log(`${head}  sent: ${e.text}`);
  else if (e.kind === "answer") console.log(`${head}  answered: ${e.text}`);
  else console.log(`${head}  ${e.name} ${e.what}${e.took != null ? ` (${e.took} s)` : ""}${e.error ? " ✗" : ""}${e.result ? ` → ${e.result}` : ""}${DONE.test(e.result || "") ? "   ★ out" : ""}`);
}
if (!list.length) console.log("Nothing: the agent did nothing in that span.");
if (busy.length) console.log("");
for (const b of busy) console.log(`The agent worked ${clock(rel(b.from))}–${clock(rel(b.to))} (${Math.round((b.to - b.from) / 1000)} s), on: ${b.message.slice(0, 80)}`);

if (opts.json) {
  const out = {
    bot: w.bot, from: new Date(span.from).toISOString(), to: new Date(span.to).toISOString(),
    events: list.map(({ at, ...e }) => ({ t: +rel(at).toFixed(2), ...e })),
    working: busy.map((b) => ({ from: +rel(b.from).toFixed(2), to: +rel(b.to).toFixed(2), message: b.message })),
    out: list.filter((e) => DONE.test(e.result || "")).map((e) => ({ t: +rel(e.at + (e.took || 0) * 1000).toFixed(2), what: e.result })),
  };
  fs.mkdirSync(path.dirname(path.resolve(opts.json)), { recursive: true });
  fs.writeFileSync(opts.json, JSON.stringify(out, null, 1) + "\n");
  console.log(`\n→ ${opts.json}`);
}
