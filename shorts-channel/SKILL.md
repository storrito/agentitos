---
name: shorts-channel
description: Runs a short-video channel day by day (the day's topics chosen, each made into a video by another skill, shown for a yes or scheduled by itself through Storrito, logged and reviewed weekly); for an account that posts on a rhythm without the person doing it each time.
license: MIT
metadata:
  title: "Run a channel"
  title-de: "Einen Kanal bespielen"
  summary: "A channel that runs for you: every day its topics found, each made into a video, shown to you for a yes, then scheduled; later by itself."
  summary-de: "Ein Kanal, der für dich läuft: jeden Tag die Themen gefunden, jedes als Video gebaut, dir zur Freigabe gezeigt und eingeplant; später von selbst."
  ask: "Which account should I run, and what is it about? Tell me the topic, the language and how often it should post."
  ask-de: "Welchen Account soll ich bespielen, und worum geht es? Sag mir Thema, Sprache und wie oft er posten soll."
  placeholder: "The account and its topic"
  placeholder-de: "Der Account und sein Thema"
  inputs: ""
---

# shorts-channel

You run in rragent and run one channel: you choose its topics, have each made into a video, get it out, and remember what went out. You make no video and publish nothing yourself: both are other skills' jobs, whose SKILL.md you follow when you reach that step. `<skill>` is the folder of this file. Full reference: [README.md](README.md).

What the person sees lies under `artifacts/`: `channel.md` (what was agreed), `backlog.md` (topics), `today.md` (the day's plan), `log.md` (what went out and what you learned).

## What it needs

Beside this skill, agentitos' **narrated-short** (or another skill that makes a video from a story; the channel names which), **footage**, **publish-video** with **video-descriptions**, and **workflow-diagram**; the account connected in Storrito. This skill has no tools of its own. When one of them is missing, say so in one sentence ("Running a channel needs agentitos' narrated-short skill beside this one") and stop; never install it.

## 1. The channel, agreed once

Before the first video, agree on the channel and write it to `artifacts/channel.md`; every run reads it first. Take what the person already said, look up what you can, and ask only for what is left.

- **The account**: `node <skill>/../publish-video/tools/publish.mjs accounts` lists the targets; the channel's is one of them (`tiktok/<account>/post`, …). Say in one sentence which account you take and what you understood of the topic and the language, and ask them to type what is wrong and the account's `@handle` as the app shows it.
- **The rhythm, the approval and the two standing answers** for publishing are one form (see "UI in the chat"), your proposal ticked where it is yours to make, nothing ticked where the choice is the person's own:

```hiccup
[:div
 [:p "Four things to settle once. Pick one in each, then save."]
 [:p [:strong "Videos a day"] [:br]
  [:label [:input {:type "radio" :name "cadence" :value "cadence: 3 a day at 11:00, 14:00 and 17:00 Europe/Berlin" :checked true}] " 3 a day: 11:00, 14:00, 17:00 (Berlin)"] [:br]
  [:label [:input {:type "radio" :name "cadence" :value "cadence: 1 a day at 17:00 Europe/Berlin"}] " 1 a day: 17:00 (Berlin)"]]
 [:p [:strong "Before a video goes out"] [:br]
  [:label [:input {:type "radio" :name "approval" :value "approval: show me each video first" :checked true}] " Show me each one first"] [:br]
  [:label [:input {:type "radio" :name "approval" :value "approval: schedule by yourself"}] " Schedule by yourself"]]
 [:p [:strong "Who may see the videos on TikTok"] [:br]
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: everyone"}] " Everyone"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: followers"}] " Followers"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: friends"}] " Friends"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: only me"}] " Only me"]]
 [:p [:strong "The AI label"] " (the voice is an AI's, the pictures are real)" [:br]
  [:label [:input {:type "radio" :name "ai" :value "AI label: yes"}] " Yes, label them"] " "
  [:label [:input {:type "radio" :name "ai" :value "AI label: no"}] " No"]]
 [:button {:class "primary" :send "Channel: {checked}"} "Save"]
 [:p [:small "Other times, or anything else: type it."]]]
```

Only the groups the account's platforms need (publish-video's `accounts` names what each asks for), at most four a block: what a platform asks beyond these (YouTube: made for kids) is a second block after the first is answered.
- **The voice and the style of the post texts**, a second form of two groups: samples of three or four voices made with the video skill's voice tool for the person to hear, your pick ticked; the three or four styles of video-descriptions that fit, your pick ticked.

`channel.md` holds all of it with the date, and what the channel learns: its **lanes** (kinds of topics, every post tagged with one, each with a numbered series label), its two fixed **hashtags**, the **news sources** that proved useful, the **handles** of makers and footage owners you confirmed (with where), and under "Learned" its rules. The approval is `each` (nothing goes out without the person's yes to that video) or `none`; the person switches it with a sentence, you write it down with the date and never switch it yourself.

## 2. A day's topics

Read `<skill>/references/topics.md` before you choose. The topics of a day and two reserves go into `artifacts/today.md`, one line a slot: the slot, the topic, its lane, its mechanism, its status (`planned`; `ready`: the video waits for the person's yes; `scheduled`; `skipped` with why).

## 3. A video

For a slot's topic follow the video skill of `channel.md` (narrated-short: its steps 1 to 9), with the channel's handle, voice and language. The questions of that skill are the person's while they are in the chat; in a run this skill's job stands in for them, as "By itself" says.

## 4. Out with it

Follow **publish-video** for the finished video: its `check`, the texts with video-descriptions in the channel's style, then `publish` to the channel's target only, at the slot's time, with the standing answers of `channel.md`. publish-video asks the person where the video goes, in which style, who may see it and when, and publishes nothing before they agreed to the texts: for this channel those answers were given once and stand in `channel.md`, so you do not ask them again. What is still theirs each time is the yes to the video and its text, with approval `each`; with `none` they gave that yes for every video of the channel when they switched it. In the first line of a text: the search term and the hook in front, the lane's series label at the end. Credits: the footage's owner and the sources of the facts, by name. Mentions only of handles confirmed in `channel.md`.

With approval `each`, one finished video at a time, in the person's language:

```hiccup
[:div
 [:p "Atlas on wheels: \"IT ROLLS NOW\". 41 s, for today 14:00."]
 [:p [:small "Its text: \"Atlas on wheels: the humanoid that rolls · Robot News #12\""]]
 [:button {:open "artifacts/atlas-wheels.mp4"} "Watch ↗"] " "
 [:button {:class "primary" :send "Yes, schedule the Atlas video for 14:00"} "Schedule 14:00"] " "
 [:button {:send "Drop the Atlas video"} "Drop it"]
 [:p [:small "Type what to change: the hook, a sentence, a shot."]]]
```

The card shows the first line of the post text; the whole text when they ask. A yes: publish it for its slot. A slot that is past or under ten minutes away: ten minutes from now, as long as that is before 20:00 in the channel's zone; later than that, the next day's first free slot. Say which time it became. A change: back to the video skill, then the card again. Dropped: marked in `backlog.md` with why. The next card after the answer to this one.

Then the books: `remember` an event `posted` (the topic, lane, mechanism, series, slot, target, source), mark the topic in `backlog.md`, one line in `log.md` (what, whose footage, what you learned), a new lesson as one line under "Learned" in `channel.md`.

## 5. By itself

When the first video went out and the person wants it on a rhythm:

1. Write the job into your definition: the channel in a sentence, that everything agreed is in `artifacts/channel.md`, and the runs below.
2. Show how it will run with **workflow-diagram** (its SKILL.md: the cards, the build, the card in the chat that asks for the yes). Nothing is scheduled before their yes to that page.
3. Set the schedules (`schedule`, the channel's zone), by default:
   - `plan`, early (05:30): "Plan today's videos: …" The backlog refreshed from the news, the day's topics and two reserves into `today.md`; no footage is downloaded yet.
   - one `make-<slot>` a slot, an hour apart (from 06:00): "Make today's 11:00 video: …" That slot's line of `today.md` (a reserve when its footage fails) made into a video; with `none` scheduled and marked `scheduled`, with `each` marked `ready` and told to the person (`report`: one sentence, "Today's 14:00 video is ready for your yes: Atlas on wheels"), whose yes you take in the chat with the card of step 4.
   - `review`, weekly (Mondays 05:00): what went out last week and what is known of how it did (publish-video's `status`, numbers the person gave you), which lanes carried, at most three proposals for the rules in `channel.md`. What the person decided (rhythm, approval, voice, look) is proposed, never changed.

A run asks nobody: it decides by `channel.md` and says why in `today.md`. It starts no video later than 90 minutes before its slot's time; a slot it cannot fill is `skipped` with the reason and reported in one sentence. A publish that failed is never fired again: report it.

When the job changes so that the page of step 2 no longer shows what happens, build the page again and show it.

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block; `:open "artifacts/<path>"` shows that file beside the chat. No text fields: what cannot be picked, they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else.
- Several questions that must all be answered before you go on, none depending on another: one block, a group of radio buttons per question (own `:name`, every `:value` saying what it answers, at most four groups) and **one** button whose `:send` holds `{checked}`. Never a block of several questions whose buttons each send one answer. An answer that leaves a group out: ask again for that group only.
- One after the other only when a question depends on the answer before, or on work the person should see first.
- A button only where a click makes you act at once. Never one that only leads to typing or to your next question ("Change…", "Other…").
- The button that moves on gets `:class "primary"`; a button that opens an artifact ends with " ↗".
- Never a target's id, a working path or a raw error in the chat.

## Rules

- Only this channel's account, only its slots. Never delete or change a post that is out, never touch another account.
- Nothing goes out that the approval of `channel.md` does not cover.
- The footage's judgement and the video skill's quality round are not skipped in a run; a slot is rather left empty.
