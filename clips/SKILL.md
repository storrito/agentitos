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

Node 20+, ffmpeg, the HyperFrames CLI, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`). agentitos' `best-takes`, `captions`, `layout`, `platform-zones`, `transcribe`, for b-roll `b-roll`, and, for publishing, `publish-video` (with its `video-descriptions`) beside this one. Without OpenRouter nothing can be cut: say so. yt-dlp comes from the PATH or is downloaded once. When something is missing, say so in one sentence; never install it.

Costs: the episode's words about 22 cents an hour, twice that when the voices need the transcription's long requests; its names one model call more, a cent or two an episode (1.2 to 1.4 cents for 23 minutes, 2 for 53, November 2026; `fetch … --no-names` skips it, and the words, the moments and the captions then keep the speech model's spellings, which you fix in each clip's `cut.json` `"fixes"` by hand); the moments 5 to 9 cents an hour (measured on twelve episodes, November 2026); per clip three to seven cents to frame it (the stills of every shot and their eyes, nose and mouth) and well under a cent for its words and captions.

## From the long video to scheduled shorts, all in the chat

Each step ends with a question; the answer starts the next. Every message one or two sentences and a hiccup block, in the person's language. Decide small things yourself and say what you decided. Everything you work on lives in `work/`; the only artifact is `artifacts/clips/`, a HyperFrames project showing every clip side by side.

### 1. The video

Say in one sentence that you listen to the whole video now and that it takes a few minutes. Then `node <skill>/tools/episode.mjs fetch <url or uploads/<file>> work/episode`: it writes `work/episode/episode.json` (title, channel, length, the voices), `words.json` (every word with time and speaker) and `sentences.txt` (one numbered sentence a line).

It ends with the names: the speech model writes what it hears ("Reed" for Reade, "Werewolf" for the film Werwulf), and the video's page (title, description, chapters, tags, its own captions) spells them right. Each entry of the list is **one place**: one spelling in one sentence, shown with its time and sentence, and it changes only that place. **Applied** entries are in the words already (the model pointed to that place, the page writes the name, only the spelling differs). **Proposed** entries are never applied by the tool, whatever you do not take stays as the speech model wrote it; each says why it is not sure: the model's knowledge (a name the page does not write), sounds less alike, an ordinary word, only the case, the same spelling as a place the model pointed to but not pointed to here (often another person: "Lou Reed" beside "Walker Reed"). **Refused** entries are never applied (a word left out or added, an ending, another sound, a name already right, part of a longer name). Before the moments, read every proposed entry's sentence and decide: take it with `node <skill>/tools/episode.mjs names work/episode --take <n>,…` only where the sentence shows that this name was said there (a place, a company, a person the talk is about); one called an ordinary word only where the sentence makes no sense with that word; one that changes a spelling the transcript writes elsewhere (Keilmann four times, Kalmann twice) only with the page or the person behind it; leave the rest, which needs no command. `--leave <n>` takes an applied one back. The numbers are those of the list you read; a number in both is an error. After a clip is prepared, a `--take` or `--leave` reaches it only with `node <skill>/tools/clips.mjs names work/<k>` (no cost), then build it again. Names the person gives you (their guest, their product; for an upload, which has no page) go in with `--also "Name, Name"` (the model reads again; what you took stays taken). Tell the person in one sentence which names you corrected. The words as written stay in `words.raw.json`; the moments, the clips' captions and subtitles and every text written from the words take the names from here.

### 2. Where they go, and the look

Ask this before the moments: the platforms set how long a moment may be. First `list-social-accounts` of the Storrito connection (rragent: `(storrito/list-social-accounts {})` in your REPL), only to know which apps are connected; `disconnected: true` counts as not there. The accounts themselves are picked when publishing (step 6). Then one block:

1. **The platforms**: a checkbox per short-video app with a connected account ("Instagram Reel", "Instagram Story", "TikTok", "YouTube Short", …), all ticked but the Story. Keep them as platform-zones names them (`reels,story,tiktok,shorts,facebook-reels,spotlight,linkedin`): the captions and the hook keep clear of what those apps lay over the video.
2. **The captions**: radio buttons, none ticked: **Bold words** (two or three bold words, white, nothing behind them: what most podcast clips carry), **Impact** (tall narrow capitals, a caption that holds a key word in lime: the look of sports and podcast clips), **Hormozi** (one to three big words in capitals, the word being said in colour), **Karaoke pill**, **Wipe**, **Clean subtitles** (whole phrases on a soft box, for interviews and explainers), or none. One button sends both (`:send "Platforms and captions: {checked}"`). As `--style` they are `bold`, `impact`, `hormozi`, `karaoke`, `wipe`, `clean`; a person who names another look gets it from captions' other styles (`outline` heavy with a black outline, `single` one word at a time, `fill` words that fill as they are said, `label` a white box a line, `editorial` key words in a serif italic, `subtitle` phrases without a box).

With a `brand/DESIGN.md` in your working directory (agentitos' brand-kit), its colour and font go into the captions and the hook: say so, do not ask.

An Instagram Story ticked: read `<skill>/references/instagram-story.md` before step 4 (its stickers need a free band planned into the clips).

### 3. The moments

The length: the default 59 s fits every post type (an Instagram Story takes 60 s). Run `--max-seconds 100` only when the person wants longer clips, or when a moment they picked is still over the limit without its marked sentences, and only when every platform ticked in step 2 takes it (Instagram Reels, TikTok and YouTube Shorts take up to 3:00): a higher limit is a trade: long passages come back whole more often, short ones with more around them (on the nine tuning episodes at 100 s 3.7 of 15 long picks whole instead of 0.3, but 3.7 of 12 short ones instead of 7.0). Say that in one sentence when you raise it; never raise it only because the platforms would allow it.

Never read `sentences.txt` yourself (an hour is some 30,000 tokens that stay in every later step). `node <skill>/tools/episode.mjs moments work/episode [--max-seconds 100]` has a model read it once and prints:

- **what is inside**: claims, stories, numbers, mistakes, how-tos, answers, exchanges (a quick back-and-forth with a laugh). Under four in all, the video is too thin for clips: say so and offer the one or two it gives.
- **the moments**, in the order of the episode: sentence range, time, length, `opens` (how well the first sentence works on someone who has seen nothing, 1–10), kind, title, first line, why it works, the **strongest line** (`payoff`, a sentence of the moment), and a **hook** for the screen (6 words or fewer) where the first line does not hook. Under a moment, what the tool counted where it needs a look: "opens with a question"; "answers the question at sentence N just before it" (read both: start at the question when the moment needs it, at the answer when the answer carries itself; the editors do both); "opens on a conjunction in the middle of a turn" (read the sentence before it: the moment may lean on it); how many voices; by how many seconds it is over the limit. Nothing ranks them: neither the model's order nor `opens` put the editors' own picks ahead of the others (measured on twelve episodes: 0.34–0.56 of the pairs, where 0.5 is chance). So never call one "the strongest" for its place or its `opens`; say why each works, and let the person choose.
- **ideas too spread out to clip**, worth recording anew: one line at the end, never as clips.

Each moment is a whole passage, from its question or first sentence to its last conclusion. One longer than the limit (up to 1.7 times it) comes whole with the sentences an editor would cut marked: `drop` in `moments.json`, and the list gives its length without them. Its clip leaves them out (`"drop"` in `clips.json`, step 4): never shorten such a moment by moving its end. One still over the limit without them (the list says "still … s over"), or whose marked sentences stay because another voice speaks over them: drop more of it, or offer another moment; where the person wants that passage and every platform ticked takes it, run `moments` again with `--max-seconds 100` (the trade above); never one over the limit. `prepare` takes the limit from `moments.json` (`--max-seconds` to give another), says when a clip is still over it, and best-takes' `check` warns while the cut, its opening included, is longer: that ⚠ is never left standing.

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

(One alone: `clips.mjs prepare work/episode work/<k> <first>-<last> --out … --title … [--hook …] [--drop …] [--payoff …]`.) Each clip's output comes as it finishes: the moment cut and framed 9:16 on whoever speaks (vertical footage stays; B-roll or a photo shown whole over a blurred copy; two speakers one above the other), the text placed over it (below), handed to best-takes ("äh"s marked, pauses over 0.4 s cut with `--pauses tight`, at every jump cut 12 % closer or back out with `--punch on`), `work/<k>/takes/cut.json` one keep of the whole moment (with `drop`: a keep on each side of every stretch left out), the words of the strongest line, and the next command lines with best-takes' path (`<takes>` below). Then, per clip:

1. Look at `work/<k>/framed.sheet.jpg` (`framed.sheet-2.jpg`, … from the ninth shot): a row per shot as `prepare` lists them, the footage with the window in yellow, then the frame at the shot's first, middle and last frame. A ⚠ in the listing and a red frame on the sheet: the tool's own check found the eyes, nose or mouth of a face (of a small face: the face) cut by the frame's edge or close to it, at that time; look at that row first. A line with · instead names only an ear, a cheek or hair at the edge of a close-up: the editors' way, nothing to do. A ⚠ on a speaker the window already follows has no better window in this footage: keep it, or move the cut so that stretch is left out; a ⚠ that the model put a face somewhere the frames do not lead: that still was left out, look whether the window is right there; a ⚠ that the model's eyes, nose and mouth of a face do not hold at some seconds: those stills were left out (where none holds, the head's proportions stand in), look at those rows whether the window and the face's middle are right. What matters must be in the frame: both faces of a photo of two, both people of a split screen, the subject of the B-roll, the speaker. Someone or something that matters left out of the window (a second person, the subject of a photo): `node <skill>/tools/clips.mjs reframe work/<k> --whole <second>` (the second of that shot, as listed; it shows the shot smaller, so never for a close-up); a speaker in a piece shown whole, or two above each other, who should be followed alone: `--follow <second>`. A wide shot of the room is cut to whoever speaks, as the channels' editors do (shown whole, a face there is a few percent of the frame's height); a picture of material (slides, a screen, a product) with the speaker small beside it stays whole. Where the tool could not tell, it shows the shot whole and says so in the list: `--follow <second>` cuts it to the speaker. It costs nothing and keeps the edit; never `prepare` again for it. A moment `prepare` says is too long: leave sentences out in `cut.json` before you build.
2. Look at `work/<k>/placed.sheet.jpg`: where the text goes, from agentitos' layout and every face of every shot over time. One place for the captions in the whole clip (a caption that jumps from shot to shot reads badly; published Shorts keep theirs in one place), one line of about three words (two for a style of whole phrases), below the chins; a shot whose chin would reach into them is **raised** while its whole head stays in the picture (its window lower in the footage where it can, else the picture higher over a blurred band at the bottom, under the apps' bars), every return of the same close-up at the same height; where that leaves no room (a tight close-up) the captions lie on the chin or the lower lip, smaller type first, never on the mouth: a shot goes up past its head's top before they would cover it. The list names the part and its seconds; "on the lower lip … not avoidable at a readable size" and "on the hair" are nothing to fix. The hook goes where it clears every face over its seconds: a short text below the chin or above the head, else a card at the top, a card also where the picture behind it is not a close-up; it ends at a cut when the next shot leaves it no place. Per row: the shot's first, middle and last frame, the captions yellow, the hook cyan, the faces red. A `✗` line is text on the mouth, the nose or the eyes, or a group of captions set below the floor, and says what would avoid it: fix it. How far a close-up may go up is `--raise head|mouth|full`: `mouth` (the default) cuts the hair of a tight close-up to keep the captions off the mouth, but never lifts the eyes above 27 % of the height (where they stand at the highest in published Shorts) and lets the captions lie on the lower lip beyond that, `head` keeps every head whole and lets small captions lie on the chin and lower lip, `full` clears the chin at the price of the forehead, up to the apps' top bar; the list says per shot how far the frame cuts the head (px, seconds, how much of it the raise adds). Take `head` when the person says the head or hair must stay (a look, a hat, a product on the head) or the band at the bottom shows, `full` only when they want the chin clear; else keep `mouth`. Yours to change, each kept for the next run: `node <skill>/tools/clips.mjs place work/<k> --raise head|mouth|full`, `--lift <second>:<px>` (a shot raised more, less, `0` not at all), `--caption-y <px>` (where the captions' area ends, the safe box's bottom at most) and `--font-size <px>`, `--lines 1|2`, `--hook text|card`; `""` gives one back to the tool. Read `<skill>/references/text.md` before you change one.
3. Read `work/<k>/takes/source/brief.md`. `prepare` put the episode's corrected names into `cut.json` `"fixes"` and named any place where the clip heard something else there; fix those and other misheard names in `"fixes"`; move the start of the keep past a stray "und", "also", "so". The end stays after the moment's last conclusion, not at the payoff. Where marked sentences were left out, read that each cut falls between two thoughts. The moment must still open cold and end clean.
4. `node <takes> build work/<k>/takes`, then `node <takes> captions work/<k>/takes --style <style>` (with `--brand` when there is one), then `node <skill>/tools/clips.mjs place work/<k>` (the hook's seconds are now the cut's, the area the style's; it builds again), then `node <takes> check work/<k>/takes`: fix every ✗; a ⚠ unless you have a reason. The check names text that lies on a face with the part and its seconds, as `place` does. A long word set below the floor: a soft hyphen (`\u00ad`) where it may break into its text in `cut.json` `"fixes"`, then `place … --lines 2`. After a change of the cut's start, an opening keep put at the top, a `reframe`, another hook or another caption style: `place` again (a line heard twice gets its text placed like any other stretch).

The opening: where the first line does not carry itself, the strongest line can open the short spoken, as the channels' editors do now and then: put the keep `prepare` printed for it at the top of `cut.json`'s `keep` (it prints none for a line that is the first sentence, takes over 10 s, or would bring the short over the limit) (the keeps play in their order; its `"again": true` lets best-takes play the line where it was said too, which it otherwise refuses); a line that begins on "and" can start a word later only where the brief shows that word heard on its own (an "and I" is often one sound: past the "and" the "I" is gone, its caption stays). Take it out where it was said only where hearing it twice drags. Then the short needs no hook card: build with `--hook ""`. Do it where the line makes the viewer want the rest (a confession, a number, a punchline that still lands the second time), not where it gives away a story's turn. Else the hook card: the moment's hook where the first line is weak, rewritten when it is a label, none where the first line carries itself. One `*word*` may stand out. Change it with `node <takes> build work/<k>/takes --hook "…"` (`--hook ""` takes it out), then `place`. It shows on the first frame, where `place` put it, and stays while the first sentence is said.

Then show the list (title and length per clip) with a button "They are good", `[:button {:open "artifacts/clips"} "Show the previews ↗"]`, and a line that they can type what to change.

### 5. Changes

Read `<skill>/references/changes.md` before you carry out a change the person asks for (start, end, pauses, zoom, hook, caption style, framing, length).

### 6. Render, then publish

After "They are good":

1. Say in one sentence that you render N clips now, about one and a half times their length each.
2. Render all with one command, in the foreground, never with `&` or `nohup`: `node <skill>/tools/clips.mjs render-all work/clips.json work/out` (a clip changed since stays in the list as before). Each is rendered with HyperFrames, brought to −14 LUFS, with subtitles beside it (`work/out/<k>.mp4`, `work/out/<k>.srt`), one after the other: a render already keeps every core busy. One alone: `clips.mjs render work/<k> work/out/<k>.mp4`.
3. Publish with agentitos' **publish-video**, following its SKILL.md for each clip, `<name>` = `clip-<k>`: `check work/out/<k>.mp4 publish/clip-<k>` (short), its `accounts`, the texts with video-descriptions, then `publish`. Ask what the clips share once for all of them: the accounts (those that fit every clip ticked), the style, TikTok's audience and the times (default: one clip a day at 18:00 in the person's time zone, in the order the person chose them). Show the texts of all clips before the person says yes; a ✗ of `check` on one clip is said for that clip and the others go on.

Never call Storrito's schedule procedures yourself: publish-video does it, so that nothing is posted twice.

## B-roll

A clip whose words name something that can be shown (a product, a page, a post, a number) can get b-roll: offer it once for the clips that have such moments, when the person agreed to them, naming the moments in a sentence. Then follow agentitos' **b-roll** skill (`<skill>/../b-roll/SKILL.md`, on a Sprite else `/home/sprite/skills/b-roll/SKILL.md`), "For another skill", on `work/<k>/takes` (its `edit.json`, `takes.mjs broll work/<k>/takes …`), clip by clip; the moments of a podcast need little of it. A beat on a word of a spoken opening (a keep with `"again"`) sits where that word is said later: b-roll finds a word number at its last place, so the opening gets none.

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only: `div span p ul ol li strong em b i s small h1–h4 a img video button table thead tbody tr th td label input br`. `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/clips"` shows the previews; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the ticked `:value`s. No text fields: a hook or a time they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you go on, none depending on another: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("captions: hormozi"). An answer that leaves a group out is asked again for that group only. One after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- A button only where a click makes you act at once. Never one that only leads to your next question ("Change something"): they type what to change.
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
