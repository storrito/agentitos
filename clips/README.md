# clips

One long video in, finished vertical shorts out, **in the video's own look**: the speaker's footage cut to the moment, framed 9:16 on whoever speaks, pauses and "äh"s cut, every clip at the same level, captions, and a hook card where the first line does not hook. The moments are whole passages that **stand alone** for the channel's followers: from the question or the first sentence to the last conclusion, nothing that leans on the rest of the video, 59 seconds by default and longer where the platforms take it.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the previews are a project of its `hyperframes` template, the shorts are published with agentitos' [publish-video](../publish-video/) through Storrito.

```bash
node tools/episode.mjs fetch https://www.youtube.com/watch?v=… work/episode   # every word, its time and speaker
node tools/episode.mjs moments work/episode [--max-seconds 100]              # what is inside, the moments, the ideas to record anew
node tools/clips.mjs prepare work/episode work/01 412-431 \
  --out artifacts/clips/composition/01-posting --platform reels,tiktok,shorts --hook "Daily posting *hurt* us" \
  --drop 418-420 --payoff 429                                                 # leave the marked sentences out; the strongest line's words
node ../best-takes/tools/takes.mjs build work/01/takes                        # the preview
node ../best-takes/tools/takes.mjs captions work/01/takes --style hormozi
node ../best-takes/tools/takes.mjs check work/01/takes
node tools/clips.mjs render work/01 work/out/01.mp4                          # the video at −14 LUFS, and 01.srt
```

Requirements: Node 20+, ffmpeg, the HyperFrames CLI (for the render), OpenRouter (`OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection), and agentitos' [best-takes](../best-takes/), [captions](../captions/), [platform-zones](../platform-zones/) and [transcribe](../transcribe/) beside this skill (for b-roll also [b-roll](../b-roll/)) (transcribe also through `TRANSCRIBE` naming its `tools/transcribe.mjs`). yt-dlp from the PATH, else downloaded once into `~/.cache/agentitos/`. No npm dependencies.

## How it works

1. **`episode.mjs fetch`** reads a link's facts with yt-dlp, takes its sound and writes down every word with its time and speaker (ElevenLabs Scribe through OpenRouter, by agentitos' transcribe skill with `--speakers`: pieces side by side, and once more in long requests where their voices cannot be told to be the same people; about 22 cents an hour, twice that with the long requests; the noises it marks are left out); without OpenRouter it takes YouTube's own captions, without speakers. A file goes the same way, its sound written down as it is. `sentences.txt` numbers the sentences (they end at . ! ? and where the voice changes).
2. **`episode.mjs moments`** has Gemini 3.8 Flash read `sentences.txt` once (5 to 9 cents an hour), so that the agent's chat does not carry the whole video through every later step. It started from [Melvynx' `/clips`](https://github.com/Melvynx/video-agent-skills) (MIT) and was changed after a measurement against the shorts that five channels' own editors cut from nine episodes (November 2026: the old rubric gave every moment 8 to 10 points of 10 and returned only part of every passage longer than 59 s):
   - what the video holds: claims, stories, numbers, mistakes, how-tos, answers, exchanges (a quick back-and-forth with a laugh). Under four in all it is too thin for clips;
   - each moment a **whole passage**, a range of whole sentences: an answer from its question (when the first sentence answers a question just before it, the tool notes that question in `checks.asked` and moves nothing: a rule that moved the start there took it away from the editors' start every time it touched a covered pick), a story from its first sentence, to its last conclusion, not the first finished thought. `--max-seconds` (default 59, it fits every post type Storrito offers) is how long a short may be; a passage up to 1.7 times that is returned whole with the sentences an editor would cut marked (`drop`), never its first or last sentence or its payoff;
   - the sentence with the strongest line (`payoff`), and a hook for the screen (6 words or fewer, never a label) where the opening does not hook;
   - "stands alone" for the channel's own followers: the video's title and description go into the prompt, the names in them count as introduced;
   - the moments **in the order of the episode**, with `opens`, the model's 1–10 for how well the first sentence works on someone who has seen nothing (it decides which of two overlapping moments stays). No order is claimed: the old score, the model's own ranking and `opens` put the editors' picks ahead of the other moments in 0.66, 0.45–0.56 and 0.50 of the pairs on the nine tuning episodes, and the episode's order in 0.34–0.45 on three others (0.5 is chance; see "Measured"). What can be counted the tool counts itself (`checks`): whether it opens with a question, the question just before it that it answers (`asked`), a conjunction in the middle of a voice's turn, how many voices, seconds over the limit;
   - the ideas too spread out over the video to cut, worth recording anew.

   `moments.json`: `{ limit, count, inventory, moments: [{ first, last, kind, title, why, opens, payoff, hook, crosstalk, drop, start, end, seconds, kept, checks: { question, conjunction, voices, over, asked }, opening, link }], ideas }`, in the order of the episode. `kept` is the length without the `drop` sentences.

3. **`episode.mjs cut`** downloads only the stretch (up to 4K: a 9:16 window of a wide shot is a third of its width) with a breath of air around it, or cuts it from the file.
4. **`frame.mjs`** cuts footage wider than the frame to it, on whoever speaks: Gemini 3.8 Flash watches the clip once (a small copy without the file's tags; about a cent) and names the camera shots and, in each, every face with the voice it speaks with; the window sits on the face of the voice heard most, a turn under 1.5 s (a "ja", a laugh) moves nothing, a reaction shot shows who it shows, cuts snap to the footage's own (ffmpeg scene changes). What a window would cut apart is shown whole, above the captions over a blurred, darker copy of itself: B-roll (a photo, archive footage, a place, a document, a screen; Gemini names each shot's kind and the box that must stay visible) and a picture split into feeds side by side. Two who speak, too far apart for one window, go one above the other (two panels from the top, the captions on the lower one's chest): a split screen of two voices always, one shot of both while they talk back and forth (three turns or more of under five seconds). Without OpenRouter the footage stays centred. The windows are kept in `framed.json`, each shot's middle beside its frame in `framed.sheet.jpg`; `clips.mjs reframe <clip> --whole <s>` / `--follow <s>` (one window on who speaks, never two above each other) changes a shot's kind without asking the model again and keeps the edit.
5. **`clips.mjs prepare`** runs the three above for one moment and hands the framed clip to [best-takes](../best-takes/) (`takes.mjs new --aspect 9:16 --pauses tight --punch on`): ElevenLabs Scribe writes the clip's words again, word-exact, "äh"s included; every pause over 0.4 s goes whatever the picture shows; at every jump cut the picture goes 12 % closer or back out, closer on a key word, never on a piece shown whole or two above each other (`takes/source/still.json`); one keep of the whole moment goes into `takes/cut.json`, from the first word heard whole to the last (the cut's air may hold the tail of the sentence before). `--drop 418-420` leaves those sentences out: a keep on each side, a jump cut between. `--payoff 429` prints that sentence's words in the clip as a keep (past an "and" or "so" it begins with, with `"again": true`, so that best-takes plays it where it was said too): put it at the top of `cut.json` to open the short with the strongest line spoken (the keeps play in their order). From there the edit is best-takes': `build` (with `--hook` for the card), `captions`, `check`.
6. **`clips.mjs render`** (`render-all <clips.json> <folder>` for all, one after the other; `prepare-all <episode> <clips.json>` prepares them side by side, as many as the memory holds) renders the built preview with HyperFrames (6 Mbit/s) and runs best-takes' `finish`: −14 LUFS, a true-peak limit, the subtitles as `.srt` beside the video.

`kinetic-lyrics` uses the same `episode.mjs` and `frame.mjs` (its `tools/` run them from here) and puts every word big on screen instead.

## Measured (November 2026)

The moments were held against the shorts that channels' own editors cut from the same episodes: nine episodes of five channels to tune on (27 editors' shorts that are one passage of the episode, 15 of them longer than 59 s), then once three episodes of three other channels (12 shorts, 3 longer than 59 s). Three runs each, means; chance is the same number of spans of the same lengths at random places. "Order" is the share of pairs in which a moment that covers an editor's short is listed before one that covers none (0.5 is chance).

| | covered (chance) | long ones whole | short ones whole | start / end within 2 s | both ends within 5 s | order | median length |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nine, before | 9.3 of 27 (2.5) | 0 of 15 | 4.3 of 12 | 5.7 / 6.7 | 4.3 | 0.66 (score) | 38 s |
| nine, now, 59 s | 10.3 (4.1) | 1.3 | 5.7 | 7.7 / 6.3 | 6.3 | 0.55 (episode) | 52 s |
| nine, near now, 100 s | 12.0 (5.5) | 3.3 | 5.0 | 6.0 / 5.7 | 3.0 | 0.45 | 66 s |
| three, before | 5.3 of 12 (1.2) | 0 of 3 | 3.3 of 9 | 2.7 / 3.0 | 2.0 | 0.50 (score) | 40 s |
| three, now, 59 s | 6.0 (1.9) | 0 | 5.3 | 2.0 / 2.0 | 1.3 | 0.34 (episode) | 52 s |
| three, now, 100 s | 6.7 (2.9) | 0 | 5.7 | 2.3 / 2.0 | 0.3 | 0.45 (episode) | 91 s |

("Near now, 100 s" is the version just before `opens`; the selection prompt is otherwise the same.) What holds on both sets: the moments are whole passages now, longer, and more of the editors' short passages come back whole (nine: 5.7 of 12 instead of 4.3; three: 5.3 of 9 instead of 3.3). What does not: the gain in covered shorts is no larger than the gain of chance from the longer moments, starts and ends are not closer to the editors' on the three, long passages come back whole only on the nine and only at 100 s, and no order of the moments (the old score, the model's ranking, `opens`, the counted checks, the episode's order) puts the editors' shorts ahead reliably. A second, local pass for the edges (one small call per moment with the two minutes around it) did not help on either set (three: starts within 2 s 1.3 instead of 2.0) and cost 11–14 cents an hour more; it was taken out. Small numbers: about ten covered shorts a run on the nine, five or six on the three.

## What is next

Divide the whole episode into its passages first (from the question that opens a topic to its last beat, a topic line each), then let the agent and the person choose among them. Tried once as an experiment, three runs: on the nine episodes both edges lay within 5 s of the editors' for 10 of 27 shorts (moments: about 6; chance 0.2), 27–30 passages an hour, median 80–95 s, 3–4 cents an hour; on the three it was 0.7 of 12 (moments: 1.3), with passages of a median 120–155 s. It finds edges, not passages the selection misses, and only where its passages are as fine as the editors' cuts.

## Limits

- A clip is only as good as its moment: a video full of "as we saw", "this slide" gives few clips and more ideas to record anew.
- The framing follows faces and voices and shows B-roll, photos and split screens whole, smaller, above the captions; a picture in a picture is cut as one picture.
- A subject that moves without speaking (a car, a player, an animal) is followed by [auto-reframe](../auto-reframe/) (CPU tracking, offline), not by this framing, which goes by faces and voices.
- Only material the person may use.
