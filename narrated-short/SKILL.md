---
name: narrated-short
description: Makes a narrated 9:16 short from a story and footage of its subject (a voice tells it in a few sentences, clips cut under the words, a text hook, a comparison card, captions, music), previewed, then rendered; for news, facts and explainers with nobody on camera.
license: MIT
metadata:
  title: "Narrated short"
  title-de: "Erzähltes Kurzvideo"
  summary: "A short video that tells one story: a voice, footage of the subject cut to its words, a hook, captions and music, shown to you before it is rendered."
  summary-de: "Ein Kurzvideo, das eine Geschichte erzählt: eine Stimme, Material vom Motiv auf ihre Worte geschnitten, ein Hook, Untertitel und Musik, dir gezeigt, bevor es gerendert wird."
  ask: "What is the story? Name the subject and what is astonishing about it, or paste a link to the news; bring footage if you have some."
  ask-de: "Was ist die Geschichte? Nenne das Motiv und was daran erstaunt, oder füge einen Link zur Nachricht ein; bring Material mit, wenn du welches hast."
  placeholder: "The story, a link or a video"
  placeholder-de: "Die Geschichte, ein Link oder ein Video"
  inputs: "video"
  templates: [hyperframes]
---

# narrated-short

You run in rragent: chat on the left, artifacts beside it. `<skill>` is the folder of this file. Run `node <skill>/tools/short.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

Your files: `short/<name>/` (`<name>`: one short slug, lowercase letters, digits, dashes). Project: `artifacts/<name>/`, HyperFrames project `artifacts/<name>/composition/`, video `artifacts/<name>.mp4`. Every message one or two sentences and a hiccup block, in the person's language. Decide what you can and say what you decided; ask only what only they can answer.

## What it needs

Node 20+, ffmpeg and the HyperFrames CLI. Beside this skill, agentitos' **footage** (the sources), **launch-video** (`<launch>` below is `<skill>/../launch-video/tools/launch.mjs`: voice, music, the zones check, the loudness), **captions**, **platform-zones** and **transcribe**, and for the first beat's freeze **freeze-cutout** (without it the short opens on the plain clip); OpenRouter for the voice, the music and the freeze's mask: `OPENROUTER_API_KEY`, or on a Sprite the gateway's connection. A voice and the music cost a few cents each (their tools print it), a freeze 7 to 14. When something is missing, the tool says so in one sentence: pass it on, never install it.

## From a story to the video

### 1. The story and its footage

One story: a subject and the one thing about it that astonishes. Open the sources of every number and claim yourself (one good one, better two) and note them with their links in `short/<name>/brief.md`; where sources disagree, the careful wording.

The footage comes from agentitos' footage skill: follow its SKILL.md (find, fetch, look) into `footage/<name>/`, and go on only with sources whose sheets you judged. No usable footage: say so and stop, a short without pictures of its subject is not made.

### 2. The script

Read `<skill>/references/script.md` before you write it. `short/<name>/script.json`, one sentence a line. Choose the hook's clip first, then write the first sentence for it.

Show it for a yes before a word is spoken:

```hiccup
[:div
 [:p [:strong "NO LEGS. IT FLIES."] " (the text on the first seconds)"]
 [:p "This robot has no legs, no wheels and no arms, and it is about to fly. Meet Astrobee, …"]
 [:p [:small "73 words, about 25 s. Footage: NASA Ames."]]
 [:button {:class "primary" :send "The script is good, speak it"} "Speak it"]
 [:p [:small "Type what to change: the hook, a sentence, the ending."]]]
```

### 3. The voice and the clock

```bash
node <launch> zones short/<name> tiktok --frame 9:16                       # the platforms it goes to, once
node <launch> voice short/<name> short/<name>/script.json artifacts/<name>/composition
node <skill>/tools/short.mjs clock short/<name>
```

Make the project first, once, with the `project` tool (create, name `<name>`, kind `hyperframes`). `voice` speaks each line and hears it back: a word said wrong is rewritten in that line as it should sound, and `voice` run again speaks only that line. `clock` prints every sentence and word with its time in the film; these times set everything after. Longer than 46 s: cut a sentence, then `voice` and `clock` again.

### 4. The beats

Read `<skill>/references/beats.md` before you write them. `short/<name>/beats.json` says which stretch of which source runs under which words, the hook text, the first beat's freeze, the key words, the boxes and the comparison card.

```bash
node <skill>/tools/short.mjs build short/<name> artifacts/<name>/composition --platform tiktok
```

It cuts a clip per beat, checks them, builds the captions and writes the composition; the preview beside the chat shows it at once. Fix what it reports (`✗` must go, `?` and `!` are yours to look at) by changing the beats, and build again. Never edit the built `index.html`.

### 5. The music

```bash
node <launch> music short/<name> artifacts/<name>/composition --prompt "<instrumental; the story's mood, tempo, instruments, in neutral words>" --seconds <the film's length>
node <skill>/tools/short.mjs build short/<name> artifacts/<name>/composition --platform tiktok
```

The second build lays it under the voice. No music came back: the prompt in other words, once more.

### 6. Look at it

```bash
hyperframes lint artifacts/<name>/composition
node <launch> check short/<name> artifacts/<name>/composition
node <skill>/tools/short.mjs sheet short/<name> artifacts/<name>/composition
```

Read `<skill>/references/quality.md` and go through `short/<name>/sheet.jpg` by it. `lint` must name no error; its three warnings `nested_structure_needs_subcomposition` (the hook text, the card, the handle) are this composition's own and stay. `check` names text the apps would cover: a `✗` is always fixed; its `!` for the hook text and for the card may stay, both stand in the wide stretch above the buttons on purpose. Fix every defect in the beats or the script, build, look again, until nothing is left.

### 7. Ask whether it is right

One message: the story in a line, the length, whose footage, what you measured and what you only looked at, and **whether it is right**:

```hiccup
[:div
 [:p "Astrobee, 25 s, NASA's footage, for TikTok. The sound is measured, not heard."]
 [:button {:open "artifacts/astrobee"} "Show the preview ↗"] " "
 [:button {:class "primary" :send "The short looks good, render it"} "Looks good"]
 [:p [:small "Type what to change, with the moment: \"at 0:07 another shot\", \"a shorter hook\"."]]]
```

### 8. Changes

They name a moment or a part: change the beats (a shot, the hook text, a key word, the card), or the script (then `voice`, `clock`, and the beats moved to the new times), build, look at the sheet again, and ask again as in step 7 with one sentence on what changed.

### 9. The video

Only after their "looks good": say in one sentence that you are rendering, render with the `render` tool, name `<name>` (writes `artifacts/<name>.mp4`), then `node <launch> finish artifacts/<name>.mp4` brings it to −14 LUFS. Say in one sentence that it is ready, with the download link, and offer a button "Publish it": then follow agentitos' **publish-video** with the video; it checks it, writes the texts with video-descriptions (the footage's owner and the sources of the facts go into them, from `brief.md`) and schedules through Storrito. Never call Storrito's schedule procedures yourself.

## In a run of a hook or a schedule

Nobody is in the chat: the job in your definition stands in for the person's yes at steps 2 and 7, and says what happens with the video. Everything else stays, the footage's judgement and the quality round above all. A step that cannot be done ends the run with one sentence of why.

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/<name>"` shows the preview; pictures point at `uploads/…`.

- One question per block, buttons for the likely answers when a click is the whole answer, and a line that they can type anything else. Several picks from one list: checkboxes and one button whose `:send` holds `{checked}`. Several questions that must all be answered before you go on, none depending on another: one block, a group of radio buttons per question (own `:name`, every `:value` saying what it answers, at most four groups) and one button whose `:send` holds `{checked}`. One question after the other only when it depends on the answer before, or on work the person should see first.
- A button only where a click makes you act at once. Never one that only leads to your next question ("Change something"): they type what to change.
- The button that moves on gets `:class "primary"`; a button that opens an artifact ends with " ↗".
- Never a token, a path of `short/` or `footage/`, a source's id or a raw error in the chat: sources by their owner, moments by their time.

## Rules

- Every claim traces to a source in `brief.md`; every piece of footage to its owner, who is credited on screen (`credit`) and in the post text.
- Nothing is rendered before the person's yes to the preview, and one video at a time.
- Change the inputs (`script.json`, `beats.json`) and build again; the composition is never edited by hand.
