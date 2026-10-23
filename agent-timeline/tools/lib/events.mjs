// What an rragent bot did in a span of time, from the agent's own record: <home>/agent.sqlite
// holds every bot's conversation (the bot <id> is conversation <id>, its folder
// <home>/bots/<id>/), each entry with the time it was made. From it: when the person sent a
// message, which tools the agent called, how long each took and what it answered (a story
// "scheduled", later "executed"), and when the agent answered. The span between a message and
// the agent's last answer to it is the agent working.
//
//   where({ folder, home, bot }) → { home, db, bot } or null
//   events(db, bot, from, to)    → [{ at, kind, text | name, what, took, result, error }]
//                                   at in ms; kinds "sent", "tool", "answer"
//   working(events)              → [{ from, to, message }]   (ms)

import fs from "node:fs";
import path from "node:path";

const short = (s, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const textOf = (content) => (typeof content === "string" ? content
  : (content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n"));

// the agent's home and the bot: from a path inside a bot's folder (a recording of rragent's
// recorder lies in <home>/bots/<id>/work/artifacts/recordings/), else the working directory
// (a bot's bash runs in <home>/bots/<id>/work), else RRAGENT_HOME and `bot`
export function where({ folder, home, bot } = {}) {
  for (const p of [folder, process.cwd()].filter(Boolean)) {
    const parts = path.resolve(p).split(path.sep);
    const k = parts.lastIndexOf("bots");
    if (k >= 1 && /^\d+$/.test(parts[k + 1] || "")) {
      const h = parts.slice(0, k).join(path.sep) || path.sep;
      if (fs.existsSync(path.join(h, "agent.sqlite"))) return { home: h, db: path.join(h, "agent.sqlite"), bot: Number(bot ?? parts[k + 1]) };
    }
  }
  const h = home || process.env.RRAGENT_HOME;
  if (h && bot != null && fs.existsSync(path.join(h, "agent.sqlite"))) return { home: h, db: path.join(h, "agent.sqlite"), bot: Number(bot) };
  return null;
}

export async function events(file, bot, from, to) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("select record from entries where conversation_id = ? order by id").all(bot);
    const out = [], calls = new Map();
    for (const row of rows) {
      let r;
      try { r = JSON.parse(row.record); } catch { continue; }
      const m = r.model?.[0];
      const at = m?.timestamp;
      if (!at || at < from || at > to) continue;
      if (r.kind === "pi.user") {
        const text = textOf(m.content);
        // the recorder's own notice of a new recording is no message of the person
        if (/^New recording in artifacts\/recordings\//.test(text)) continue;
        out.push({ at, kind: "sent", text: short(text, 300) });
      } else if (r.kind === "pi.assistant") {
        for (const p of m.content || []) {
          if (p.type === "toolCall") {
            const a = p.arguments || {};
            const ev = { at, kind: "tool", name: p.name, what: short(a.command || a.code || a.path || a.file || JSON.stringify(a), 140) };
            calls.set(p.id, ev);
            out.push(ev);
          } else if (p.type === "text" && p.text.trim()) {
            out.push({ at, kind: "answer", text: short(p.text, 300) });
          }
        }
      } else if (r.kind === "pi.tool-result") {
        const ev = calls.get(m.toolCallId);
        if (ev) {
          ev.took = +((m.durationMs ?? 0) / 1000).toFixed(1);
          ev.result = short(textOf(m.content), 200);
          if (m.isError) ev.error = true;
        }
      }
    }
    return out;
  } finally {
    db.close();
  }
}

// From each message of the person to the agent's last answer or call before the next message.
export function working(list) {
  const spans = [];
  for (const e of list) {
    if (e.kind === "sent") spans.push({ from: e.at, to: e.at, message: e.text });
    else if (spans.length) spans.at(-1).to = Math.max(spans.at(-1).to, e.at + (e.took || 0) * 1000);
  }
  return spans.filter((s) => s.to - s.from > 1000);
}

// a service's word for "it is out": published, posted, executed, live
export const DONE = /\b(executed|published|posted|live|veröffentlicht|gepostet)\b/i;
