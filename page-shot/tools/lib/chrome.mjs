// A web page or a post on X as a picture, with the machine's Chrome and no npm package. Chrome is
// CHROME when it is set, else one of the usual names on the PATH, else the one HyperFrames renders
// with (`hyperframes browser path`).
//
//   chromePath()                      → the executable, or null
//   postOf(url)                       → { embed, credit } for a post on X (twitter.com, x.com), else null
//   shot({ url, out, width, height, scale, mobile, transparent, from })
//                                     → { width, height, banner, plain } of out (PNG)
//
// With Node 22 or later (a WebSocket of its own), Chrome is driven through its DevTools protocol:
// the page is told its visitor prefers reduced motion, a cookie banner is clicked away (in every
// frame, the banner's own iframe too) and what is left of it hidden, running animations are played
// to their end, the page is scrolled to `from` and given time to load what scrolling brings, then
// the visible part is taken. Without a WebSocket, Chrome's own --screenshot takes it as it first
// shows (`plain`: banners and animations as they are).
//
// A post is shown through X's embed page (no login), on a transparent page, and cut to the card.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "chrome-headless-shell"];
const PHONE_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// the HyperFrames CLI: one on the PATH, else the version agentitos pins
function hyperframes() {
  const r = spawnSync("hyperframes", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? ["hyperframes"] : ["npx", "--yes", "hyperframes@0.8.146"];
}

export function chromePath() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  const [cmd, ...pre] = hyperframes();
  const r = spawnSync(cmd, [...pre, "browser", "path"], { encoding: "utf8" });
  const found = (r.stdout || "").trim().split("\n").pop();
  return r.status === 0 && found && fs.existsSync(found) ? found : null;
}

export function postOf(url) {
  const m = String(url).match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i);
  if (!m) return null;
  return { embed: `https://platform.twitter.com/embed/Tweet.html?id=${m[2]}&hideThread=true&theme=light&lang=en`, credit: `X / @${m[1]}` };
}

// Chrome puts a socket into TMPDIR, whose path may have at most 107 bytes: a deep TMPDIR (a
// harness's per-chat folder) keeps it from starting
const chromeEnv = () => ((process.env.TMPDIR || os.tmpdir()).length > 60 ? { ...process.env, TMPDIR: "/tmp" } : process.env);
const BASE = ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "--no-first-run", "--no-default-browser-check"];

// ------------------------------------------------------------------------- the banner's buttons
// the words of a button that accepts, in the languages a banner speaks (after story-from-link's)
const ACCEPT = /^(accept( all)?( cookies)?( and continue| & continue)?|allow( all)?( cookies)?|agree( and continue)?|i agree|i accept|ok|okay|got it|alle akzeptieren|akzeptieren( und weiter)?|alle cookies akzeptieren|alle zulassen|zulassen|zustimmen( und weiter)?|einwilligen( und weiter)?|einverstanden|verstanden|ich stimme zu|ich akzeptiere|accepter( et continuer)?|tout accepter|j'accepte|aceptar( todo| y continuar)?|accetta( tutto)?|accetto|accepteren|alles accepteren|akceptuj)$/i;
const IDS = ["#onetrust-accept-btn-handler", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", "#CybotCookiebotDialogBodyButtonAccept",
  "[data-testid=uc-accept-all-button]", ".cmpboxbtnyes", "#didomi-notice-agree-button", ".fc-cta-consent", "[data-cookiefirst-action=accept]",
  ".sp_choice_type_11", "button[title='Accept']", "button[title='Zustimmen']"];

// runs in each frame: clicks the first accepting button, returns its text or null
const CLICK = `(() => {
  const accept = new RegExp(${JSON.stringify(ACCEPT.source)}, "i"), ids = ${JSON.stringify(IDS)};
  const roots = [document];
  for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  for (const root of roots) for (const sel of ids) { const el = root.querySelector(sel); if (el) { el.click(); return sel; } }
  for (const root of roots) for (const el of root.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")) {
    const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").replace(/[^\\p{L}'&]+$/u, "");
    if (t && t.length < 40 && accept.test(t)) { el.click(); return t; }
  }
  return null;
})()`;

// runs in the page: hides what is left of a banner (a fixed layer named so), and lets it scroll again
const HIDE = `(() => {
  let n = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    const id = (el.id + " " + el.className + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
    if (/cookie|consent|gdpr|\\bcmp|privacy|usercentrics|onetrust|didomi|cookiebot|sp_message|sourcepoint|truste|qc-cmp/.test(id)) { el.style.setProperty("display", "none", "important"); n++; }
  }
  for (const el of [document.documentElement, document.body]) if (el && getComputedStyle(el).overflow === "hidden") el.style.setProperty("overflow", "auto", "important");
  return n;
})()`;

// --------------------------------------------------------------------------- DevTools protocol
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map(), listeners = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { ok, no } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? no(new Error(m.error.message)) : ok(m.result);
    } else if (m.method) for (const l of listeners) l(m);
  });
  const open = new Promise((ok, no) => { ws.addEventListener("open", ok); ws.addEventListener("error", () => no(new Error("Chrome's DevTools connection failed"))); });
  return {
    open,
    send: (method, params = {}) => new Promise((ok, no) => { const n = ++id; waiting.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params })); }),
    once: (method, ms) => new Promise((ok) => { const t = setTimeout(() => ok(null), ms); listeners.push((m) => { if (m.method === method) { clearTimeout(t); ok(m.params); } }); }),
    close: () => { try { ws.close(); } catch {} },
  };
}

const framesOf = (tree) => [tree.frame, ...(tree.childFrames || []).flatMap(framesOf)];

async function cdpShot({ chrome, url, out, width, height, scale, mobile, transparent, from }) {
  const dir = fs.mkdtempSync(path.join(chromeEnv().TMPDIR || os.tmpdir(), "broll-chrome-"));
  // every frame in one process (a banner's iframe from another site too), so each can be reached
  const proc = spawn(chrome, [...BASE, "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--disable-site-isolation-trials",
    "--disable-features=IsolateOrigins,site-per-process", "about:blank"], { env: chromeEnv(), stdio: "ignore" });
  let cdp = null;
  try {
    const portFile = path.join(dir, "DevToolsActivePort");
    for (let k = 0; k < 150 && !fs.existsSync(portFile); k++) await sleep(100);
    if (!fs.existsSync(portFile)) throw new Error("Chrome did not start.");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = pages.find((p) => p.type === "page");
    if (!target) throw new Error("Chrome opened no page.");
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.open;
    const { send, once } = cdp;
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
    await send("Emulation.setUserAgentOverride", { userAgent: mobile ? PHONE_UA : DESKTOP_UA });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    if (transparent) await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send("Animation.enable");
    const loaded = once("Page.loadEventFired", 30000);
    const nav = await send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`The page did not load (${nav.errorText}).`);
    await loaded;
    await sleep(1500);

    // the banner: up to two rounds (some ask twice), in every frame
    let banner = null;
    for (let round = 0; round < 2; round++) {
      let clicked = null;
      for (const f of framesOf((await send("Page.getFrameTree")).frameTree)) {
        try {
          const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: f.id, worldName: "broll" });
          const r = await send("Runtime.evaluate", { expression: CLICK, contextId: executionContextId, returnByValue: true });
          if (r.result?.value) { clicked = r.result.value; break; }
        } catch {}
      }
      if (!clicked) break;
      banner = clicked;
      await sleep(1200);
    }
    await send("Runtime.evaluate", { expression: HIDE, returnByValue: true });

    // animations to their end, then the place on the page, and time for what that loads
    await send("Animation.setPlaybackRate", { playbackRate: 100 });
    if (from > 0) {
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${from})` });
      await sleep(1200);
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${from})` });
    }
    await sleep(2500);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
    return { banner };
  } finally {
    cdp?.close();
    proc.kill("SIGKILL");
    await sleep(200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Chrome's own --screenshot: the page as it first shows, banners and animations as they are
function plainShot({ chrome, url, out, width, height, scale, transparent, from }) {
  const args = [...BASE, `--force-device-scale-factor=${scale}`, `--window-size=${width},${Math.round(height + from)}`, "--virtual-time-budget=12000",
    ...(transparent ? ["--default-background-color=00000000"] : []), `--screenshot=${path.resolve(out)}`, url];
  const r = spawnSync(chrome, args, { encoding: "utf8", env: chromeEnv(), timeout: 90000 });
  if (!fs.existsSync(out)) throw new Error(`Chrome took no picture of ${url}${r.error ? ` (${r.error.message})` : ""}: the page may need a login, or try again.`);
  if (from > 0) crop(out, [0, Math.round(from * scale), width * scale, Math.round(height * scale)]);
}

// --------------------------------------------------------------------------------- the picture
// the box of what is drawn on a transparent picture: [x, y, w, h], or null when nothing is
function drawn(file) {
  const meta = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", file]).toString()).streams[0];
  const W = meta.width, H = meta.height;
  const px = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 2 ** 30 });
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (px[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function crop(file, [x, y, w, h]) {
  const tmp = `${file}.part.png`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `crop=${w}:${h}:${x}:${y}`, tmp], { stdio: ["ignore", "ignore", "inherit"] });
  fs.renameSync(tmp, file);
}

const sizeOf = (file) => {
  const s = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", file]).toString()).streams[0];
  return [s.width, s.height];
};

export async function shot({ url, out, width, height, scale = 2, mobile = true, transparent = false, from = 0, label = url }) {
  const chrome = chromePath();
  if (!chrome) throw new Error("No Chrome found: set CHROME=/path/to/chrome, or let HyperFrames fetch its own (`hyperframes browser ensure`).");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.rmSync(out, { force: true });
  const plain = typeof WebSocket !== "function";
  let banner = null;
  if (plain) plainShot({ chrome, url, out, width, height, scale, transparent, from });
  else ({ banner } = await cdpShot({ chrome, url, out: path.resolve(out), width, height, scale, mobile, transparent, from }));
  if (transparent) {
    const box = drawn(out);
    if (!box) throw new Error(`The post at ${label} showed nothing: it may be deleted, private or need a login. Ask for a screenshot of it.`);
    // a few pixels of air around the card
    const pad = 4 * scale, [W, H] = sizeOf(out);
    const x = Math.max(0, box[0] - pad), y = Math.max(0, box[1] - pad);
    crop(out, [x, y, Math.min(W - x, box[2] + 2 * pad), Math.min(H - y, box[3] + 2 * pad)]);
  }
  const [w, h] = sizeOf(out);
  return { width: w, height: h, banner, plain };
}
