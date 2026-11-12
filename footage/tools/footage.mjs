#!/usr/bin/env node
// Footage of a subject for a video that is cut from it: found, fetched and laid out to look at.
//
//   node tools/footage.mjs search "<topic>" ["<topic>" …] [--n 8] [--delay 6] [--json]
//        what YouTube's search page has for each topic: id, length, channel, title. The page only,
//        no video is opened; `x` marks a candidate that is under a minute or from a channel whose
//        footage is taken down as a rule. A SHORTLIST is worth fetching, never footage confirmed.
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
// YouTube turns a server away now and then, a machine in a data centre often for good ("Sign in
// to confirm you're not a bot"). A proxy for the downloads comes from YT_PROXY in the
// environment, else from the machine's secret of that name (rragent: secrets.json of the
// machine's folder, the first above the working directory that holds YT_PROXY, or
// FOOTAGE_SECRETS naming the file). Only downloads go through it, never the search; it is handed
// to yt-dlp in its environment, not on its command line, and is taken out of everything printed.
// A passing refusal (403, 429) is tried twice more after a pause, as clips does; the bot check
// only when a proxy is saved, whose address changes between calls. After the bot check, or when
// the proxy itself refuses, no further YouTube source is tried: the other sources are still
// fetched, then the tool says BOTCHECK (or PROXY) and ends with exit 4.
//
// yt-dlp: the one on the PATH, else a copy downloaded once into ~/.cache/agentitos/ (as clips).
// Every step says what it did and what to do next; an error is one sentence, exit 1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const USAGE = "Usage: footage.mjs search \"<topic>\" … [--n 8] [--delay 6] [--json] | fetch <dir> <source> … | look <dir> | strip <dir> <stem> <from> <to> [<out.jpg>] | proxy";
const fail = (msg, code = 1) => { console.log(msg); process.exit(code); };
const log = (s) => console.error(s);
const rel = (p) => path.relative(process.cwd(), p) || ".";
// this tool as the next step names it: by its path from here, or whole when it lies elsewhere
const self = () => (rel(process.argv[1]).startsWith("..") ? process.argv[1] : rel(process.argv[1]));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const sleep = (s) => spawnSync("sleep", [String(s)]);

const MIN_SECONDS = 60;   // under a minute a source rarely holds enough different shots
const READY_AT = 2;       // usable candidates a topic needs to be worth fetching
// Channels whose footage is taken down wherever it is used: a standing rule, no judgement of
// quality. The channel's name only: a title that names a film or a race says nothing of whose
// the footage is.
const TAKEN_DOWN = /(^|[^a-z])(bbc|top ?gear|grand ?tour|formula ?1|netflix|disney|hbo|warner ?bros|universal pictures|paramount pictures|sony pictures)/i;
const PASSING = /HTTP Error 403|HTTP Error 429|Forbidden|needs to be reloaded/i;   // let in a little later
const BOTCHECK = /Sign in to confirm/i;
const PROXY_DOWN = /Unable to connect to proxy|Tunnel connection failed|ProxyError|Proxy Authentication Required/i;
const NO_OPTION = /no such option: --remote-components/i;

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

// a program on the PATH, or null (no `which` needed)
function onPath(name) {
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}
function needTool(name) {
  if (!onPath(name)) fail(`This needs ${name} on the machine; it is not there.`);
}
// what a program that ended badly said, or why it did not run at all
const reason = (r) => (r.error ? (r.error.code === "ENOENT" ? "the program is not on this machine" : r.error.message)
  : r.signal ? `it was stopped (${r.signal})` : String(r.stderr || r.stdout || "").trim().split("\n").pop() || "it gave no reason");

// ---------------------------------------------------------------- yt-dlp and the proxy
function ytdlp() {
  const found = onPath("yt-dlp");
  if (found) return found;
  const dir = path.join(os.homedir(), ".cache", "agentitos");
  const bin = path.join(dir, "yt-dlp");
  if (!fs.existsSync(bin)) {
    needTool("curl");
    const asset = process.platform === "darwin" ? "yt-dlp_macos" : process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
    log("footage: getting yt-dlp once …");
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync("curl", ["-fsSL", "-o", bin, `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`]);
    if (r.status !== 0) { fs.rmSync(bin, { force: true }); fail("yt-dlp is not on this machine and could not be downloaded."); }
    fs.chmodSync(bin, 0o755);
  }
  return bin;
}

// The proxy YouTube downloads go through, or "": YT_PROXY, else the machine's secret of that
// name, from the first secrets.json above the working directory that holds one.
function proxy() {
  let p = (process.env.YT_PROXY || "").trim();
  const fromFile = (file) => {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8")).YT_PROXY;
      return typeof v === "string" ? v.trim() : "";
    } catch { return ""; }
  };
  if (!p && process.env.FOOTAGE_SECRETS) p = fromFile(process.env.FOOTAGE_SECRETS);
  for (let dir = process.cwd(); !p && !process.env.FOOTAGE_SECRETS; dir = path.dirname(dir)) {
    p = fromFile(path.join(dir, "secrets.json"));
    if (path.dirname(dir) === dir) break;
  }
  if (p && !/^[a-z0-9+]+:\/\//i.test(p)) p = `http://${p}`;
  return p;
}

// what a program said, without the proxy in it: the address as it is, its host, any login
function masker(via) {
  const parts = [];
  if (via) {
    parts.push(via, via.replace(/^[a-z0-9+]+:\/\//i, ""));
    try { const u = new URL(via); parts.push(u.host, u.hostname); if (u.username) parts.push(`${u.username}:${u.password}`, decodeURIComponent(u.password || "")); } catch { /* not a URL: the address itself is masked */ }
  }
  const known = [...new Set(parts.filter((x) => x && x.length >= 4))].sort((a, b) => b.length - a.length);
  return (s) => {
    let t = String(s || "");
    for (const k of known) t = t.split(k).join("<proxy>");
    return t.replace(/[a-z0-9+]+:\/\/[^\s/@]*@[^\s/]*/gi, "<proxy>");
  };
}
// yt-dlp's last line, without its own advice on cookies: no other way in is taken
const lastLine = (s) => (String(s || "").trim().split("\n").pop() || "").replace(/\s*Use --cookies.*$/s, "").trim();

// One yt-dlp download. The proxy goes into its environment. yt-dlp may get the script that solves
// YouTube's player challenge from its own project (--remote-components ejs:github; a yt-dlp too
// old to know the option runs without it). A passing refusal is tried twice more after a pause
// (20 s, 40 s); the bot check only through a proxy; a proxy that does not let the call through
// is not tried again.
function download(args, via) {
  const bin = ytdlp(), mask = masker(via);
  const env = via ? { ...process.env, HTTP_PROXY: via, HTTPS_PROXY: via, ALL_PROXY: via, http_proxy: via, https_proxy: via, all_proxy: via } : process.env;
  let extra = ["--remote-components", "ejs:github"];
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(bin, [...extra, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env });
    if (r.status === 0) return { ok: true };
    const err = mask(r.error || r.signal ? reason(r) : r.stderr || r.stdout || "");
    if (extra.length && NO_OPTION.test(err)) { extra = []; attempt--; continue; }
    if (via && PROXY_DOWN.test(err)) return { ok: false, err, proxyDown: true };
    const again = PASSING.test(err) || (BOTCHECK.test(err) && via);
    if (attempt >= 3 || !again) return { ok: false, err, botcheck: BOTCHECK.test(err) };
    log(`footage: YouTube turned it away (${lastLine(err).slice(0, 90)}), again in ${attempt * 20} s …`);
    sleep(attempt * 20);
  }
}

// ---------------------------------------------------------------- media
// a video's facts, or null when the file holds no moving picture (a photo, a song with its cover)
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  let j;
  try { j = JSON.parse(r.stdout || "{}"); } catch { return null; }
  const v = (j.streams || []).find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(j.format?.duration) || 0;
  if (!v || duration < 1 || /image2|_pipe|png|jpeg|webp|gif/.test(j.format?.format_name || "")) return null;
  return { width: v.width, height: v.height, codec: v.codec_name, duration, mp4: /mp4/.test(j.format?.format_name || "") };
}
const stemOf = (name) => name.replace(/%20/g, "_").replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "source";
// yt-dlp's facts of a video run to megabytes (every format, every thumbnail): only what is used stays
const FACTS = ["id", "title", "channel", "uploader", "channel_url", "webpage_url", "upload_date", "duration", "view_count", "license", "heatmap"];
function keepFacts(file) {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(FACTS.filter((k) => info[k] != null).map((k) => [k, info[k]]))));
  } catch { /* no facts written: look goes on without them */ }
}
const readInfo = (dir, stem) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${stem}.info.json`), "utf8")); } catch { return {}; } };

// A video file into <dir>/<stem>.mp4 as an mp4: copied when it is one, its streams copied into one
// when they fit, encoded anew when not. Says why when it is no video or cannot be written.
function intoMp4(file, out) {
  const p = probe(file);
  if (!p) return { why: "no video in it (a picture, a sound file or a page)" };
  if (p.mp4) fs.copyFileSync(file, out);
  else {
    let r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", out], { encoding: "utf8" });
    if (r.status !== 0) r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-c:a", "aac", out], { encoding: "utf8" });
    if (r.status !== 0) { fs.rmSync(out, { force: true }); return { why: `it could not be made an mp4 (${reason(r)})` }; }
  }
  const made = probe(out);
  if (!made) { fs.rmSync(out, { force: true }); return { why: "what was written is no video" }; }
  return { p: made };
}

// ---------------------------------------------------------------- search
function search(args) {
  const { pos, opts } = parse(args, ["n", "delay"], ["json"]);
  if (!pos.length) fail(`Name the topics to search for. ${USAGE}`);
  const n = opts.n == null ? 8 : Number(opts.n), delay = opts.delay == null ? 6 : Number(opts.delay);
  if (!Number.isInteger(n) || n < 1 || n > 30) fail("--n is how many candidates a topic gets, 1 to 30.");
  if (!(delay >= 0 && delay <= 120)) fail("--delay is the pause between two topics in seconds, 0 to 120.");
  const bin = ytdlp(), results = {};
  pos.forEach((q, i) => {
    if (i) sleep(delay);   // the search page is asked slowly: many calls in a row get a machine turned away
    const r = spawnSync(bin, ["--flat-playlist", "--skip-download", "--no-warnings", "--ignore-errors", "--print",
      "%(id)s\t%(duration)s\t%(channel)s\t%(title)s", `ytsearch${n}:${q}`], { encoding: "utf8", timeout: 300000 });
    const all = String(r.stdout || "").trim().split("\n").filter(Boolean).map((line) => {
      const [id, d, channel, ...t] = line.split("\t");
      const title = t.join(" "), duration = Number(d) || 0, why = [];
      if (duration < MIN_SECONDS) why.push(`short, ${Math.floor(duration)} s`);
      if (TAKEN_DOWN.test(channel || "")) why.push("its channel's footage is taken down");
      return { id, duration, channel, title, why };
    }).filter((c) => c.id);
    const usable = all.filter((c) => !c.why.length);
    results[q] = { ready: usable.length >= READY_AT, usable, all, error: all.length ? null : (r.status === 0 ? "nothing found" : `the search did not answer (${lastLine(reason(r)).slice(0, 120)})`) };
  });
  const answered = Object.values(results).some((v) => v.all.length);
  if (opts.json) { console.log(JSON.stringify(results, null, 1)); process.exit(answered ? 0 : 1); }
  for (const [q, v] of Object.entries(results)) {
    console.log(`\n[${v.ready ? "SHORTLIST" : "THIN     "}] ${q}  (${v.usable.length} of ${v.all.length} usable)`);
    if (v.error) console.log(`    ${v.error}`);
    for (const c of v.all) {
      console.log(`  ${c.why.length ? "x " : "  "}${c.id}  ${clock(c.duration).padStart(6)}  ${String(c.channel || "").slice(0, 24).padEnd(24)} ${c.title.slice(0, 60)}${c.why.length ? `   [${c.why.join(", ")}]` : ""}`);
    }
  }
  if (!answered) fail("\nThe search answered nothing for any topic: other words, or a link or a file instead.");
  const ready = Object.values(results).filter((v) => v.ready).length;
  console.log(`\n${ready} of ${pos.length} topic(s) have candidates worth fetching. That is metadata only: a documentary made of photographs passes it. `
    + `Next: node ${self()} fetch footage/<name> <id> [<id>] for two or three of them (the maker's own channel first), then look, and judge the sheets.`);
}

// ---------------------------------------------------------------- fetch
// a YouTube video's id from a link of YouTube's, or from the bare id; null for anything else
function youtubeId(s) {
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return /^\/([A-Za-z0-9_-]{11})(\/|$)/.exec(u.pathname)?.[1] || null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = u.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  return /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(\/|$)/.exec(u.pathname)?.[1] || null;
}
const isYoutube = (s) => { try { return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(new URL(s).hostname); } catch { return false; } };

function fetchSources(args) {
  const { pos } = parse(args);
  const [dirArg, ...sources] = pos;
  if (!dirArg || !sources.length) fail(`Name the folder and the sources: fetch footage/<name> <file | link | YouTube id> … ${USAGE}`);
  needTool("ffprobe"); needTool("ffmpeg");
  const dir = path.resolve(dirArg);
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) fail(`${rel(dir)} is a file: the first argument is the folder the sources go into (fetch footage/<name> <source> …).`);
  fs.mkdirSync(dir, { recursive: true });
  // a stem no other source of the folder has; the same source again keeps its own
  const place = (base, same) => {
    for (let k = 1; ; k++) {
      const stem = k === 1 ? base : `${base}-${k}`;
      if (!fs.existsSync(path.join(dir, `${stem}.mp4`))) return { stem, fresh: true };
      if (same(readInfo(dir, stem))) return { stem, fresh: false };
    }
  };
  let got = 0, refused = false, firstYoutube = true;
  for (const s of sources) {
    // a file of the person's
    if (fs.existsSync(s) && fs.statSync(s).isFile()) {
      const from = rel(path.resolve(s));
      const { stem, fresh } = place(stemOf(path.basename(s).replace(/\.[^.]+$/, "")), (info) => info.file === from);
      if (!fresh) { console.log(`skip ${stem}: already there`); got++; continue; }
      const r = intoMp4(s, path.join(dir, `${stem}.mp4`));
      if (!r.p) { console.log(`FAIL ${s}: ${r.why}`); continue; }
      fs.writeFileSync(path.join(dir, `${stem}.info.json`), JSON.stringify({ file: from }));
      console.log(`ok   ${stem} (a file) ${r.p.height}p ${clock(r.p.duration)}`); got++;
      continue;
    }
    // YouTube
    const id = youtubeId(s);
    if (id) {
      const stem = `yt_${id}`, out = path.join(dir, `${stem}.mp4`);
      if (fs.existsSync(out)) { console.log(`skip ${stem}: already there`); got++; continue; }
      if (refused) { console.log(`not tried: ${stem} (the YouTube download before it did not get through)`); continue; }
      const via = proxy();
      if (!firstYoutube) sleep(15);   // one after the other, with a pause
      firstYoutube = false;
      const r = download(["-q", "--no-warnings", "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4",
        "--write-info-json", "-o", path.join(dir, `${stem}.%(ext)s`), "--", id], via);
      const p = r.ok ? probe(out) : null;
      if (p) {
        keepFacts(path.join(dir, `${stem}.info.json`));
        console.log(`ok   ${stem} ${p.height}p ${clock(p.duration)}${via ? " (through the proxy)" : ""}`); got++; continue;
      }
      for (const f of fs.readdirSync(dir)) if (f.startsWith(`${stem}.`)) fs.rmSync(path.join(dir, f), { force: true });   // nothing half-fetched stays
      console.log(`FAIL ${stem}: ${lastLine(r.err).slice(0, 140) || "no video came"}`);
      if (r.proxyDown) refused = "proxy-down";
      else if (r.botcheck) refused = via ? "proxy" : "plain";
      continue;
    }
    // a direct link to a video file
    if (/^https?:\/\//i.test(s)) {
      if (isYoutube(s)) { console.log(`FAIL ${s}: a page of YouTube's without one video (a channel, a playlist); give the video's link or id`); continue; }
      let url;
      try { url = new URL(s); } catch { console.log(`FAIL ${s}: not a link`); continue; }
      const shown = `${url.origin}${url.pathname}`;   // without what follows a "?": a signed link's key stays out of the files
      const { stem, fresh } = place(stemOf(decodeURIComponent(path.basename(url.pathname)).replace(/\.[^.]+$/, "")), (info) => info.webpage_url === shown);
      if (!fresh) { console.log(`skip ${stem}: already there`); got++; continue; }
      needTool("curl");
      const part = path.join(dir, `${stem}.part`);
      const c = spawnSync("curl", ["-fsSL", "--retry", "2", "-m", "900", "-o", part, s], { encoding: "utf8" });
      const r = c.status === 0 ? intoMp4(part, path.join(dir, `${stem}.mp4`)) : { why: `the link did not answer (${reason(c).slice(0, 100)})` };
      fs.rmSync(part, { force: true });
      if (!r.p) { console.log(`FAIL ${shown}: ${r.why}; it must be the link of the video file itself`); continue; }
      fs.writeFileSync(path.join(dir, `${stem}.info.json`), JSON.stringify({ webpage_url: shown }));
      console.log(`ok   ${stem} (a link) ${r.p.height}p ${clock(r.p.duration)}`); got++;
      continue;
    }
    console.log(/[/\\.]/.test(s) ? `FAIL ${s}: there is no such file` : `FAIL ${s}: neither a file, a link nor a YouTube id (eleven letters, digits, - and _)`);
  }
  if (got) console.log(`${got} source(s) in ${rel(dir)}. Next: node ${self()} look ${rel(dir)}, then look at every sheet.`);
  if (refused === "proxy-down") {
    console.log("PROXY: the saved proxy does not let the download through to YouTube (it refused the connection itself). Do not try again now: go on with the sources that are there, a file or a direct link, and tell the person that the proxy needs a look.");
    process.exit(4);
  }
  if (refused) {
    console.log(refused === "proxy"
      ? "BOTCHECK: YouTube turned the download away three times, through the proxy too. Do not try again now and do not look for another way in: go on with the sources that are there, a file or a direct link, or leave it and say so."
      : "BOTCHECK: YouTube turns this machine away and no proxy is saved (YT_PROXY: http://user:password@host:port, the machine's secret that the person types into the page). Do not try again now and do not look for another way in: go on with the sources that are there, a file or a direct link, or leave it and say so.");
    process.exit(4);
  }
  if (!got) fail("No source came. Give a file, a direct link to a video file, or a YouTube id.");
}

// ---------------------------------------------------------------- look
function folderOf(arg, what) {
  if (!arg) fail(`Name the folder: ${what}. ${USAGE}`);
  const dir = path.resolve(arg);
  if (!fs.existsSync(dir)) fail(`There is no ${rel(dir)}: fetch into it first.`);
  if (!fs.statSync(dir).isDirectory()) fail(`${rel(dir)} is a file: name the folder the sources are in.`);
  return dir;
}

function look(args) {
  const { pos } = parse(args);
  const dir = folderOf(pos[0], "look footage/<name>");
  needTool("ffmpeg"); needTool("ffprobe");
  const files = fs.readdirSync(dir).filter((f) => /\.mp4$/i.test(f)).sort();
  if (!files.length) fail(`No sources in ${rel(dir)}: fetch into it first.`);
  const all = [];
  for (const f of files) {
    const stem = f.replace(/\.mp4$/i, ""), file = path.join(dir, f);
    const p = probe(file);
    if (!p) { console.log(`== ${stem}: no video in it, left out`); continue; }
    const info = readInfo(dir, stem);
    // the stretches viewers of the source replayed most (YouTube's curve, only on much-watched videos)
    const peaks = (Array.isArray(info.heatmap) ? info.heatmap : []).filter((b) => Number.isFinite(b?.value)).sort((a, b) => b.value - a.value).slice(0, 5)
      .map((b) => ({ from: Math.round(b.start_time), to: Math.round(b.end_time), value: +b.value.toFixed(2) }));
    // the source's own cuts: ffmpeg's scene score; a dissolve stays unseen, fast motion can trip it
    const sc = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-vf", "select='gt(scene,0.25)',showinfo", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 << 20 });
    const cuts = sc.status === 0 ? [...String(sc.stderr || "").matchAll(/pts_time:([0-9.]+)/g)].map((m) => +Number(m[1]).toFixed(2)) : null;
    // a contact sheet of up to 48 frames over the whole source, each with its time
    const step = Math.max(1, Math.ceil((p.duration / 48) * 10) / 10);
    const sheet = path.join(dir, `sheet-${stem}.jpg`);
    const sh = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", file, "-vf",
      `fps=1/${step},scale=320:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black,tile=8x6`,
      "-frames:v", "1", "-q:v", "4", sheet], { encoding: "utf8" });
    const sheetMade = sh.status === 0 && fs.existsSync(sheet);
    const entry = { stem, file: rel(file), title: info.title || null, channel: info.channel || info.uploader || null, url: info.webpage_url || null,
      views: info.view_count ?? null, license: info.license || null, duration: +p.duration.toFixed(2), width: p.width, height: p.height,
      replayed: peaks, cuts, sheet: sheetMade ? rel(sheet) : null, every: step };
    all.push(entry);
    console.log(`== ${stem}: ${entry.title || (entry.url ? "(a link)" : "(a file)")} | ${entry.channel || "-"} | ${entry.views != null ? `${entry.views} views` : "-"} | ${clock(p.duration)} | ${p.width}x${p.height}${entry.license ? ` | license: ${entry.license}` : ""}`);
    console.log(`   most replayed: ${peaks.length ? peaks.map((b) => `${clock(b.from)}-${clock(b.to)} (${b.value})`).join(", ") : "no curve (few views, or not from YouTube)"}`);
    console.log(`   its own cuts: ${cuts == null ? `could not be read (${reason(sc).slice(0, 80)}): look for them yourself on the strips` : cuts.length || "none found (dissolves stay unseen)"} | sheet: ${entry.sheet || `could not be made (${reason(sh).slice(0, 80)})`} (a frame every ${step} s)`);
  }
  if (!all.length) fail(`No source in ${rel(dir)} is a video.`);
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(all, null, 1));
  console.log(`\n${rel(path.join(dir, "sources.json"))} holds this. Next: look at every sheet. Is it the subject, real and moving, without another broadcaster's logo or subtitles across the picture? `
    + `A stretch closer up: node ${self()} strip ${rel(dir)} <stem> <from> <to>.`);
}

// ---------------------------------------------------------------- strip
function seconds(v) {
  const s = String(v ?? "");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (!/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) fail(`Not a time: ${s || "(nothing)"} (seconds, or m:ss)`);
  return s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
}

function strip(args) {
  const { pos } = parse(args);
  const [dirArg, stemArg, a, b, outArg] = pos;
  if (!dirArg || !stemArg || a == null || b == null) fail(`strip <dir> <stem> <from> <to> [<out.jpg>]. ${USAGE}`);
  needTool("ffmpeg"); needTool("ffprobe");
  const dir = folderOf(dirArg, "strip footage/<name> <stem> <from> <to>"), stem = stemArg.replace(/\.mp4$/i, "");
  const file = path.join(dir, `${stem}.mp4`);
  if (!fs.existsSync(file)) fail(`There is no ${rel(file)}.`);
  const p = probe(file);
  if (!p) fail(`${rel(file)} holds no video.`);
  const from = seconds(a), asked = seconds(b), to = Math.min(asked, p.duration);
  if (!(asked > from)) fail("The stretch ends before it starts.");
  if (from >= p.duration - 0.25) fail(`The source is ${clock(p.duration)} long: ${clock(from)} is past its end.`);
  if (to - from < 0.5) fail("A strip shows half a second or more.");
  if (to - from > 60) fail(`That is ${Math.round(to - from)} s; a strip shows up to a minute.`);
  const out = path.resolve(outArg || path.join(dir, `strip-${stem}-${from.toFixed(1)}-${to.toFixed(1)}.jpg`));
  const n = Math.max(1, Math.floor((to - from) * 2)), cols = Math.min(n, 8), rows = Math.ceil(n / cols);
  // the time drawn is the source's own: the stretch is cut after the seek, the clock starts at `from`
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-ss", String(from), "-t", String(to - from), "-copyts", "-i", file, "-vf",
    `fps=2:start_time=${from},scale=320:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black,tile=${cols}x${rows}`,
    "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) fail(`The strip could not be made: ${reason(r)}`);
  console.log(`${rel(out)}: ${clock(from)}-${clock(to)} of ${stem}, two frames a second${to < asked ? ` (the source ends at ${clock(p.duration)})` : ""}.`);
}

// ---------------------------------------------------------------- main
const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "search") search(rest);
  else if (command === "fetch") fetchSources(rest);
  else if (command === "look") look(rest);
  else if (command === "strip") strip(rest);
  else if (command === "proxy") console.log(proxy()
    ? "A proxy for YouTube downloads is saved."
    : "No proxy is saved: YouTube downloads go out from this machine itself (YT_PROXY in the environment, or the machine's secret of that name, sets one).");
  else fail(USAGE);
} catch (e) {
  fail(`It did not work: ${String(e?.message || e).split("\n")[0]}`);
}
