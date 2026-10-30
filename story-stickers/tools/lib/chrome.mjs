// The machine's Chrome, headless, through puppeteer-core: CHROME when it is set, else the usual
// names on the PATH, else a Chrome that puppeteer downloaded once.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const base = path.join(os.homedir(), ".cache", "puppeteer", kind);
    for (const v of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      for (const p of [path.join(base, v, "chrome-headless-shell-linux64", "chrome-headless-shell"), path.join(base, v, "chrome-linux64", "chrome")]) {
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Chrome found: set CHROME=/path/to/chrome.");
}

export async function launch() {
  // Chrome puts a socket into TMPDIR, and a socket path has at most 107 bytes: a deep TMPDIR (a
  // harness's per-chat folder) makes it fail to start, so Chrome gets the system's then
  const tmpOk = (process.env.TMPDIR || "/tmp").length <= 60;
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: "shell",
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--no-sandbox", "--allow-file-access-from-files"],
    ...(tmpOk ? {} : { env: { ...process.env, TMPDIR: "/tmp" } }),
  });
}

export const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
