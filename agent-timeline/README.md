# agent-timeline

What an [rragent](https://github.com/storrito/rragent) bot did in a span of time, from the agent's own record: the person's messages, every tool call with how long it took and what it answered, the agent's answers, and the spans in which it worked. For a recording of rragent's screencast recorder, the span is the recording's, timed from its start.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/timeline.mjs artifacts/recordings/2026-10-23T11-04-56 --json screencast/demo/agent.json
node tools/timeline.mjs --from -20m
node tools/timeline.mjs --from 2026-10-23T11:05:00+02:00 --to 2026-10-23T11:10:00+02:00 --bot 333 --home /home/sprite/rragent/agent
```

Requirements: Node 22.5+ (`node:sqlite`). No dependencies, no model, nothing leaves the machine.

## Where the record is

An rragent agent keeps every bot's conversation in `<home>/agent.sqlite` (pi-durable's storage; `entries`, one JSON `record` per entry), the bot `<id>` being conversation `<id>` with its folder `<home>/bots/<id>/`. Every entry carries the time it was made: a message of the person (`pi.user`), the agent's turn with its text and tool calls (`pi.assistant`), a tool's result with how long it ran (`pi.tool-result`). The tool reads it read-only.

The bot is the one whose folder the recording, or the working directory, lies in (a bot's bash runs in `<home>/bots/<id>/work`, its recordings lie in `work/artifacts/recordings/`); `--home` and `--bot` name another.

## What it says

- **sent**: a message of the person (the recorder's own "New recording in …" notice is left out);
- **tool calls**: the tool, what it was given (the command, the code, the path), how long it took, what it answered, ✗ when it failed, ★ when the answer says something is out ("executed", "published", "posted", "live");
- **answered**: the agent's text;
- **working**: from each message to the agent's last answer or call before the next message.

`--json` writes `{bot, from, to, events: [{t, kind, …}], working: [{from, to, message}], out: [{t, what}]}`, times in seconds from the span's start.

## With screencast-cut

A screencast of the agent at work shows a chat that changes a few pixels while the agent thinks for a minute; the picture cannot say that this is the wait, nor when the post went out. The timeline can: its `working` spans are the cut's `"waits"`, its `out` moments the results to hold, its messages the steps to label (see SKILL.md). The recording's times are the timeline's.
