// A YouTube source through storrito.ai's downloads (lib/youtube.mjs) against a stand-in for its
// routes on this machine: the video and its facts fetched, no proxy read, what a refusal ends,
// and what the proxy command says. No YouTube, no network; ffmpeg makes the video.
//
//   node --test tools/test-youtube.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "footage-youtube-"));

// two seconds of a moving picture with sound: what a download hands out
const made = path.join(tmp(), "film.mp4");
const ffmpeg = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", made], { encoding: "utf8" });
assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
const FILM = fs.readFileSync(made);
const FACTS = { title: "A press at work", seconds: 2, channel: "A maker", uploader: "A maker", channel_url: "https://www.youtube.com/channel/UCx", webpage_url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  upload_date: "20261125", view_count: 1234, license: "Creative Commons Attribution license (reuse allowed)", heatmap: [{ start_time: 0, end_time: 1, value: 1 }],
  description: "not kept", tags: ["not kept"] };

// A stand-in for storrito.ai's routes for an agent. What a download becomes is decided by its video.
function standIn() {
  const seen = [], kept = new Map();
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    const [, id, n] = /^\/downloads(?:\/([0-9a-f-]{36})(?:\/files\/(\d+))?)?$/.exec(req.url) || [];
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null;
    seen.push({ method: req.method, url: req.url, body, range: req.headers.range });
    if (req.method === "POST" && req.url === "/downloads") {
      if (body.video === "OFFoffOFFof") return json(503, { error: "unavailable", message: "YouTube downloads are not set up on this site yet: they have no price." });
      if (body.video === "BROKEbroke1") return json(402, { error: "balance", message: "The organization's balance is 0.00 USD, so a download waits. A person of the organization tops it up on the dashboard, https://storrito.ai/account." });
      const one = crypto.randomUUID();
      kept.set(one, { ...body });   // a copy: what was asked stays as it was asked
      return json(202, { id: one });
    }
    const job = kept.get(id);
    if (!job) return json(404, { error: "not-found", message: "No such download of this agent's." });
    if (req.method === "GET" && n === undefined) {
      if (job.video === "BOTbotBOTbo") return json(200, { id, status: "failed", reason: "bot", error: "YouTube took every attempt for a bot's and let none through. Try again in some minutes." });
      return json(200, { id, ...FACTS, status: "done", bytes: FILM.length + 1000,
        files: [{ name: "video.mp4", bytes: FILM.length, sha256: crypto.createHash("sha256").update(FILM).digest("hex"), path: `/downloads/${id}/files/0` }] });
    }
    if (req.method === "GET") {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "") || [];
      const piece = FILM.subarray(Number(first), Number(last) + 1);
      res.writeHead(206, { "content-range": `bytes ${first}-${last}/${FILM.length}`, "content-length": piece.length });
      return res.end(piece);
    }
    if (req.method === "DELETE") { job.gone = true; return json(200, { id, status: "done", files: [], files_gone: true }); }
    return json(404, { error: "not-found" });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${server.address().port}`, seen, kept, close: () => server.close() })));
}

const routes = await standIn();
test.after(() => routes.close());

// footage.mjs as a program, as an agent runs it: with a proxy saved that must never be read, and
// a gateway that is not there
const run = (args, env = {}) => new Promise((ok) => {
  const child = spawn(process.execPath, [path.join(HERE, "footage.mjs"), ...args],
    { cwd: tmp(), env: { ...process.env, YOUTUBE_DOWNLOADS_URL: routes.base, YOUTUBE_DOWNLOADS_LOOK_MS: "5", RRAGENT_GATEWAY: "http://127.0.0.1:9",
      YT_PROXY: "http://user:NEVER-USED@127.0.0.1:9", PATH: process.env.PATH, ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (status) => ok({ status, stdout, stderr }));
});

test("a YouTube source comes through the downloads: the video, its facts under yt-dlp's names, and the download given up", async () => {
  const dir = tmp(), from = routes.seen.length;
  const r = await run(["fetch", dir, "https://youtu.be/aqz-KE-bpKQ"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {3}yt_aqz-KE-bpKQ 180p 0:02 \(through storrito\.ai's downloads\)/);
  assert.ok(fs.statSync(path.join(dir, "yt_aqz-KE-bpKQ.mp4")).size > 1000);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "yt_aqz-KE-bpKQ.info.json"), "utf8")),
    { id: "aqz-KE-bpKQ", title: "A press at work", channel: "A maker", uploader: "A maker", channel_url: "https://www.youtube.com/channel/UCx",
      webpage_url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", upload_date: "20261125", duration: 2, view_count: 1234,
      license: "Creative Commons Attribution license (reuse allowed)", heatmap: [{ start_time: 0, end_time: 1, value: 1 }] });
  const asked = routes.seen.slice(from);
  assert.deepEqual({ ...asked.find((x) => x.method === "POST").body, key: null }, { video: "aqz-KE-bpKQ", kind: "video", height: 1080, key: null });
  assert.equal(asked.filter((x) => x.method === "DELETE").length, 1);
  assert.ok(!(r.stdout + r.stderr).includes("NEVER-USED") && !/through the proxy/.test(r.stdout), "no proxy was read");

  await test("the same source again is left alone, and nothing is asked", async () => {
    const before = routes.seen.length;
    const again = await run(["fetch", dir, "aqz-KE-bpKQ"]);
    assert.match(again.stdout, /skip yt_aqz-KE-bpKQ: already there/);
    assert.equal(routes.seen.length, before);
  });
});

test("a balance that is used up: its sentence, BALANCE, exit 4, and no further YouTube source tried", async () => {
  const dir = tmp(), from = routes.seen.length;
  const r = await run(["fetch", dir, "BROKEbroke1", "aqz-KE-bpKQ"]);
  assert.equal(r.status, 4, r.stdout);
  assert.match(r.stdout, /FAIL yt_BROKEbroke1: The organization's balance is 0\.00 USD/);
  assert.match(r.stdout, /not tried: yt_aqz-KE-bpKQ/);
  assert.match(r.stdout, /^BALANCE: /m);
  assert.equal(routes.seen.slice(from).filter((x) => x.method === "POST").length, 1);
});

test("a bot check on every way storrito.ai has: BOTCHECK, exit 4, a file of the same call still fetched", async () => {
  const dir = tmp();
  const r = await run(["fetch", dir, "BOTbotBOTbo", made, "aqz-KE-bpKQ"]);
  assert.equal(r.status, 4, r.stdout);
  assert.match(r.stdout, /FAIL yt_BOTbotBOTbo: YouTube took every attempt for a bot's/);
  assert.match(r.stdout, /ok {3}film \(a file\)/);
  assert.match(r.stdout, /not tried: yt_aqz-KE-bpKQ/);
  assert.match(r.stdout, /^BOTCHECK: YouTube turned the download away on every way storrito\.ai has/m);
});

test("the proxy command says which way a download takes", async () => {
  assert.match((await run(["proxy"])).stdout, /go through storrito\.ai's downloads on this machine: no proxy is needed/);
  assert.match((await run(["proxy"], { YOUTUBE_DOWNLOADS_URL: "" })).stdout, /A proxy for YouTube downloads is saved\./);
  assert.match((await run(["proxy"], { YOUTUBE_DOWNLOADS_URL: "", YT_PROXY: "" })).stdout, /No proxy is saved/);
});
