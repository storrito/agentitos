---
name: kinetic-lyrics
description: Turns a YouTube episode or clip of people talking into vertical kinetic-typography shorts (Reels, TikTok, Shorts), rendered and scheduled via Storrito; also lyric videos and audiograms.
license: MIT
metadata:
  title: "Kinetic shorts"
  title-de: "Kinetic Shorts"
  summary: "Shorts from a YouTube episode: the best moments found, every spoken word big on screen, rendered and scheduled on your accounts."
  summary-de: "Shorts aus einer YouTube-Folge: die besten Stellen gefunden, jedes gesprochene Wort groß im Bild, gerendert und auf deinen Konten eingeplant."
  ask: "Paste the link of a YouTube video with people talking (a podcast, an interview, a talk). I find the moments that work as shorts, we set them up together here, and I schedule them on your accounts."
  ask-de: "Füge den Link eines YouTube-Videos ein, in dem Menschen sprechen (Podcast, Interview, Vortrag). Ich finde die Stellen, die als Short funktionieren, wir richten sie hier gemeinsam ein, und ich plane sie auf deinen Konten ein."
  placeholder: "Paste a YouTube link"
  placeholder-de: "YouTube-Link einfügen"
  inputs: "video,audio"
---

# kinetic-lyrics

`<skill>` is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change or patch the files in `<skill>`: they are shared by every video. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install                     # node 20+, ffmpeg on the PATH
```

Beside this skill must be agentitos' `clips` (`tools/episode.mjs` and `tools/frame.mjs` run its tools: the episode, its moments, the framing on whoever speaks), `platform-zones` (the type keeps clear of what the apps lay over the video) and `transcribe`. To publish also `publish-video` (with its `video-descriptions`) and Storrito reachable from its tool: on a Sprite the gateway's Storrito connection, elsewhere `STORRITO_API_URL` and `STORRITO_CREDENTIAL`; without them say so and hand over the videos. What you place yourself (the hook, the call to action, names, footage with a face) follows "Laying out a frame" in `<skill>/../platform-zones/SKILL.md`: text centred on the frame, the hook above the buttons, never text on a face.

The words and who speaks them come from Gemini 3.5 Transcribe through OpenRouter, run by `transcribe`: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`; an rragent agent there often has no key of its own). No model runs on this machine. yt-dlp is taken from the PATH or downloaded once by `tools/episode.mjs`. When OpenRouter or `transcribe` is missing the tools say so in one sentence: pass it on, never install anything yourself.

## The main use: shorts from a YouTube episode, all in the chat

The conversation is in the chat as hiccup (see "UI in the chat"); the pane beside it shows only the HyperFrames previews of the shorts. Render and schedule only after the person agreed on the moments, the look, the previews, and which account gets which short when.

**Keep the pane clean.** Everything you work on lives in `work/` (episode, cut clips, the shorts' sources, videos, plan). The only artifact is `artifacts/shorts/`, a HyperFrames project showing every short side by side. Never write anything else into `artifacts/`.

Go through the steps in order; each ends with a question, and the answer starts the next. Every message: one or two sentences and a hiccup block, in the person's language. Decide small things yourself and say what you decided.

### 1. The episode

Say in one sentence that you are listening to the whole episode now and that it takes a few minutes. Then

```bash
node <skill>/tools/episode.mjs fetch <url> work/episode
```

writes `work/episode/episode.json` (title, channel, length, the voices), `words.json` (every word with time and speaker) and `sentences.txt`, one numbered sentence a line: `991 [1:06:44–1:06:49] A: Du hast morgens einen Kuchen gebacken …`.

### 2. The moments, and how many

Do not read `sentences.txt` yourself (some 30,000 tokens an hour, kept in every later turn). `node <skill>/tools/episode.mjs moments work/episode` has a model read it once (a minute or two, about ten cents an hour) and lists the candidates best first: sentence range, time, length, kind, title, first line, why it works, a score out of 10 (two points each for a cold open, one idea, a clean end, leaning on nothing said before, the length; under 7 it says `weak`), plus what the episode holds and the ideas too spread out to clip. `work/episode/moments.json` holds them with their YouTube links. A moment's screen hook, when it has one, is a good start for `--hook`. For a candidate's words: `sed -n '<first+1>,<last+1>p' work/episode/sentences.txt`. Without OpenRouter read `sentences.txt` yourself.

A moment is **at most 59 seconds** (fits every post type Storrito offers, the 60-second stories too), best 25–50, and: understandable alone (no "as I said", no unexplained "he"); opens with a hook in its first sentence, not "and", "so", "yeah" or small talk; builds to a payoff and ends right after it; concrete rather than abstract (a host's question plus the answer is fine); one voice at a time: a stretch of one- and two-word sentences flipping between voices is crosstalk the type can follow only by leaving one out. Prefer a moment without it (the list marks one "crosstalk"), or say on its card that a few seconds are crosstalk.

Keep roughly one strong moment per 8–10 minutes of episode, at most 10; drop one that its title or first line show to be weak. Show them as cards and say in a sentence how they compare ("the first four are the strongest, the rest are good fillers"). Each card: title, time and length, the first line as a quote, why, and a link to the moment (`https://youtu.be/<id>?t=<seconds>`). Ask how many, with buttons for the numbers that make sense (the strong ones, all, fewer), none marked as recommended, and say they can also name the ones they want.

### 3. Where the shorts go

Ask **one question per message**, each depending on the one before. Checkboxes may come with the likely ones ticked, radio buttons with none; an answer without a choice is asked again; a question with only one possible answer is not asked. First run `node <publish> accounts` (`<publish>` is `<skill>/../publish-video/tools/publish.mjs`, on a Sprite else `/home/sprite/skills/publish-video/tools/publish.mjs`), only to know which apps are connected and their handles; accounts are picked in step 7. A disconnected account counts as not there ("reconnect it in Storrito").

1. **The platforms.** Checkboxes, one per platform and post type that takes a video and has a connected account ("Instagram Reel", "TikTok", "YouTube Short", "Facebook Reel", "Snapchat Spotlight", "LinkedIn video" …), the ones made for shorts ticked, a button whose text holds `{checked}`. No accounts yet. A platform without an account: they connect it in the Storrito app.
2. **One video for all, or adapted?** Radio buttons (one `:name`): "One video for all", "Adapted per platform", "Adapted per account" — only what differs: one platform with one account, no question; one platform, several accounts: "One video for all" or "Adapted per account"; several platforms with one account each: "One video for all" or "Adapted per platform". Say in one line that each adapted video is rendered on its own, so it takes that many times as long.
3. **What is adapted?** Only when they chose to adapt: read `<skill>/references/adapted-shorts.md` before asking it; it also holds the adapted parts of steps 4–7.

Write the answers into `work/plan.json` as `platforms` and `variants` (`"one"`, `"platform"` or `"account"`, and what is adapted).

### 4. The look

One thing per message, each with buttons (tiles or swatches; colours depend on the world), the top line and the end card together in one block, and offer "Take your suggestions" for everything at once:

- **The background world.** Read `<skill>/references/worlds.md` before showing the worlds (what each fits, the colours). Tiles (see "UI in the chat"), each with picture, name, what it fits and a button; copy the stills once, `cp -r <skill>/assets/worlds uploads/`, so `uploads/worlds/<world>.jpg` shows in the chat. You may say which fit the episode's mood, but mark none as recommended.
- **The speakers' names** for the name tag: tell who is who with one line each said (A is who speaks first in a short); buttons "No names" and the names the episode's title or description gives. They type others.
- **The speakers' colours**: per voice a row of swatches in the world's palette (light colours on dark worlds, dark on light ones; see the worlds reference) and "The world's colours". Say so if they pick one the other kind of world would hide.
- **The top line**: the show's name (from channel or episode title, as a button), "No title", or typed.
- **An end card**: "Follow @<handle>" with the handles of the chosen platforms' accounts as buttons, or "No end card".

The same look for every short unless they ask otherwise. Format 9:16 for Reels, TikTok and Shorts; ask only when a platform needs another.

### 5. The previews beside the chat

Say in one sentence that you are preparing the shorts and the previews appear on the right one by one. For the series once:

```bash
bin/new shorts hyperframes && rm artifacts/shorts/composition/index.html
```

and for every chosen moment `<k>` (`01`, `02`, … in the order shown; `<slug>` a short name):

```bash
node <skill>/tools/episode.mjs cut work/episode <first>-<last> work/<k>.mp4
node <skill>/tools/short.mjs new work/<k> work/<k>.mp4
node <skill>/tools/short.mjs brief work/<k>
# read work/<k>/source/brief.md, write work/<k>/source/staging.json (see "Directing a short")
node <skill>/tools/short.mjs build work/<k> --out artifacts/shorts/composition/<k>-<slug> \
  --world … --title "…" --names "A=…,B=…" --colors "A=#…,B=#…" --cta "…" --handle @… --platform <the chosen platforms>
node <skill>/tools/short.mjs check work/<k>
```

An adapted short gets its variants as `<skill>/references/adapted-shorts.md` says.

`--platform` takes platform-zones names, comma-separated (`reels,tiktok,shorts,facebook-reels,spotlight,linkedin`); one video for several platforms keeps clear of all of them; without it the usual platforms of the frame count.

Without `composition/index.html` the project shows every `composition/<name>/` side by side, each titled by its hook. Fix the check's errors (✗) before going on. A short's names follow its own voices (A speaks first in that short): map them from the episode's speakers.

Then show the list (title and length per short) with a button "They are good", `[:button {:open "artifacts/shorts"} "Show the previews ↗"]` in case the pane shows something else, and a line that they can type what to change. For a change, build that short again with the new settings (`short.mjs build work/<k>` keeps the others); for the staging (a word, an effect), change `staging.json` and build again.

### 6. Render

After "They are good", say in one sentence that you are rendering N shorts now, a few minutes each, and that they can close this window: the shorts wait, and publishing goes on when they are back. Render every short (and every variant): `node <skill>/tools/short.mjs render work/<k> work/out/<k>.mp4`. Never with `&` or `nohup`: a process left running after your turn may be paused, and nobody goes on when it ends.

- With `bin/background` (pchat): all as one background task, `bin/background 'for k in 01 02 03; do node <skill>/tools/short.mjs render work/$k work/out/$k.mp4 || exit 1; done'`, then end your turn; pchat writes to you when it ends (a failed render's log: `.background/<n>/log`; fix and render that one again).
- Without it: one short per command, in the foreground, timeout 15 minutes each, all in this turn.

### 7. Publish with publish-video

Follow publish-video's SKILL.md for each short, `<name>` = `short-<k>` (a variant `short-<k>-<v>`): `check work/out/<k>.mp4 publish/short-<k> --mode short --platforms <the chosen platforms>`, its `accounts`, the texts with video-descriptions (in the episode's language, the hook first), then `publish`. publish-video holds every limit (length, caption, a YouTube Short's title, privacy and "made for kids", TikTok's audience) and posts nothing twice.

Ask what the shorts share **once for all of them**: the accounts (`accounts publish/short-01 --hiccup`, with pictures and last time's choices ticked; say in a line when an account does not take every short; an adapted short goes only to its platform or account), the style of the texts, TikTok's audience, a YouTube Short's visibility, and the times. Default times: one short a day at 18:00 in the person's time zone, strongest first, the same short on all its accounts at the same time; also offer "One every two days" and "All today". Show the texts of all shorts (video-descriptions' overview, "Show the texts of short 1 ↗" …) before their yes; a ✗ of `check` on one short is said for that short and the others go on.

At the end one table in the chat: short, account, time and status (`status publish/short-<k>`).

When the episode is someone else's, say once, before publishing, that it needs the rights holder's permission.

## An Instagram Story

When one of the targets is an Instagram Story, read `<skill>/references/instagram-story.md` before asking about stickers or building that short.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/shorts"` shows the previews. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…` (a file of yours there shows in the chat without taking the pane). An `input` is a checkbox or radio button (`:type "checkbox"` / `"radio"`, nothing else is shown); `{checked}` in a button's `:send` becomes the ticked `:value`s of the same block, comma-separated. No text fields: for a name or a time they type, so say what to type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"). An answer that leaves a group out is asked again for that group only. One after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- In the main use, from the link to publishing, the person decides: no option marked "(recommended)", radio buttons with none ticked. Elsewhere use your judgment.
- A button's text says what happens; its `:send` reads as the person's answer ("Take 4 shorts", "Colour of Dominik: #ff9a5a").
- `:class "primary"` only on the one button that sends the block's ticked choices or starts the work ("Take these platforms", "They are good"); alternative answers stay plain.
- A button only where a click makes you act at once; none that only leads to another question ("Change something"): they type what to change, and a line under the buttons says so. A button that opens an artifact ends with " ↗".
- Tiles, for a choice of looks: a grid, `:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(150px, 1fr))" :gap "8px"}`, of tiles each `:style {:display "flex" :flex-direction "column" :gap "4px" :border "1px solid rgba(127,127,127,.35)" :border-radius "10px" :padding "8px"}`: the picture first (`[:img {:src "uploads/worlds/slate.jpg" :style {:width "100%" :aspect-ratio "3 / 4" :object-fit "cover" :border-radius "6px"}}]`), the name in `strong`, what it fits in `small`, the button last. Text stays on the page's background, never on a picture or a colour.
- A swatch is a `button` with `:style {:background "#ffb36b" :width "34px" :height "34px" :border-radius "50%"}`.
- Never put a token, a working path, an id the person does not need or a raw error into the chat.

The moments:

```hiccup
[:div
 [:div {:style {:display "flex" :flex-direction "column" :gap "8px"}}
  [:div {:style {:border "1px solid #ddd" :border-radius "12px" :padding "10px 12px"}}
   [:strong "1 · Der verschwundene Kuchen"] [:small " · 1:06:44 · 38 s"]
   [:p [:em "„Du hast morgens einen Kuchen gebacken …“"]]
   [:small "A riddle with a surprising answer, the punchline at the end."] " "
   [:a {:href "https://youtu.be/STqnETZ9kRc?t=4004"} "▶ watch on YouTube"]]]
 [:p "The first four are the strongest. How many should it be?"]
 [:button {:send "Take 4 shorts"} "4"] " "
 [:button {:send "Take all 6 shorts"} "All 6"] " "
 [:button {:send "Take only the best 2"} "2"]]
```

The platforms, from publish-video's `accounts`:

```hiccup
[:div
 [:p "On which platforms should the shorts appear? These are connected to Storrito:"]
 [:label [:input {:type "checkbox" :value "Instagram Reel" :checked true}] " Instagram Reel"]
 [:label [:input {:type "checkbox" :value "TikTok" :checked true}] " TikTok"]
 [:label [:input {:type "checkbox" :value "YouTube Short" :checked true}] " YouTube Short"]
 [:label [:input {:type "checkbox" :value "LinkedIn video"}] " LinkedIn video"]
 [:button {:class "primary" :send "The shorts go to: {checked}"} "Take these platforms"]]
```

One video or adapted, none ticked:

```hiccup
[:div
 [:p "One video for all platforms, or adapted to each? Adapted means one video per platform, rendered each on its own."]
 [:label [:input {:type "radio" :name "variants" :value "one video for all"}] " One video for all"]
 [:label [:input {:type "radio" :name "variants" :value "adapted per platform"}] " Adapted per platform"]
 [:button {:class "primary" :send "Make it {checked}"} "Go on"]]
```

## Directing a short

1. `short.mjs new <dir> <clip>` writes every word with timing and speaker into `<dir>/source/` (a minute or so).
2. `short.mjs brief <dir>` writes `<dir>/source/brief.md`: the engine's vocabulary, the rules and the numbered words. Read all of it.
3. Write the staging it asks for into `<dir>/source/staging.json`, all words, one JSON file: the hook (a short headline in the clip's language), the phrases, the words with an effect, the marks. Respell clearly misheard words under `fixes`, and give a word heard from the wrong voice its speaker there (`{"i": 40, "speaker": "B"}`). Phrases follow the sentences; at fast speech (four words a second and more) longer ones, 5–8 words in two lines, each on screen 1.5 s or more. Where two voices talk at once, list the interjecting voice's words under `drop` (still heard, not shown).
4. `short.mjs build <dir> [--out …]` builds the HyperFrames project; a staging mistake names its field: fix it and build again. Footage wider than the short (a podcast's wide shot) is cut to the frame on whoever speaks; the first build asks Gemini once who sits where (half a minute, a cent).
5. `short.mjs check <dir> [4,15]` lists what a viewer would notice; fix the errors (✗); the warnings (⚠) are mostly words read quickly. A `crosstalk` warning means a run of flashes: drop the interjections there. The seconds named become pictures in `<dir>/stills/<t>.png`.

Settings stay with the short: `--title`, `--subtitle`, `--hook`, `--world`, `--names "A=Anna,B=Ben"`, `--colors "A=#ff5a36"`, `--aspect 9:16` (or `1:1`, `4:5`, `16:9`), `--cta "…" --handle @name`, `--out`. When a wish needs an effect the brief does not offer, say so in one sentence. The fonts are the engine's own (League Gothic, Instrument Serif).

## A single clip

A clip attached instead of a link is one short: `short.mjs new work/01 uploads/<clip>`, then on from step 4 of the main use, with the series of one in `artifacts/shorts/`. A long recording (more than a few minutes) is the main use with the file in place of the link: `node <skill>/tools/episode.mjs fetch uploads/<file> work/episode` (needs OpenRouter, a file has no captions), and `cut` cuts the moments from it.

## Other uses

For lyric videos, audiograms or any word-timed transcript without the episode flow, read `<skill>/references/other-uses.md` before building (`tools/build.mjs`, `tools/qa.mjs`).

## Rules

- Deterministic: no `Date.now()`, `Math.random()` or network in compositions.
- Change transcript overrides, the staging or `plan.json` and rebuild; never hand-edit generated `compositions/*.html`, `assets/engine/*` or any built file.
- Publishing goes through publish-video only; never call Storrito's schedule procedures yourself.
- When working on the engine itself (not a video), follow [AGENTS.md](AGENTS.md) for the HyperFrames rules.
