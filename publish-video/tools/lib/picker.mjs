// The accounts as a list to tick in the chat: a hiccup block grouped by platform, each account with
// its profile picture (copied into uploads/, since the platforms' links to them expire) or else
// its platform's icon; the accounts that cannot take this video shown too, not tickable, with why.
// Only the targets of the person's last publish are ticked.

import fs from "node:fs";
import path from "node:path";

const ORDER = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "LINKEDIN", "PINTEREST", "THREADS", "TWITTER", "X", "SNAPCHAT", "BLUESKY"];

// a platform's icon: its colour and its letters, drawn here rather than copied from a brand's assets
const ICONS = {
  INSTAGRAM: ["#E4405F", "IG"], TIKTOK: ["#000000", "TT"], YOUTUBE: ["#FF0000", "YT"], FACEBOOK: ["#0866FF", "f"],
  LINKEDIN: ["#0A66C2", "in"], PINTEREST: ["#BD081C", "P"], THREADS: ["#000000", "@"], TWITTER: ["#000000", "X"],
  X: ["#000000", "X"], SNAPCHAT: ["#FFFC00", "S", "#000000"], BLUESKY: ["#1185FE", "B"],
};

const TYPES = { STORY: "Story", REEL: "Reel", SHORT: "Short", POST: "Post", PIN: "Pin", SPOTLIGHT: "Spotlight", VIDEO: "Video" };

const SAY = {
  de: { ask: "Wo soll das Video erscheinen?", next: "Weiter", send: "Veröffentlichen auf: {checked}", reconnect: "in Storrito neu verbinden", upTo: (c) => `nimmt bis ${c}`, from: (s) => `ab ${s} s`, hint: "Du kannst die Auswahl auch schreiben." },
  en: { ask: "Where should the video go?", next: "Next", send: "Post to: {checked}", reconnect: "reconnect it in Storrito", upTo: (c) => `takes up to ${c}`, from: (s) => `from ${s} s`, hint: "You can also type your choice." },
};

const str = (s) => JSON.stringify(String(s));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const key = (t) => `${t.platform}-${t.accountId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function icon(platform) {
  const [bg, letters, fg = "#FFFFFF"] = ICONS[platform] || ["#6B7280", String(platform || "?")[0]];
  const file = path.join("uploads", "publish-icons", `${String(platform).toLowerCase()}.svg`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${bg}"/><text x="16" y="${letters.length > 1 ? 20.5 : 22}" font-family="Arial,Helvetica,sans-serif" font-size="${letters.length > 1 ? 13 : 18}" font-weight="700" text-anchor="middle" fill="${fg}">${letters}</text></svg>\n`);
  }
  return file;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// every account's picture, fetched now: a link that fails keeps the picture fetched before
export async function avatars(targets) {
  const seen = new Map();
  for (const t of targets) if (t.avatarUrl && !seen.has(key(t))) seen.set(key(t), t.avatarUrl);
  const dir = path.join("uploads", "publish-accounts");
  const out = {};
  await Promise.all([...seen].map(async ([k, url]) => {
    const old = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${k}.`)) : null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const type = String(res.headers.get("content-type") || "").split(";")[0];
      if (!res.ok || !EXT[type]) throw new Error("no picture");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${k}.${EXT[type]}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      if (old && path.join(dir, old) !== file) fs.rmSync(path.join(dir, old), { force: true });
      out[k] = file;
    } catch { if (old) out[k] = path.join(dir, old); }
  }));
  return out;
}

// why a target cannot take this video, in the person's language; null: it can; false: leave it out
export function reason(t, job, lang) {
  const say = SAY[lang] || SAY.en;
  if (job?.mode && t.mode !== job.mode) return false;
  if (!t.texts) return false;
  if (t.disconnected) return say.reconnect;
  const d = job?.measured?.duration;
  if (d != null && t.max != null && d > t.max + 0.05) return say.upTo(clock(t.max));
  if (d != null && t.min && d < t.min - 0.05) return say.from(t.min);
  return null;
}

// rows: [{ t, why }]; ticked: target ids; pics: { key: file }
export function hiccup(rows, { lang = "en", ticked = [], pics = {} }) {
  const say = SAY[lang] || SAY.en;
  const groups = new Map();
  for (const r of rows) (groups.get(r.t.platform) || groups.set(r.t.platform, []).get(r.t.platform)).push(r);
  const rank = (p) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);
  const platforms = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const lines = ["[:div", ` [:p ${str(say.ask)}]`];
  for (const p of platforms) {
    const list = groups.get(p);
    lines.push(` [:p {:style {:display "flex" :align-items "center" :gap "6px" :margin "12px 0 4px"}} [:img {:src ${str(icon(p))} :width 18 :height 18 :alt ""}] [:strong ${str(list[0].t.platformName)}]]`);
    for (const { t, why } of list) {
      const pic = pics[key(t)] || icon(p);
      const input = why ? `{:type "checkbox" :disabled true}` : `{:type "checkbox" :name "to" :value ${str(t.id)}${ticked.includes(t.id) ? " :checked true" : ""}}`;
      const type = TYPES[String(t.postType).toUpperCase()] || t.label;
      lines.push(` [:label {:style {:display "flex" :align-items "center" :gap "8px" :margin "4px 0"${why ? ` :opacity 0.5` : ""}}} [:input ${input}] [:img {:src ${str(pic)} :width 24 :height 24 :alt "" :style {:border-radius "50%" :object-fit "cover"}}] [:span ${str(`${t.account} · ${type}`)}]${why ? ` [:small ${str(`– ${why}`)}]` : ""}]`);
    }
  }
  lines.push(` [:button {:class "primary" :send ${str(say.send)}} ${str(say.next)}]`, ` [:p [:small ${str(say.hint)}]]]`);
  return lines.join("\n");
}
