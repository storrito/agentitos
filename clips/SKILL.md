---
name: clips
description: Turns a long video (podcast, interview, webinar, talk; link or upload) into captioned 9:16 shorts of the moments that stand alone, previewed, rendered and scheduled through Storrito.
license: MIT
metadata:
  title: "Clips"
  title-de: "Clips"
  summary: "Shorts from a long video: the moments that stand alone found, cut to the speaker with captions, rendered and scheduled on your accounts."
  summary-de: "Shorts aus einem langen Video: die Stellen, die für sich stehen, gefunden, auf den Sprecher geschnitten, mit Untertiteln, gerendert und auf deinen Konten eingeplant."
  ask: "Paste the link of a long video (a podcast, an interview, a webinar, a talk), or upload it. I find the moments that work on their own as shorts, cut them with captions, and schedule them on your accounts."
  ask-de: "Füge den Link eines langen Videos ein (Podcast, Interview, Webinar, Vortrag) oder lade es hoch. Ich finde die Stellen, die für sich allein als Short funktionieren, schneide sie mit Untertiteln und plane sie auf deinen Konten ein."
  placeholder: "Paste a link or upload a video"
  placeholder-de: "Link einfügen oder Video hochladen"
  inputs: "video"
---

# clips

`<skill>` is the folder of this file. Run the tools as `node <skill>/tools/…` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

The look is the video's own: the speaker's footage, cut and framed, captions, at most a hook card. Every word big on screen over a world of light is kinetic-lyrics; recordings filmed in several attempts are best-takes.

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`). agentitos' `best-takes`, `captions`, `platform-zones`, `transcribe` and, for publishing, `publish-video` (with its `video-descriptions`) beside this one. Without OpenRouter nothing can be cut: say so. yt-dlp comes from the PATH or is downloaded once. When something is missing, say so in one sentence; never install it.

Costs (measured on twelve episodes, November 2026): the episode's words 34 to 44 cents an hour, the moments 5 to 9 cents an hour, per clip about a cent to frame it and well under a cent for its words and captions.

## From the long video to scheduled shorts, all in the chat

Each step ends with a question; the answer starts the next. Every message one or two sentences and a hiccup block, in the person's language. Decide small things yourself and say what you decided. Everything you work on lives in `work/`; the only artifact is `artifacts/clips/`, a HyperFrames project showing every clip side by side.

### 1. The video

Say in one sentence that you listen to the whole video now and that it takes a few minutes. Then `node <skill>/tools/episode.mjs fetch <url or uploads/<file>> work/episode`: it writes `work/episode/episode.json` (title, channel, length, the voices), `words.json` (every word with time and speaker) and `sentences.txt` (one numbered sentence a line).

### 2. Where they go, and the look

Ask this before the moments: the platforms set how long a moment may be. First `list-social-accounts` of the Storrito connection (rragent: `(storrito/list-social-accounts {})` in your REPL), only to know which apps are connected; `disconnected: true` counts as not there. The accounts themselves are picked when publishing (step 6). Then one block:

1. **The platforms**: a checkbox per short-video app with a connected account ("Instagram Reel", "Instagram Story", "TikTok", "YouTube Short", …), all ticked but the Story. Keep them as platform-zones names them (`reels,story,tiktok,shorts,facebook-reels,spotlight,linkedin`): the captions and the hook keep clear of what those apps lay over the video.
2. **The captions**: radio buttons, none ticked: **Hormozi** (one to three big words in capitals), **Karaoke pill**, **Wipe**, **Clean subtitles** (whole phrases on a soft box, for interviews and explainers), or none. One button sends both (`:send "Platforms and captions: {checked}"`).

With a `brand/DESIGN.md` in your working directory (agentitos' brand-kit), its colour and font go into the captions and the hook: say so, do not ask.

An Instagram Story ticked: read `<skill>/references/instagram-story.md` before step 4 (its stickers need a free band planned into the clips).

### 3. The moments

The length from the platforms ticked in step 2: only Instagram Reels, TikTok and YouTube Shorts (they take up to 3:00): `--max-seconds 100`. Anything else ticked (an Instagram Story takes 60 s): leave it out, the default 59 fits every post type. The channels' own editors cut whole passages of a median 60 s, more than half of them over 59 s; at 100 about a fifth of those came back whole on the nine episodes measured, at 59 almost none, on three other episodes none either way (November 2026).

Never read `sentences.txt` yourself (an hour is some 30,000 tokens that stay in every later step). `node <skill>/tools/episode.mjs moments work/episode [--max-seconds 100]` has a model read it once and prints:

- **what is inside**: claims, stories, numbers, mistakes, how-tos, answers, exchanges (a quick back-and-forth with a laugh). Under four in all, the video is too thin for clips: say so and offer the one or two it gives.
- **the moments**, in the order of the episode: sentence range, time, length, `opens` (how well the first sentence works on someone who has seen nothing, 1–10), kind, title, first line, why it works, the **strongest line** (`payoff`, a sentence of the moment), and a **hook** for the screen (6 words or fewer) where the first line does not hook. Under a moment, what the tool counted where it needs a look: "opens with a question"; "answers the question at sentence N just before it" (read both: start at the question when the moment needs it, at the answer when the answer carries itself; the editors do both); "opens on a conjunction in the middle of a turn" (read the sentence before it: the moment may lean on it); how many voices; by how many seconds it is over the limit. Nothing ranks them: neither the model's order nor `opens` put the editors' own picks ahead of the others (measured on twelve episodes: 0.34–0.56, where 0.5 is chance). So never call one "the strongest" for its place or its `opens`; say why each works, and let the person choose.
- **ideas too spread out to clip**, worth recording anew: one line at the end, never as clips.

Each moment is a whole passage, from its question or first sentence to its last conclusion. One longer than the limit (up to 1.7 times it) comes whole with the sentences an editor would cut marked: `drop` in `moments.json`, and the list gives its length without them. Its clip leaves them out (`"drop"` in `clips.json`, step 4): never shorten such a moment by moving its end.

`work/episode/moments.json` holds it all with the YouTube links. A moment's words: `sed -n '<first+1>,<last+1>p' work/episode/sentences.txt`.

Show the moments as cards (title, time and length — the length without the marked sentences where it has them —, the first line as a quote, why, the hook if any, the link to the moment; example under "UI in the chat") and ask how many, with buttons for the numbers that make sense; they can also name the ones they want.

### 4. The previews beside the chat

Say in one sentence that the previews appear on the right one by one. Make the project once with the `project` tool (create, name `clips`, kind `hyperframes`) and remove its `artifacts/clips/composition/index.html`: without it the project shows every `composition/<name>/` side by side. Write every chosen moment into `work/clips.json` (`<k>` = `01`, `02`, … in the order shown, `<slug>` a short name) and prepare them all at once:

```json
[{"clip": "work/01", "range": "<first>-<last>", "out": "artifacts/clips/composition/01-<slug>", "title": "<title>", "hook": "<hook, or leave it out>", "drop": "<its drop as ranges, e.g. 480-481,490, or leave it out>", "payoff": <its payoff>}, …]
```

```bash
node <skill>/tools/clips.mjs prepare-all work/episode work/clips.json --platform <platforms> [--brand brand/DESIGN.md]
```

(One alone: `clips.mjs prepare work/episode work/<k> <first>-<last> --out … --title … [--hook …] [--drop …] [--payoff …]`.) Each clip's output comes as it finishes: the moment cut and framed 9:16 on whoever speaks (vertical footage stays; B-roll or a photo shown whole over a blurred copy; two speakers one above the other), handed to best-takes ("äh"s marked, pauses over 0.4 s cut with `--pauses tight`, at every jump cut 12 % closer or back out with `--punch on`), `work/<k>/takes/cut.json` one keep of the whole moment (with `drop`: a keep on each side of every stretch left out), the words of the strongest line, and the next command lines with best-takes' path (`<takes>` below). Then, per clip:

1. Look at `work/<k>/framed.sheet.jpg`: per shot (as `prepare` lists them) the footage left, the frame right. What matters must be in the frame: both faces of a photo of two, both people of a split screen, the subject of the B-roll, the speaker. Cut off: `node <skill>/tools/clips.mjs reframe work/<k> --whole <second>` (the second of that shot, as listed); a speaker in a piece shown whole, or two above each other, who should be followed alone: `--follow <second>`. It costs nothing and keeps the edit; never `prepare` again for it.
2. Read `work/<k>/takes/source/brief.md`. Fix misheard names in `cut.json` `"fixes"`; move the start of the keep past a stray "und", "also", "so". The end stays after the moment's last conclusion, not at the payoff. Where marked sentences were left out, read that each cut falls between two thoughts. The moment must still open cold and end clean.
3. `node <takes> build work/<k>/takes`, then `node <takes> captions work/<k>/takes --style <style>` (with `--brand` when there is one), then `node <takes> check work/<k>/takes`: fix every ✗; a ⚠ unless you have a reason.

The opening: where the first line does not carry itself, the strongest line can open the short spoken, as the channels' editors do now and then: put the keep `prepare` printed for it at the top of `cut.json`'s `keep` (the keeps play in their order); it plays again where it was said, take it out there only where hearing it twice drags. Then the short needs no hook card. Do it where the line makes the viewer want the rest (a confession, a number, a punchline that still lands the second time), not where it gives away a story's turn. Else the hook card: the moment's hook where the first line is weak, rewritten when it is a label, none where the first line carries itself. One `*word*` may stand out. Change it with `node <takes> build work/<k>/takes --hook "…"` (`--hook ""` takes it out). It sits at the top of the free box, centred, on the first frame, and stays while the first sentence is said.

Then show the list (title and length per clip) with buttons "They are good" and "Change something", and `[:button {:open "artifacts/clips"} "Show the previews"]`.

### 5. Changes

Read `<skill>/references/changes.md` before you carry out a change the person asks for (start, end, pauses, zoom, hook, caption style, framing, length).

### 6. Render, then publish

After "They are good":

1. Say in one sentence that you render N clips now, about one and a half times their length each.
2. Render all with one command, in the foreground, never with `&` or `nohup`: `node <skill>/tools/clips.mjs render-all work/clips.json work/out` (a clip changed since stays in the list as before). Each is rendered with HyperFrames, brought to −14 LUFS, with subtitles beside it (`work/out/<k>.mp4`, `work/out/<k>.srt`), one after the other: a render already keeps every core busy. One alone: `clips.mjs render work/<k> work/out/<k>.mp4`.
3. Publish with agentitos' **publish-video**, following its SKILL.md for each clip, `<name>` = `clip-<k>`: `check work/out/<k>.mp4 publish/clip-<k>` (short), its `accounts`, the texts with video-descriptions, then `publish`. Ask what the clips share once for all of them: the accounts (those that fit every clip ticked), the style, TikTok's audience and the times (default: one clip a day at 18:00 in the person's time zone, in the order the person chose them). Show the texts of all clips before the person says yes; a ✗ of `check` on one clip is said for that clip and the others go on.

Never call Storrito's schedule procedures yourself: publish-video does it, so that nothing is posted twice.

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only: `div span p ul ol li strong em b i s small h1–h4 a img video button table thead tbody tr th td label input br`. `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/clips"` shows the previews; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the ticked `:value`s. No text fields: a hook or a time they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you go on, none depending on another: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("captions: hormozi"). An answer that leaves a group out is asked again for that group only. One after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- `:class "primary"` on the one button that moves on; the person decides the moments, platforms and plan, so nothing there is marked as recommended.
- Never a token, a path of `work/`, a word number or a raw error in the chat.

The moments:

```hiccup
[:div
 [:p [:small "Inside: 5 claims, 2 stories, 4 numbers, 1 mistake, 3 how-tos"]]
 [:div {:style {:border "1px solid #ddd" :border-radius "12px" :padding "10px 12px"}}
  [:strong "1 · Täglich posten hat uns geschadet"] [:small " · 12:04 · 47 s"]
  [:p [:em "„Jeden Tag zu posten hat diesen Kanal fast umgebracht.“"]]
  [:small "A claim against the usual advice, the number that proves it at the end."] " "
  [:a {:href "https://youtu.be/abc?t=724"} "▶ watch"]]
 [:p "How many should it be?"]
 [:button {:send "Take 4 clips"} "4"] " " [:button {:send "Take all 6 clips"} "All 6"]
 [:p [:small "Or name the ones you want."]]]
```

## Rights

Only material the person may use: when the video is someone else's, say once, before scheduling, that publishing needs the rights holder's permission.
