// YouTube through storrito.ai's downloads (lib/youtube.mjs) against a stand-in for its routes on
// this machine: which links are YouTube's, a download asked for, waited for and fetched in pieces,
// what a refusal and a site without the downloads are, and episode.mjs fetch through them. No
// YouTube, no model, no network.
//
//   node --test tools/test-youtube.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// A stand-in for storrito.ai's routes for an agent: POST /downloads, GET /downloads/<id>,
// GET /downloads/<id>/files/<n> with Range, DELETE /downloads/<id>. What a download becomes is
// decided by its video: `states` names the answers of its looks, one after the other.
const FILM = Buffer.alloc(5_000_000, 7);          // two pieces of 4 MB
const CAPTIONS = Buffer.from(JSON.stringify({ events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "This blade has a dark past." }] },
  { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "It has shed much innocent blood." }] }] }));
const FACTS = { title: "A film", seconds: 888, channel: "A channel", language: "en", captions: { automatic: ["en-orig", "en"], own: ["en"] },
  description: "A film about Anna Beispiel.", chapters: [{ start_time: 0, end_time: 60, title: "The blade" }], tags: ["film"], webpage_url: "https://www.youtube.com/watch?v=eRsGyueVLvQ" };

function standIn() {
  const seen = [], made = new Map();
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    const [, id, n] = /^\/downloads(?:\/([0-9a-f-]{36})(?:\/files\/(\d+))?)?$/.exec(req.url) || [];
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null;
    seen.push({ method: req.method, url: req.url, body, range: req.headers.range });
    if (req.method === "POST" && req.url === "/downloads") {
      if (body.video === "OFFoffOFFof") return json(503, { error: "unavailable", message: "YouTube downloads are not set up on this site yet: they have no price." });
      if (body.video === "BROKEbroke1") return json(402, { error: "balance", message: "The organization's balance is 0.00 USD, so a download waits." });
      const made_id = crypto.randomUUID();
      made.set(made_id, { job: body, looks: 0 });
      return json(202, { id: made_id });
    }
    const download = made.get(id);
    if (!download) return json(404, { error: "not-found", message: "No such download of this agent's." });
    const file = download.job.kind === "captions" ? CAPTIONS : FILM;
    if (req.method === "GET" && n === undefined) {
      download.looks += 1;
      const told = { id, video: download.job.video, kind: download.job.kind };
      if (download.job.video === "PRIVATEpriv") return json(200, { ...told, status: "failed", reason: "private", error: "The video is private: its owner would have to make it unlisted or public." });
      if (download.looks === 1) return json(200, { ...told, status: "queued", queue: 2 });
      if (download.looks === 2) return json(200, { ...told, status: "running", progress: { stage: download.job.kind, bytes: 1000 } });
      return json(200, { ...told, ...FACTS, status: "done", bytes: 12345,
        files: download.job.kind === "info" ? [] : [{ name: "file", bytes: file.length, sha256: download.job.video === "WRONGsha256" ? "0".repeat(64) : sha(file), path: `/downloads/${id}/files/0` }] });
    }
    if (req.method === "GET") {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "") || [];
      const piece = file.subarray(Number(first), Number(last) + 1);
      res.writeHead(206, { "content-range": `bytes ${first}-${last}/${file.length}`, "content-length": piece.length });
      return res.end(piece);
    }
    if (req.method === "DELETE") { download.gone = true; return json(200, { id, status: "done", files: [], files_gone: true }); }
    return json(404, { error: "not-found" });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${server.address().port}`, seen, made, close: () => server.close() })));
}

const routes = await standIn();
process.env.YOUTUBE_DOWNLOADS_URL = routes.base;
process.env.YOUTUBE_DOWNLOADS_LOOK_MS = "5";
const { videoId, downloads, fetched, save, giveUp } = await import("./lib/youtube.mjs");
test.after(() => routes.close());

test("a link is YouTube's by its host and names one video, else it is none", () => {
  const id = "aqz-KE-bpKQ";
  for (const link of [`https://www.youtube.com/watch?v=${id}&t=12s`, `https://youtu.be/${id}?si=x`, `https://m.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`, `https://music.youtube.com/watch?v=${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
    assert.equal(videoId(link), id, link);
  }
  for (const link of ["https://vimeo.com/123", `https://youtube.com.evil.example/watch?v=${id}`, "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@RaceSpotTV/videos", "work/talk.mp4", `ftp://youtu.be/${id}`, "", null]) {
    assert.equal(videoId(link), null, String(link));
  }
});

test("a download is asked for with a key of its own, waited for, and told while it waits and runs", async () => {
  assert.deepEqual(await downloads(), { base: routes.base });
  const lines = [];
  const got = await fetched({ video: "aqz-KE-bpKQ", kind: "sections", sections: [[58, 77]], height: 1440 }, (line) => lines.push(line));
  assert.equal(got.status, "done");
  assert.equal(got.title, "A film");
  const asked = routes.seen.find((r) => r.method === "POST");
  assert.deepEqual({ ...asked.body, key: null }, { video: "aqz-KE-bpKQ", kind: "sections", sections: [[58, 77]], height: 1440, key: null });
  assert.match(asked.body.key, /^[0-9a-f-]{36}$/);
  assert.ok(lines.some((l) => /waits for its turn \(2 before it\)/.test(l)), lines.join("|"));
  assert.ok(lines.some((l) => /runs: sections/.test(l)), lines.join("|"));

  await test("its file comes in pieces, each a range, and is held against its SHA-256", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clips-youtube-")), "raw.mp4");
    await save(got, 0, file);
    assert.equal(sha(fs.readFileSync(file)), sha(FILM));
    assert.deepEqual(routes.seen.filter((r) => r.range).map((r) => r.range), ["bytes=0-3999999", "bytes=4000000-4999999"]);
  });
  await test("given up once its files are here", async () => {
    await giveUp(got.id);
    assert.equal(routes.made.get(got.id).gone, true);
  });
});

test("a file that arrives differently than told is no file", async () => {
  const got = await fetched({ video: "WRONGsha256", kind: "audio" });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clips-youtube-")), "audio.m4a");
  await assert.rejects(save(got, 0, file), /arrived differently/);
  assert.ok(!fs.existsSync(file));
});

test("downloads that are off on the site are null; a refusal and a failed download are their sentence", async () => {
  assert.equal(await fetched({ video: "OFFoffOFFof", kind: "info" }), null);
  await assert.rejects(fetched({ video: "BROKEbroke1", kind: "info" }), /balance is 0\.00 USD/);
  await assert.rejects(fetched({ video: "PRIVATEpriv", kind: "audio" }), /The video is private/);
});

// episode.mjs as a program, as the agent runs it: without OpenRouter, so the words are the captions
const run = (args, env = {}) => new Promise((ok) => {
  const child = spawn(process.execPath, [path.join(HERE, "episode.mjs"), ...args],
    { env: { ...process.env, OPENROUTER_API_KEY: "", RRAGENT_GATEWAY: "http://127.0.0.1:9", ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (status) => ok({ status, stdout, stderr }));
});

test("episode.mjs fetch takes a YouTube link's facts and captions through the downloads, and its page for the names", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-youtube-"));
  const from = routes.seen.length;
  const r = await run(["fetch", "https://youtu.be/eRsGyueVLvQ?t=30", dir, "--no-names"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /through storrito\.ai's downloads/);
  const episode = JSON.parse(fs.readFileSync(path.join(dir, "episode.json"), "utf8"));
  assert.deepEqual([episode.id, episode.url, episode.title, episode.channel, episode.duration, episode.lang, episode.source],
    ["eRsGyueVLvQ", "https://www.youtube.com/watch?v=eRsGyueVLvQ", "A film", "A channel", 888, "en", "captions"]);
  assert.match(fs.readFileSync(path.join(dir, "sentences.txt"), "utf8"), /This blade has a dark past\./);
  const page = JSON.parse(fs.readFileSync(path.join(dir, "page.json"), "utf8"));
  assert.deepEqual([page.description, page.chapters, page.tags], ["A film about Anna Beispiel.", ["The blade"], ["film"]]);
  const asked = routes.seen.slice(from).filter((x) => x.method === "POST").map((x) => [x.body.kind, x.body.track ?? null]);
  assert.deepEqual(asked, [["info", null], ["captions", "en-orig"], ["captions", "en"]], "the facts, the words' track, the video's own track");
  const deleted = routes.seen.slice(from).filter((x) => x.method === "DELETE").length;
  assert.equal(deleted, 3, "each download is given up once it is here");
});

test("the height of a cut is one of four, by the flag or by the environment", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-youtube-"));
  assert.match((await run(["cut", dir, "0", "5", path.join(dir, "c.mp4"), "--height", "999"])).stdout, /720, 1080, 1440 or 2160/);
  assert.match((await run(["cut", dir, "0", "5", path.join(dir, "c.mp4")], { CLIPS_HEIGHT: "4320" })).stdout, /720, 1080, 1440 or 2160/);
});
