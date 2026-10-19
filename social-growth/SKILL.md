---
name: social-growth
description: Grow a short-video account (TikTok, Instagram Reels, YouTube Shorts) with a measured loop instead of gut feeling. Set up the account's strategy with the person, pick topics by how new their "aha" is, write every post's hook so the first frame proves the first sentence, read breakouts against the account's own median, run one experiment at a time and review weekly. Use when someone wants more reach or followers, a content or posting plan, or to understand why some posts break out and others stall. Hands each post's brief to a production skill (e.g. kinetic-lyrics) and schedules through Storrito.
license: MIT
metadata:
  title: "Grow an account"
  title-de: "Account wachsen lassen"
  summary: "A content plan that learns from your numbers: what to post, how to open it, what to test, every week."
  summary-de: "Ein Content-Plan, der aus deinen Zahlen lernt: was posten, wie einsteigen, was testen, jede Woche."
  ask: "Tell me which account you want to grow and what it is about. If you have numbers of your last posts (an export or screenshots), attach them."
  ask-de: "Sag mir, welchen Account du wachsen lassen willst und worum es geht. Wenn du Zahlen deiner letzten Posts hast (Export oder Screenshots), häng sie an."
  placeholder: "Which account, what is it about?"
  placeholder-de: "Welcher Account, worum geht es?"
  inputs: "image"
---

# social-growth

> **Draft.** Built from one pilot account (faceless short videos, ~120 measured posts). Rules marked *measured*
> held on that account; rules marked *hypothesis* are being tested there. Status of every rule:
> [README.md](README.md) → Evidence.

`<skill>` below is the folder this file is in. Run the tool as `python3 <skill>/scripts/growth.py …` from
your own working directory; everything you write goes to `work/growth/`, never into `<skill>`.
Full reference: [README.md](README.md). The why behind each rule: `<skill>/references/`.

## Setup

`python3` (3.9+), nothing to install. Accounts and scheduling come from the Storrito connection
(`list-social-accounts`, the `schedule-…` and `status-…` tools). Storrito does not deliver post metrics (yet):
numbers come from the person, see step 2. This skill plans and measures; the videos come from a production
skill or from the person.

## State

The loop runs over weeks, so it lives in files. At the start of every conversation read
`work/growth/strategy.md` and the newest file in `work/growth/reviews/`; with no `strategy.md`, start at step 1.

| file | from | what |
|---|---|---|
| `strategy.md` | `<skill>/templates/strategy.md` | the person's decisions, lanes, current rules, running tests |
| `posts.json` | `<skill>/templates/posts.json` | every published **or scheduled** post: lane, mechanism, tags, numbers |
| `mechanisms.json` | `<skill>/templates/mechanisms.json` | the "aha" registry and its rules |
| `backlog.md` | — | topic candidates, ranked, with their footage check |
| `briefs/<date>-<slug>.md` | `<skill>/templates/brief.md` | one per post: hook, proof frame, facts with sources, ending, caption |
| `reviews/<date>.md` | `<skill>/templates/weekly-review.md` | one per week |
| `retention.json` | `<skill>/templates/retention.json` | watch time and traffic source, read off the person's screenshots |

## 1. Strategy (first conversation)

1. **Accounts:** call `list-social-accounts` and show the short-video accounts as checkboxes; ask which one to grow.
2. **What it is about, for whom, and what they can make:** own footage, licensed footage, only stills, a face on camera? That decides the formats, not the other way round.
3. **Their decisions:** cadence, platforms, the look, whether you may schedule on your own. Recommend at least one post a day: more posts are more chances at a breakout, and no large study found that frequency hurts (`references/platform-rules.md`). Write their answers into `strategy.md` → "Decided by the person". You never change those, you only propose.
4. **Lanes:** two or three recurring topic families to start with (`references/topics-and-mechanisms.md`).
5. **Baseline:** ask for numbers of their last 20–50 posts (TikTok Studio / Instagram Insights export or screenshots) → step 2.

## 2. Numbers

Put every post into `posts.json` (format in the template). Storrito does not deliver post metrics yet, so the
numbers come from the person: TikTok Studio / Instagram Insights exports or screenshots. Read them and transcribe
them; never estimate a missing number. Once Storrito's API or MCP offers metrics, read them from there instead.
Include scheduled posts without numbers too, so the mechanism cap counts them. Then

```bash
python3 <skill>/scripts/growth.py report work/growth/posts.json [--compare <tag>] --out work/growth/report.md
```

and tell the person in three lines: the breakout line (2 × the account's median), which lanes and mechanisms
break out, and what that means for the next posts. Definitions and pitfalls: `references/measurement.md`.

## 3. Topics

```bash
python3 <skill>/scripts/growth.py mechanisms work/growth/posts.json work/growth/mechanisms.json
```

lists every mechanism as `open`, `FULL until …` (at most 3 posts in 14 days) or `CLOSED` (4 readable posts,
no breakout). Pick from `open`, prefer new mechanisms (`add-mechanism` registers one), keep the day's mix
from `strategy.md`. Story over spectacle, a name everyone knows in the first sentence. Check footage before
committing to a topic: metadata first, then look at frames; a documentary made of photographs passes the
first check and dies in production. Why: `references/topics-and-mechanisms.md`.

## 4. Brief per post

One `briefs/<date>-<slug>.md` per post from the template, then hand it to the production skill. Non-negotiable
(`references/hooks-and-retention.md`):

- the **first frame proves the first sentence**: choose the hook shot first, then write the sentence for it;
- the first sentence is a contradiction, a secret or something impossible, not a spec, a price or a superlative,
  and never "Remember the …?";
- a **text hook** of 2–5 words on screen from frame 0, the same words as the cover;
- **no end card**: end on action shortly after the last word; the second-to-last sentence leads back to the hook;
- a **size check** graphic whenever size, mass, speed or power is the aha, every reference value sourced;
- every fact traces to a source written in the brief.

Caption and cover rules: `references/followers.md`, `references/covers.md`, `references/platform-rules.md`.

## 5. Schedule

Schedule through Storrito with the procedures `list-social-accounts` names for each account, after the person
agreed to the plan (or once, for good, in "Decided by the person"). Write each post into `posts.json` with
its lane, mechanism and tags (`cta`, `cut`, `format`, … whatever a running test needs) when you schedule it,
and check with the `status-…` tools that it went out. A failed upload is reported, never fired a second time.

## 6. Weekly review

Once a week (`templates/weekly-review.md`): numbers since the last review, tests that reached their sample
size, mechanisms to close or reopen, lanes to drop or try. **Change** what the rules let you change (topic
rules, mechanism statuses, wording of hooks and endings); **propose** everything in "Decided by the person".
One new experiment at a time, written down with its variable, arms, metric and verdict date before it starts.
Name the three best and three weakest posts and ask for their TikTok Studio / Insights screenshots (watch time,
watched to the end, traffic sources, new followers): the usual APIs don't have these.

## UI in the chat

When the harness renders ```hiccup blocks (EDN, data only), use them for choices: `:send "text"` on a button
sends that text as the person's next message; `[:input {:type "checkbox" :value "…"}]` boxes and `{checked}`
in a button's `:send` collect what was ticked. There are no text fields: say what to type. Keep messages to one
or two sentences plus the block; speak the person's language.

## Rights

Only material the person may use. Re-cut third-party footage is risky twice: rights holders can claim it, and
TikTok keeps clips that show someone else's watermark or logo out of the For You feed; Instagram demotes
accounts that mostly repost. Say so once when the plan relies on it (`references/platform-rules.md`).

## Rules

- The person's decisions are theirs: propose, never change.
- A small sample is a tendency, not proof: say which. Let a rule run another week rather than flip-flop.
- Never invent a number; a missing one stays missing.
- One variable per test; never start a second test on the same unit (post or day) as a running one.
