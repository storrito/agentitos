# shorts-channel

An account that posts short videos on a rhythm, run by an [rragent](https://github.com/storrito/rragent) bot: every day its topics are chosen, each is made into a video, shown to the person for a yes or scheduled by itself, logged, and looked back at once a week.

> Agents: start with [`SKILL.md`](SKILL.md).

It has no tools. It is the order in which a bot uses the others, and what it keeps between the days:

| step | whose |
| --- | --- |
| the footage of a topic | footage (its own pull request) |
| the video | narrated-short (its own pull request), or another skill that makes a video from a story |
| the texts and the publishing | [video-descriptions](../video-descriptions/), [publish-video](../publish-video/) |
| the page the person says yes to before it runs by itself | [workflow-diagram](../workflow-diagram/) |
| the runs | rragent's schedules: a fresh conversation each, with the bot's definition |

## What the bot keeps

Under `artifacts/`, where the person reads along:

- `channel.md`: what was agreed once (the account and its handle, topic and language, the rhythm, the approval, who may see the videos, the AI label, the voice, the style of the texts) and what the channel learns (its lanes with their series, hashtags, news sources, confirmed handles, rules).
- `backlog.md`: topics, newest news on top, `ready` only once their footage was looked at.
- `today.md`: a line a slot with its status: `planned`, `ready` (waits for the yes), `scheduled`, `skipped` with why.
- `log.md`: a line a video: what, whose footage, what was learned.

What went out is also an event of the bot (`posted`: topic, lane, mechanism, series, slot, target, source), which the next run recalls: no topic twice, the series numbered, the mechanisms counted.

## The approval

`each`: a run makes the video, marks it `ready` and tells the person in one sentence; the bot shows it in the chat with one card (watch, schedule, drop), and publishes only after the yes. `none`: the run schedules it. The person switches between the two with a sentence; the bot never does.

## The runs

By default, in the channel's time zone: `plan` at 05:30 (topics into `today.md`, nothing fetched), one `make-<slot>` a slot from 06:00, an hour apart (rragent runs one at a time), `review` on Mondays at 05:00. Before any of them exists, the person sees the workflow as a page of four cards ([`examples/workflow.json`](examples/workflow.json) is one for a channel with approval) and says yes to it.

## What is not here

- **How a channel grows** (which topics break out, how that is measured, experiments): the draft of social-growth (pull request 4) holds a pilot's rules for it. This skill keeps only what a daily run needs to choose a topic ([references/topics.md](references/topics.md)) and leaves the weekly review to what the bot can know: Storrito does not deliver a post's numbers yet, so they come from the person.
- **A channel's own material**: its backlog, lanes and sources are written by the bot into its artifacts, never into this folder.
