// A first cut by a model that watches and listens: the videos (small) and every word, numbered,
// go to Gemini through OpenRouter; it answers with the keeps of cut.json, the retries it left
// out and why, and where a silence must play at its own speed. The words alone cannot tell which
// of two attempts is said better, or that a pause is someone turning a camera in the picture.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { rules, shown } from "../brief.mjs";

export const PROPOSE_MODEL = "google/gemini-4-argon";
// OpenRouter takes requests up to about 50 MB as base64: the small videos stay well under that
const MAX_MINUTES = 60;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keep", "retries", "visual"],
  properties: {
    keep: { type: "array", items: { type: "object", additionalProperties: false, required: ["words", "why", "pauses"], properties: {
      words: { type: "string", description: "first-last word number, both included, e.g. 12-40, or one number" },
      why: { type: "string", description: "what the range is, and which attempt it is when it replaces another" },
      pauses: { type: "boolean", description: "true only when a silence inside this range must play at its own speed: the speaker holds or turns something in the picture slowly, a reaction. A screen that changes (clicks, pages, scrolling) is not: the tool keeps what moves and speeds up long stretches" },
    } } },
    retries: { type: "array", items: { type: "object", additionalProperties: false, required: ["dropped", "kept", "why"], properties: {
      dropped: { type: "string" }, kept: { type: "string" }, why: { type: "string" },
    } } },
    visual: { type: "array", items: { type: "object", additionalProperties: false, required: ["words", "what"], properties: {
      words: { type: "string" }, what: { type: "string" },
    } } },
  },
};

export async function propose(dir, clips, words, settings, { model = PROPOSE_MODEL, log = () => {} } = {}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const list = Object.values(clips);
  const minutes = list.reduce((t, c) => t + c.duration, 0) / 60;
  if (minutes > MAX_MINUTES) throw new Error(`${Math.round(minutes)} minutes of video: the model takes ${MAX_MINUTES} at most; read the brief and cut yourself`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "best-takes-propose-"));
  const content = [];
  try {
    const several = list.length > 1;
    const numbered = list.map((c) => `${several ? `Video ${c.n}: ` : ""}${words.filter((w) => w.clip === c.n).map((w) => `[${w.i}]${shown(w)}`).join(" ")}`).join("\n\n");
    content.push({ type: "text", text: `You are cutting a raw recording for a short social video. Watch and listen to the video${several ? "s" : ""}, then choose the word ranges to keep.

${rules(several, settings)}

Judge the delivery you hear and see, not only the words: which attempt is fluent, which one stumbles, where the speaker laughs or looks away. Fillers appear as (äh), noises as [ … ].

For every retry you leave out, say which range it was, which range replaces it and why. List where the speaker shows something visually.

All words, numbered:
${numbered}` });
    for (const c of list) {
      const small = path.join(tmp, `${c.n}.mp4`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, "source", c.file), "-vf", "scale=-2:360,fps=4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "33", "-c:a", "aac", "-b:a", "32k", "-ac", "1", small]);
      if (several) content.push({ type: "text", text: `Video ${c.n}:` });
      content.push({ type: "video_url", video_url: { url: `data:video/mp4;base64,${fs.readFileSync(small).toString("base64")}` } });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  log(`proposing a cut (${model}, ${Math.max(1, Math.round(minutes))} min of video) …`);
  let j;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], response_format: { type: "json_schema", json_schema: { name: "cut", strict: true, schema: SCHEMA } } }),
        signal: AbortSignal.timeout(600e3),
      });
      j = await res.json();
      if (res.ok && j.choices?.[0]?.message?.content) break;
      if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    } catch (e) {
      if (attempt >= 3 || /OpenRouter 4\d\d/.test(e.message)) throw e;
    }
    log("  OpenRouter did not answer, again …");
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  const ans = JSON.parse(j.choices[0].message.content.replace(/^```(json)?\s*|\s*```$/g, ""));
  return {
    model,
    cost: j.usage?.cost ?? 0,
    keep: ans.keep.map((k) => ({ words: k.words, why: k.why, ...(k.pauses ? { pauses: "keep" } : {}) })),
    retries: ans.retries,
    visual: ans.visual,
  };
}
