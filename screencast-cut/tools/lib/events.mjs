// What happened in the agent while the screencast was recorded, from the agent's own record: a
// recording made in rragent's recorder lies in <home>/bots/<id>/work/artifacts/recordings/<stamp>/,
// and <home>/agent.sqlite holds the bot's conversation (conversation <id>) with a time on every
// entry. So the cut knows, without guessing from the picture, when the person sent a message,
// which tools the agent called and for how long, what a service answered (a story "scheduled",
// then "executed"), and when the agent answered: the wait between a message and its answer is
// the agent working, a span for a timelapse; a service's "posted" is a result that needs its
// proof on screen.
//
// The recording's clock is the laptop's, the agent's the machine's; both keep the time of the
// internet, so they agree to well under a second.
//
//   events(folder, t0) → { bot, events: [{ t, kind, text, … }] } or null (not in an rragent home)
//   kinds: "sent" (the person's message), "tool" (a call: name, what, took, result), "answer"

import fs from "node:fs";
import path from "node:path";

const short = (s, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const textOf = (content) => (typeof content === "string" ? content
  : (content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n"));

// the agent's home and the bot of a recording folder
export function homeOf(folder) {
  const parts = path.resolve(folder).split(path.sep);
  const k = parts.lastIndexOf("bots");
  if (k < 1 || !/^\d+$/.test(parts[k + 1] || "") || parts[k + 2] !== "work") return null;
  const home = parts.slice(0, k).join(path.sep) || path.sep;
  const db = path.join(home, "agent.sqlite");
  return fs.existsSync(db) ? { home, db, bot: Number(parts[k + 1]) } : null;
}

export async function events(folder, t0, duration) {
  const where = homeOf(folder);
  if (!where) return null;
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return null; }
  const db = new DatabaseSync(where.db, { readOnly: true });
  try {
    const from = t0 - 10e3, to = t0 + (duration + 10) * 1000;
    const rows = db.prepare("select id, record from entries where conversation_id = ? order by id").all(where.bot);
    const out = [], calls = new Map();
    for (const row of rows) {
      let r;
      try { r = JSON.parse(row.record); } catch { continue; }
      const m = r.model?.[0];
      const at = m?.timestamp ?? r.data?.at;
      if (!at || at < from || at > to) continue;
      const t = +((at - t0) / 1000).toFixed(2);
      if (r.kind === "pi.user") {
        const text = textOf(m.content);
        if (/^New recording in artifacts\/recordings\//.test(text)) continue;
        out.push({ t, kind: "sent", text: short(text, 300) });
      } else if (r.kind === "pi.assistant") {
        for (const p of m.content || []) {
          if (p.type === "toolCall") {
            const a = p.arguments || {};
            const ev = { t, kind: "tool", name: p.name, what: short(a.command || a.code || a.path || a.file || JSON.stringify(a), 140) };
            calls.set(p.id, ev);
            out.push(ev);
          } else if (p.type === "text" && p.text.trim()) {
            out.push({ t, kind: "answer", text: short(p.text, 300) });
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
    return { bot: where.bot, events: out };
  } finally {
    db.close();
  }
}

// The spans in which the agent worked: from each message of the person to the agent's last
// answer before the next message.
export function working(list) {
  const spans = [];
  for (const e of list) {
    if (e.kind === "sent") spans.push({ from: e.t, to: e.t, message: e.text });
    else if (spans.length && (e.kind === "answer" || e.kind === "tool")) spans.at(-1).to = Math.max(spans.at(-1).to, e.t + (e.took || 0));
  }
  return spans.filter((s) => s.to - s.from > 1);
}

// a service's word for "it is out": published, posted, executed, live
export const DONE = /\b(executed|published|posted|live|veröffentlicht|gepostet)\b/i;
