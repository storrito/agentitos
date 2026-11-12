#!/usr/bin/env node
// Footage of a subject for a video that is cut from it: found, fetched and laid out to look at.
//
//   node tools/footage.mjs search "<topic>" ["<topic>" …] [--n 8] [--json]
//        what YouTube's search page has for each topic: id, length, channel, title. The page only,
//        no video is opened; `x` marks a candidate that is too short or whose channel has its
//        footage taken down. A SHORTLIST is worth fetching, never footage confirmed.
//   node tools/footage.mjs fetch <dir> <source> [<source> …]
//        each source into <dir>/<stem>.mp4: a file (an upload), a direct link to a video file, or
//        a YouTube id or link (up to 1080p, with its facts as <stem>.info.json)
//   node tools/footage.mjs look <dir>
//        every source of <dir> laid out: its facts, the stretches viewers replayed most, its own
//        cuts, and a contact sheet <dir>/sheet-<stem>.jpg; all of it in <dir>/sources.json
//   node tools/footage.mjs strip <dir> <stem> <from> <to> [<out.jpg>]
//        a stretch of a source as a film strip, two frames a second, each with its time
//   node tools/footage.mjs proxy
//        whether a proxy for YouTube downloads is saved (never its value)
//
// YouTube turns a server away now and then, a machine in a data centre often for good. A proxy
// for the downloads comes from YT_PROXY in the environment, else from the machine's secret of
// that name (rragent: secrets.json of the machine's folder, found above the working directory, or
// FOOTAGE_SECRETS naming the file). Only downloads go through it, never the search, and its value
// is never printed. A refusal is tried twice more after a pause; then the tool says BOTCHECK and
// stops, exit 4.
//
// yt-dlp: the one on the PATH, else a copy downloaded once into ~/.cache/agentitos/ (as clips).
// Every step prints what it did and what to do next; an error is one sentence, exit 1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const USAGE = "Usage: footage.mjs search \"<topic>\" … | fetch <dir> <source> … | look <dir> | strip <dir> <stem> <from> <to> [<out.jpg>] | proxy";
const fail = (msg, code = 1) => { console.log(msg); process.exit(code); };
const log = (s) => console.error(s);
const rel = (p) => path.relative(process.cwd(), p) || ".";
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const sleep = (s) => spawnSync("sleep", [String(s)]);

const MIN_SECONDS = 60;   // under a minute a source rarely holds enough different shots
const READY_AT = 2;       // usable candidates a topic needs to be worth fetching
// footage that gets taken down wherever it is used, whoever uploaded it: a standing rule, no judgement of quality
const TAKEN_DOWN = /\b(bbc|top ?gear|grand ?tour|formula ?1|f1\b|netflix|disney|hbo|warner|universal pictures|paramount|sony pictures)\b/i;
const REFUSED = /HTTP Error 40[34]|HTTP Error 429|Forbidden|needs to be reloaded|Sign in to confirm/i;
const BOTCHECK = /Sign in to confirm/i;

function parse(args, valued = [], flags = []) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (flags.includes(k)) { opts[k] = true; continue; }
    if (!valued.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
    if (i + 1 >= args.length) fail(`${a} needs a value. ${USAGE}`);
    opts[k] = args[++i];
  }
  return { pos, opts };
}

function needTool(name) {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  if (r.status) fail(`This needs ${name} on the machine; it is not there.`);
}

// ---------------------------------------------------------------- yt-dlp and the proxy
function ytdlp() {
  const which = spawnSync("which", ["yt-dlp"], { encoding: "utf8" });
  if (!which.status && which.stdout.trim()) return which.stdout.trim();
  const dir = path.join(os.homedir(), ".cache", "agentitos");
  const bin = path.join(dir, "yt-dlp");
  if (!fs.existsSync(bin)) {
    const asset = process.platform === "darwin" ? "yt-dlp_macos" : process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
    log("footage: getting yt-dlp once …");
    fs.mkdirSync(dir, { recursive: true });
    try {
      execFileSync("curl", ["-fsSL", "-o", bin, `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`]);
    } catch {
      fs.rmSync(bin, { force: true });
      fail("yt-dlp is not on this machine and could not be downloaded.");
    }
    fs.chmodSync(bin, 0o755);
  }
  return bin;
}

// The proxy YouTube downloads go through, or "": YT_PROXY, else the machine's secret of that name.
function proxy() {
  let p = (process.env.YT_PROXY || "").trim();
  if (!p) {
    let file = process.env.FOOTAGE_SECRETS || "";
    if (!file) {
      let dir = process.cwd();
      for (let i = 0; i < 6 && !file; i++) {
        const f = path.join(dir, "secrets.json");
        if (fs.existsSync(f)) file = f;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    try {
      const v = file ? JSON.parse(fs.readFileSync(file, "utf8")).YT_PROXY : "";
      if (typeof v === "string") p = v.trim();
    } catch { /* no secrets to read: no proxy */ }
  }
  if (p && !/^[a-z0-9+]+:\/\//i.test(p)) p = `http://${p}`;
  return p;
}

// what yt-dlp said, without a proxy's address and login in it
const clean = (s) => String(s || "").replace(/[a-z0-9+]+:\/\/[^\s/@]*@[^\s/]*/gi, "<proxy>");
const lastLine = (s) => clean(s).trim().split("\n").pop() || "";

// One yt-dlp call; a refusal is tried twice more after a pause (20 s, 40 s), as clips does.
function download(args) {
  const bin = ytdlp();
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 << 20 });
    if (!r.status) return { ok: true, out: r.stdout };
    const err = r.stderr || r.stdout || "";
    if (attempt >= 3 || !REFUSED.test(err)) return { ok: false, err };
    log(`footage: YouTube turned it away (${lastLine(err).slice(0, 90)}), again in ${attempt * 20} s …`);
    sleep(attempt * 20);
  }
}

// ---------------------------------------------------------------- media
const probe = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status) return null;
  const j = JSON.parse(r.stdout || "{}"), s = (j.streams || [])[0];
  if (!s) return null;
  return { width: s.width, height: s.height, codec: s.codec_name, duration: Number(j.format?.duration) || 0 };
};
const stemOf = (name) => name.replace(/%20/g, "_").replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 60) || "source";

// yt-dlp's facts of a video run to megabytes (every format, every thumbnail): only what is used stays
const FACTS = ["id", "title", "channel", "uploader", "channel_url", "webpage_url", "upload_date", "duration", "view_count", "license", "heatmap"];
function keepFacts(file) {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(FACTS.filter((k) => info[k] != null).map((k) => [k, info[k]]))));
  } catch { /* no facts written: look goes on without them */ }
}

// ---------------------------------------------------------------- search
function search(args) {
  const { pos, opts } = parse(args, ["n", "delay"], ["json"]);
  if (!pos.length) fail(`Name the topics to search for. ${USAGE}`);
  const n = Number(opts.n) || 8, delay = opts.delay != null ? Number(opts.delay) : 6;
  const results = {};
  pos.forEach((q, i) => {
    if (i) sleep(delay);   // the search page is asked slowly: many calls in a row get a machine turned away
    const r = spawnSync(ytdlp(), ["--flat-playlist", "--skip-download", "--no-warnings", "--ignore-errors", "--print",
      "%(id)s\t%(duration)s\t%(channel)s\t%(title)s", `ytsearch${n}:${q}`], { encoding: "utf8", timeout: 300000 });
    const all = (r.stdout || "").trim().split("\n").filter(Boolean).map((line) => {
      const [id, d, channel, ...t] = line.split("\t");
      const title = t.join(" "), duration = Number(d) || 0, why = [];
      if (duration < MIN_SECONDS) why.push(`short, ${Math.round(duration)} s`);
      if (TAKEN_DOWN.test(channel || "") || TAKEN_DOWN.test(title)) why.push("gets taken down");
      return { id, duration, channel, title, why };
    }).filter((c) => c.id);
    const usable = all.filter((c) => !c.why.length);
    results[q] = { ready: usable.length >= READY_AT, usable, all, error: all.length ? null : lastLine(r.stderr) || "nothing found" };
  });
  if (opts.json) { console.log(JSON.stringify(results, null, 1)); return; }
  for (const [q, v] of Object.entries(results)) {
    console.log(`\n[${v.ready ? "SHORTLIST" : "THIN     "}] ${q}  (${v.usable.length} of ${v.all.length} usable)`);
    if (v.error) console.log(`    ${v.error}`);
    for (const c of v.all) {
      console.log(`  ${c.why.length ? "x " : "  "}${c.id}  ${clock(c.duration).padStart(6)}  ${String(c.channel || "").slice(0, 24).padEnd(24)} ${c.title.slice(0, 60)}${c.why.length ? `   [${c.why.join(", ")}]` : ""}`);
    }
  }
  const ready = Object.values(results).filter((v) => v.ready).length;
  console.log(`\n${ready} of ${pos.length} topic(s) have candidates worth fetching. That is metadata only: a documentary made of photographs passes it. `
    + `Next: node ${rel(process.argv[1])} fetch footage/<name> <id> [<id>] for two or three of them (the maker's own channel first), then look, and judge the sheets.`);
}

// ---------------------------------------------------------------- fetch
function fetchSources(args) {
  const { pos } = parse(args);
  const [dirArg, ...sources] = pos;
  if (!dirArg || !sources.length) fail(`Name the folder and the sources: fetch footage/<name> <file | link | YouTube id> … ${USAGE}`);
  needTool("ffprobe");
  const dir = path.resolve(dirArg);
  fs.mkdirSync(dir, { recursive: true });
  let firstYoutube = true, got = 0;
  for (const s of sources) {
    // a file of the person's
    if (fs.existsSync(s) && fs.statSync(s).isFile()) {
      const stem = stemOf(path.basename(s).replace(/\.[^.]+$/, "")), out = path.join(dir, `${stem}.mp4`);
      if (/\.mp4$/i.test(s)) fs.copyFileSync(s, out);
      else {
        // another container: the streams copied into an mp4, encoded anew only when they do not fit one
        const copy = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", s, "-c", "copy", "-movflags", "+faststart", out]);
        if (copy.status) spawnSync("ffmpeg", ["-v", "error", "-y", "-i", s, "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-c:a", "aac", out]);
      }
      const p = probe(out);
      if (!p) { fs.rmSync(out, { force: true }); console.log(`FAIL ${s}: no video in this file`); continue; }
      fs.writeFileSync(path.join(dir, `${stem}.info.json`), JSON.stringify({ file: path.resolve(s) }));
      console.log(`ok   ${stem} (a file) ${p.height}p ${clock(p.duration)}`); got++;
      continue;
    }
    // a direct link to a video file
    if (/^https?:\/\//i.test(s) && !/(youtube\.com|youtu\.be)/i.test(s)) {
      const stem = stemOf(path.basename(s.split("?")[0]).replace(/\.[^.]+$/, "")), out = path.join(dir, `${stem}.mp4`);
      if (fs.existsSync(out)) { console.log(`skip ${stem}: already there`); got++; continue; }
      const r = spawnSync("curl", ["-fsSL", "--retry", "2", "-m", "900", "-o", out, s]);
      const p = r.status ? null : probe(out);
      if (!p) { fs.rmSync(out, { force: true }); console.log(`FAIL ${s}: the link gave no video file (a page? it must be the link of the file itself)`); continue; }
      fs.writeFileSync(path.join(dir, `${stem}.info.json`), JSON.stringify({ webpage_url: s }));
      console.log(`ok   ${stem} (a link) ${p.height}p ${clock(p.duration)}`); got++;
      continue;
    }
    // YouTube
    const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(s) || /^([A-Za-z0-9_-]{11})$/.exec(s);
    if (!m) { console.log(`FAIL ${s}: neither a file, a link nor a YouTube id`); continue; }
    const id = m[1], stem = `yt_${id}`, out = path.join(dir, `${stem}.mp4`);
    if (fs.existsSync(out)) { console.log(`skip ${stem}: already there`); got++; continue; }
    const via = proxy();
    if (!firstYoutube) sleep(15);   // one after the other, with a pause
    firstYoutube = false;
    const r = download([...(via ? ["--proxy", via] : []), "-q", "--no-warnings", "--remote-components", "ejs:github",
      "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "--write-info-json",
      "-o", path.join(dir, `${stem}.%(ext)s`), "--", id]);
    const p = r.ok ? probe(out) : null;
    if (p) {
      keepFacts(path.join(dir, `${stem}.info.json`));
      console.log(`ok   ${stem} ${p.height}p ${clock(p.duration)}${via ? " (through the proxy)" : ""}`); got++; continue;
    }
    console.log(`FAIL ${stem}: ${lastLine(r.err).slice(0, 140) || "no video came"}`);
    if (BOTCHECK.test(r.err || "")) {
      console.log(via
        ? "BOTCHECK: YouTube turned the download away three times, through the proxy too. Do not try again now and do not look for another way in: go on with the sources that are there, a file or a direct link, or leave it and say so."
        : "BOTCHECK: YouTube turns this machine away and no proxy is saved (YT_PROXY: http://user:password@host:port, the machine's secret that the person types into the page). Do not try again now and do not look for another way in: go on with the sources that are there, a file or a direct link, or leave it and say so.");
      process.exit(4);
    }
  }
  if (!got) fail("No source came. Give a file, a direct link to a video file, or a YouTube id.");
  console.log(`${got} source(s) in ${rel(dir)}. Next: node ${rel(process.argv[1])} look ${rel(dir)}, then look at every sheet.`);
}

// ---------------------------------------------------------------- look
function sourcesOf(dir) {
  if (!fs.existsSync(dir)) fail(`There is no ${rel(dir)}: fetch into it first.`);
  const files = fs.readdirSync(dir).filter((f) => /\.mp4$/i.test(f)).sort();
  if (!files.length) fail(`No sources in ${rel(dir)}: fetch into it first.`);
  return files;
}

function look(args) {
  const { pos } = parse(args);
  if (!pos[0]) fail(`Name the folder: look footage/<name>. ${USAGE}`);
  needTool("ffmpeg");
  const dir = path.resolve(pos[0]);
  const all = [];
  for (const f of sourcesOf(dir)) {
    const stem = f.replace(/\.mp4$/i, ""), file = path.join(dir, f);
    const p = probe(file);
    if (!p) { console.log(`== ${stem}: not a video, left out`); continue; }
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(dir, `${stem}.info.json`), "utf8")); } catch { /* a file without facts */ }
    // the stretches viewers of the source replayed most (YouTube's curve, only on much-watched videos)
    const peaks = (info.heatmap || []).slice().sort((a, b) => b.value - a.value).slice(0, 5)
      .map((b) => ({ from: Math.round(b.start_time), to: Math.round(b.end_time), value: +b.value.toFixed(2) }));
    // the source's own cuts: ffmpeg's scene score; a dissolve stays unseen, fast motion can trip it
    const sc = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-vf", "select='gt(scene,0.25)',showinfo", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 << 20 });
    const cuts = [...(sc.stderr || "").matchAll(/pts_time:([0-9.]+)/g)].map((m) => +Number(m[1]).toFixed(2));
    // a contact sheet of 48 frames over the whole source, each with its time
    const step = Math.max(1, +(p.duration / 48).toFixed(1));
    const sheet = path.join(dir, `sheet-${stem}.jpg`);
    const sh = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", file, "-vf",
      `fps=1/${step},scale=320:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black,tile=8x6`,
      "-frames:v", "1", "-q:v", "4", sheet], { encoding: "utf8" });
    const entry = { stem, file: rel(file), title: info.title || null, channel: info.channel || info.uploader || null, url: info.webpage_url || null,
      views: info.view_count ?? null, license: info.license || null, duration: +p.duration.toFixed(2), width: p.width, height: p.height,
      replayed: peaks, cuts, sheet: sh.status ? null : rel(sheet), every: step };
    all.push(entry);
    console.log(`== ${stem}: ${entry.title || (entry.url ? "(a link)" : "(a file)")} | ${entry.channel || "-"} | ${entry.views != null ? `${entry.views} views` : "-"} | ${clock(p.duration)} | ${p.width}x${p.height}${entry.license ? ` | license: ${entry.license}` : ""}`);
    console.log(`   most replayed: ${peaks.length ? peaks.map((b) => `${clock(b.from)}-${clock(b.to)} (${b.value})`).join(", ") : "no curve (few views, or not from YouTube)"}`);
    console.log(`   its own cuts: ${cuts.length}${cuts.length ? "" : " found (dissolves stay unseen)"} | sheet: ${entry.sheet || "could not be made"} (a frame every ${step} s)`);
  }
  if (!all.length) fail(`No source in ${rel(dir)} is a video.`);
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(all, null, 1));
  console.log(`\n${rel(path.join(dir, "sources.json"))} holds this. Next: look at every sheet. Is it the subject, real and moving, without another broadcaster's logo or subtitles across the picture? `
    + `A stretch closer up: node ${rel(process.argv[1])} strip ${rel(dir)} <stem> <from> <to>.`);
}

// ---------------------------------------------------------------- strip
function seconds(v) {
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const parts = String(v).split(":").map(Number);
  if (parts.some(Number.isNaN)) fail(`Not a time: ${v} (seconds, or m:ss)`);
  return parts.reduce((a, b) => a * 60 + b, 0);
}

function strip(args) {
  const { pos } = parse(args);
  const [dirArg, stem, a, b, outArg] = pos;
  if (!dirArg || !stem || a == null || b == null) fail(`strip <dir> <stem> <from> <to> [<out.jpg>]. ${USAGE}`);
  needTool("ffmpeg");
  const file = path.join(path.resolve(dirArg), `${stem.replace(/\.mp4$/i, "")}.mp4`);
  if (!fs.existsSync(file)) fail(`There is no ${rel(file)}.`);
  const from = seconds(a), to = seconds(b);
  if (!(to > from)) fail("The stretch ends before it starts.");
  if (to - from > 60) fail(`That is ${Math.round(to - from)} s; a strip shows up to a minute.`);
  const out = path.resolve(outArg || path.join(path.resolve(dirArg), `strip-${stem}-${from.toFixed(1)}.jpg`));
  const n = Math.max(1, Math.ceil((to - from) * 2)), cols = Math.min(n, 8), rows = Math.ceil(n / cols);
  // the time drawn is the source's own: the stretch is cut after the seek, the clock starts at `from`
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-ss", String(from), "-t", String(to - from), "-copyts", "-i", file, "-vf",
    `fps=2:start_time=${from},scale=320:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black,tile=${cols}x${rows}`,
    "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  if (r.status || !fs.existsSync(out)) fail(`The strip could not be made: ${(r.stderr || "").trim().split("\n").pop()}`);
  console.log(`${rel(out)}: ${clock(from)}-${clock(to)} of ${stem}, two frames a second.`);
}

// ---------------------------------------------------------------- main
const [command, ...rest] = process.argv.slice(2);
if (command === "search") search(rest);
else if (command === "fetch") fetchSources(rest);
else if (command === "look") look(rest);
else if (command === "strip") strip(rest);
else if (command === "proxy") console.log(proxy()
  ? "A proxy for YouTube downloads is saved."
  : "No proxy is saved: YouTube downloads go out from this machine itself (YT_PROXY in the environment, or the machine's secret of that name, sets one).");
else fail(USAGE);
