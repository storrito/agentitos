---
name: agent-timeline
description: Tells what this rragent agent did in a time span or screencast recording (messages, tool calls, durations, results); use when asked what it did meanwhile or when cutting such a screencast.
license: MIT
metadata:
  title: "Agent timeline"
  title-de: "Agenten-Zeitleiste"
  summary: "What the agent did while you recorded, or in any span: your messages, its steps and how long each took, its answers."
  summary-de: "Was der Agent getan hat, während du aufgenommen hast, oder in einer beliebigen Zeitspanne: deine Nachrichten, seine Schritte und wie lange jeder dauerte, seine Antworten."
  ask: "Name a recording, or a span of time (\"the last 20 minutes\"). I tell you what I did meanwhile, step by step, with the times."
  ask-de: "Nenn mir eine Aufnahme oder eine Zeitspanne („die letzten 20 Minuten“). Ich sage dir, was ich in der Zeit getan habe, Schritt für Schritt, mit den Zeiten."
  placeholder: "Which recording or span?"
  placeholder-de: "Welche Aufnahme oder Zeitspanne?"
  inputs: ""
---

# agent-timeline

You run in rragent. `<skill>` is this file's folder. Run `node <skill>/tools/timeline.mjs …` from your working directory (your bot's folder: that is how the tool knows which bot you are). Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 22.13+ (it reads the agent's record with `node:sqlite`, read-only). Nothing else, no model, no cost.

## The timeline

For a recording of rragent's screencast recorder (`artifacts/recordings/<time>`):

```bash
node <skill>/tools/timeline.mjs artifacts/recordings/<time> --json screencast/<name>/agent.json
```

For a span: `--from -20m` (twenty minutes ago), `--from 2026-10-23T11:05:00+02:00 --to 2026-10-23T11:10:00+02:00`. It prints every message the person sent, every tool call with its duration and answer (★ where a service says it is out: "executed", "published", "posted"), every answer, and the spans the agent worked; times from the span's start (for a recording: the recording's time) and the wall clock. `--json` writes the same for another tool: `events`, `working`, `pauses` and `out`, times in seconds from the start.

When the person paused the recording, the times leave the pauses out, as the files do. What happened during a pause (⏸, `paused: true`) is not in the video: it stands at the moment the pause began; a result that went out then is not seen, say so instead of holding on it.

Asked what you did meanwhile: a few sentences in the person's language, the steps that mattered and how long the waits were; no tool names or paths unless they ask.

## For a screencast cut

When you cut a screencast of yourself at work (agentitos' screencast-cut), the timeline says what the picture does not:

- **The waits.** Every span in which you worked (`working`) is a wait to speed up: find the last word said before it in the brief (`screencast/<name>/source/brief.md`, the sentences with their times; the recording's time is the timeline's) and add it to cut.json's `"waits"`. The build plays the time up to the next keep fast.
- **The results.** Every ★ (`out`) is the moment a result went out: the keep that shows it gets `"hold": 2.5`, and the proof (the phone's screen, the page) belongs right after it.
- **The steps.** The messages the person sent are the steps of the story: a `"label"` each ("01 · Ask", "02 · Post").

The recording's clock is the laptop's, the agent's the machine's; both keep internet time, so they agree to well under a second.
