// YouTube through storrito.ai's downloads, where this machine has them.
//
// A Sprite's own address is a datacenter's, which YouTube turns away much of the time ("Sign in
// to confirm you're not a bot"). An agent of storrito.ai has a connection at the Sprites gateway,
// sai-youtube-<agent id>, behind which storrito.ai fetches for it through ways out that YouTube
// takes, and bills the bytes to the organisation's balance (storrito.ai's README, YouTube
// downloads). The gateway adds the agent's token; nothing of a proxy is ever on this machine.
// YOUTUBE_DOWNLOADS_URL names the base instead of the gateway's, for a test.
//
//   videoId(link)            → the video's 11 characters, or null for what is no YouTube link
//   downloads()              → { base } or null: the connection, asked of the gateway once
//   fetched(job, log)        → the download once it is done: { id, files, title, seconds, … }.
//                              null when the downloads are off on the site (503): the caller goes
//                              on as without them. Every other refusal, and a download that
//                              failed, is a throw whose message is the sentence to pass on and
//                              whose `reason` is the word behind it (balance, busy, bot, private, …)
//   save(download, n, file)  → its n-th file written to `file`, fetched in pieces of 4 MB (the
//                              gateway takes a request of about 7 MB; what it passes of an answer
//                              is not measured), its SHA-256 held against what the download says
//   giveUp(id)               → the download given up once its files are here: they go at the
//                              service, and its container stops
//
// A download costs the bytes it took at YouTube, more than its files; one that failed costs
// nothing, one that is cancelled its bytes until then.

import crypto from "node:crypto";
import fs from "node:fs";

const GATEWAY = (process.env.RRAGENT_GATEWAY || process.env.SPRITE_GATEWAY_URL || "http://sprite.internal").replace(/\/$/, "");
const PIECE = 4e6;
// how often a download is looked at; YOUTUBE_DOWNLOADS_LOOK_MS shortens it for a test
const LOOK_MS = Number(process.env.YOUTUBE_DOWNLOADS_LOOK_MS) || 3000;
// storrito.ai ends a download that has not ended after three hours
const LONGEST_MS = 3.1 * 3600 * 1000;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export function videoId(link) {
  let url;
  try { url = new URL(String(link)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(first)) id = second;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

let found;
export async function downloads() {
  if (found !== undefined) return found;
  if (process.env.YOUTUBE_DOWNLOADS_URL) {
    found = { base: process.env.YOUTUBE_DOWNLOADS_URL.replace(/\/$/, "") };
    return found;
  }
  found = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const c = ((await res.json()).connections || []).find((x) => String(x.provider_account_name || "").startsWith("sai-youtube-"));
      if (c?.gateway_base_url) found = { base: c.gateway_base_url.replace(/\/$/, "") };
      break;
    } catch (e) {
      // no gateway on this machine at all: no need to wait for it
      if (e.cause?.code === "ENOTFOUND") break;
      if (attempt < 3) await sleep(1000);
    }
  }
  return found;
}

// one request to the downloads; a 429, a 5xx but the 503 of a service that is off, and no answer
// are asked again after a wait, three times
async function call(method, route, { body, headers } = {}) {
  const { base } = await downloads();
  for (let attempt = 1; ; attempt++) {
    let res, failure;
    try {
      res = await fetch(base + route, {
        method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body && JSON.stringify(body), signal: AbortSignal.timeout(120000),
      });
    } catch (e) { failure = e; }
    const again = failure || res.status === 429 || (res.status >= 500 && res.status !== 503);
    if (!again || attempt >= 3) {
      if (failure) throw new Error(`storrito.ai's downloads did not answer (${failure.cause?.code || failure.message}). Try again in a few minutes.`);
      return res;
    }
    await sleep(failure ? 2000 * attempt : Number(res.headers.get("retry-after")) * 1000 || 5000 * attempt);
  }
}

// what a refusal says: an Error with the sentence to pass on, and the word behind it as `reason`
const refusal = async (res) => {
  const data = await res.json().catch(() => ({}));
  return Object.assign(new Error(data.message || `storrito.ai's downloads answered ${res.status}.`), { reason: data.error || String(res.status) });
};

export async function fetched(job, log = () => {}) {
  // the key makes the request safe to send again: the same key finds the same download
  const asked = await call("POST", "/downloads", { body: { ...job, key: crypto.randomUUID() } });
  if (asked.status === 503) return null;
  if (asked.status !== 202 && asked.status !== 200) throw await refusal(asked);
  const { id } = await asked.json();
  const began = Date.now();
  let said = "";
  for (;;) {
    const res = await call("GET", `/downloads/${id}`);
    if (!res.ok) throw await refusal(res);
    const download = await res.json();
    if (download.status === "done") return download;
    if (download.status === "failed") throw Object.assign(new Error(download.error || "The download failed."), { reason: download.reason || "failed" });
    const now = download.status === "queued" ? `waits for its turn${download.queue != null ? ` (${download.queue} before it)` : ""}`
      : download.status === "running" ? `runs${download.progress?.stage ? `: ${download.progress.stage}` : ""}` : "";
    if (now && now !== said) { said = now; log(`  the download ${now} …`); }
    if (Date.now() - began > LONGEST_MS) {
      await giveUp(id);
      throw Object.assign(new Error("The download did not end in three hours and was cancelled. Fetch less at a time."), { reason: "timeout" });
    }
    await sleep(LOOK_MS);
  }
}

export async function save(download, n, file) {
  const told = download.files?.[n];
  if (!told) throw new Error("The download has no such file.");
  const out = fs.openSync(file, "w");
  const hash = crypto.createHash("sha256");
  try {
    for (let first = 0; first < told.bytes || first === 0; first += PIECE) {
      const last = Math.min(first + PIECE, told.bytes) - 1;
      const res = await call("GET", told.path, { headers: told.bytes ? { range: `bytes=${first}-${last}` } : {} });
      if (res.status !== 206 && res.status !== 200) throw await refusal(res);
      const bytes = Buffer.from(await res.arrayBuffer());
      fs.writeSync(out, bytes);
      hash.update(bytes);
      if (!told.bytes) break;
    }
  } finally {
    fs.closeSync(out);
  }
  if (fs.statSync(file).size !== told.bytes || (told.sha256 && hash.digest("hex") !== told.sha256)) {
    fs.rmSync(file, { force: true });
    throw new Error("A file of the download arrived differently than it was told. Ask for the download again.");
  }
  return file;
}

export async function giveUp(id) {
  try { await call("DELETE", `/downloads/${id}`); } catch { /* its files go by themselves in half an hour */ }
}
