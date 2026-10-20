---
name: kinetic-lyrics
description: Turn a YouTube episode (podcast, interview, talk) or any clip of people talking into vertical kinetic-typography shorts, every word big as it is said over the speakers' own footage, with effects and the speakers' names; find the moments under a minute that work as shorts, set them up with the person in the chat, render them on the CPU and schedule them on their social accounts through Storrito. Use for Reels, TikTok and YouTube Shorts from podcast or interview videos, lyric videos and podcast audiograms.
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

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change or patch the files in `<skill>`: they are shared by every video. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install                     # node 20+, ffmpeg on the PATH
```

With `OPENROUTER_API_KEY` in the environment, the words and who speaks them come from Gemini 3.5 Transcribe through OpenRouter: nothing else to install. yt-dlp is taken from the PATH or downloaded once by `tools/episode.mjs`. Without the key, transcription runs on this machine and needs Parakeet (`npx hyperframes models install parakeet`), speaker detection `<skill>/.venv` with sherpa-onnx, gap repair `whisper-cli` (see README). When something is missing, say so in one sentence instead of installing it yourself.

## The main use: shorts from a YouTube episode, all in the chat

The person pastes a YouTube link. You find the moments that work as shorts, agree with them on how many, where they go and how they look, show all of them side by side beside the chat, agree on which account gets which short when, and only then render and schedule everything. The conversation happens in the chat, with buttons and pictures you write as hiccup (see "UI in the chat"). The pane beside the chat shows one thing only: the HyperFrames previews of the shorts.

**Keep the pane clean.** Everything you work on lives in `work/` (the episode, the cut clips, the shorts' sources, the videos, the plan). The only artifact is `artifacts/shorts/`, a HyperFrames project that shows every short side by side. Never write anything else into `artifacts/`.

Go through the steps in order; each ends with a question in the chat, and the person's answer starts the next. Keep every message short: one or two sentences and a hiccup block. Speak the person's language. Decide small things yourself and say what you decided.

### 1. The episode

When the link comes, say in one sentence that you are listening to the whole episode now and that it takes a few minutes. Then

```bash
node <skill>/tools/episode.mjs fetch <url> work/episode
```

writes `work/episode/episode.json` (title, channel, length, the voices), `words.json` (every word with its time and speaker) and `sentences.txt`, one numbered sentence a line: `991 [1:06:44–1:06:49] A: Du hast morgens einen Kuchen gebacken …`.

### 2. The moments, and how many

Do not read `sentences.txt` yourself: an hour of talk is some 30,000 tokens, and what you read stays in every later step of this chat and makes each of them slower and dearer. `node <skill>/tools/episode.mjs moments work/episode` has a model read it once (a minute or two, about ten cents an hour) and lists the candidates, best first, each with its sentence range, time, length, title, the first line and why it works, and a score; `work/episode/moments.json` holds them with their YouTube links. Read that list; when you need a candidate's words, `sed -n '<first+1>,<last+1>p' work/episode/sentences.txt` prints just them. Without `OPENROUTER_API_KEY` read `sentences.txt` yourself. The moments it looks for, and you too when you choose among them:

**at most 59 seconds** (it fits every post type Storrito offers, the 60-second stories too), best 25–50. A good moment

- is understandable without the rest of the episode: no "as I said", no unexplained "he" or "that thing";
- opens with a hook in its first sentence (a question, a surprising claim, a vivid image), not with "and", "so", "yeah" or small talk;
- builds to a payoff (a punchline, an insight, a striking number, an emotional turn) and ends right after it;
- is concrete and visual rather than abstract; a host's question followed by the answer is fine;
- is spoken by one voice at a time: in `sentences.txt` a stretch of one- and two-word sentences flipping between voices is people talking at once, which the type can only follow by leaving one of them out. Prefer a moment without it (the list marks one with "crosstalk"), or say on its card that a few seconds are crosstalk.

Keep more than you recommend: roughly one strong moment per 8–10 minutes of episode, at most 10; drop one that the list's title or first line show to be weak. Then show them as cards and recommend a number, with your reason ("the first four are the strongest, the rest are good fillers"). Each card has the title, the time and length, the first line as a quote, why, and a link to that moment on YouTube (`https://youtu.be/<id>?t=<seconds>`). Ask how many it should be, with buttons for your recommendation, all and fewer, and say they can also name the ones they want.

In the same message ask where the shorts go, from what is connected: call `list-social-accounts` of the Storrito connection first. How you reach Storrito's procedures depends on the harness:
- **rragent:** they are functions of your REPL, through the organization's Storrito connector (its key never reaches you): one `eval` with `(storrito/list-social-accounts {})`; `(doc storrito/schedule-instagram-reel)` shows a procedure's input. Nothing to load first, and no `tool_search`.
- **pchat:** they are the tools `mcp__storrito__…`, loaded on demand, and each load makes the model read this whole chat again without its cache, slower and dearer the longer the chat is: load every one you will need now, while the chat is short, in **one answer with two tool_search calls**, `{"query": "returns the current posting status", "limit": 4}` and `{"query": "schedule reel story tiktok post social post list social accounts presigned upload url connect-link", "limit": 8}`. That loads `list-social-accounts`, `create-temp-blob-upload-url`, `create-connect-link`, the four `schedule-…` and the four `status-…` at once; one still missing, load it by its name right away, not at the end.

`list-social-accounts` lists every connected account (Instagram, TikTok, YouTube, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X …) with its `postTypes`: what it takes, the `procedure` that schedules it, `minDurationSeconds` and `maxDurationSeconds`, `maxCaptionLength`, whether the caption is published, its `options`. Show them as checkboxes grouped by platform, one per account and post type that takes a video, labelled "Instagram Reel · @name", "TikTok · name", "YouTube Short · channel"; tick the ones made for shorts (Instagram Reel, TikTok, YouTube Short, Facebook Reel, Snapchat Spotlight) when there are few, and end with a button whose text holds `{checked}` (see "UI in the chat"). An account with `disconnected: true` is shown without a box, with "reconnect it in Storrito". A platform they name that has no account: for Instagram `create-connect-link` makes a link (`[:a {:href …} "Connect Instagram"]`, ask them to say when they are done), for the others they connect it in the Storrito app. Never offer an account the list does not have.

### 3. The look

Ask one thing per message, each with buttons, and offer to take your proposal for everything at once ("Take your suggestions"):

- **The background world.** Over the speakers' footage the dark worlds add their light; the light ones put the footage into a frame on paper or in a studio, with dark type below. Show each as a card with its colours as the card's background, what it fits, and a button. Recommend one by the episode's mood; for most talk a calm one, which moves little and keeps its motifs quiet.

  | world | the card's `:background` | fits |
  | --- | --- | --- |
  | `bokeh` | `radial-gradient(circle at 25% 25%, #ffcf8a 0 8%, transparent 9%), radial-gradient(circle at 70% 35%, #ff9a5a 0 10%, transparent 11%), linear-gradient(#2a1208, #120806)` | people, comedy, health |
  | `noir` | `repeating-linear-gradient(160deg, rgba(255,255,255,.10) 0 9px, transparent 9px 18px), linear-gradient(#0c0c0c, #262626)` | crime, secrets, psychology |
  | `neon` | `repeating-linear-gradient(90deg, rgba(0,240,255,.35) 0 1px, transparent 1px 22px), linear-gradient(170deg, #0b0b2a, #3a0ca3 60%, #f72585)` | tech, sport, speed |
  | `cosmos` | `radial-gradient(ellipse at 40% 35%, #5b2a86, transparent 60%), linear-gradient(#070720, #1b1446)` | big ideas, dreams |
  | `aurora` | `linear-gradient(150deg, #00c9a7, #845ec2 50%, #ff6f91)` | motivation, lifestyle |
  | `editorial` | `linear-gradient(#f3eee2, #e6dfcf)` (dark text on it) | business, education; footage in a frame |
  | `geometry` | `radial-gradient(circle at 30% 35%, #f6b26b 0 12%, transparent 13%), linear-gradient(#f4f4f2, #dcdcd8)` | products, explainers; footage in a frame |
  | `slate` (calm) | `radial-gradient(ellipse at 50% 15%, #2a3242, transparent 65%), linear-gradient(#141922, #07090d)` | news, politics, business, finance |
  | `dusk` (calm) | `linear-gradient(#0d1230, #2a2f6a 45%, #e8a07c 74%, #3a2a40 80%, #0d0a18)` | reflection, relationships, wellbeing |
  | `canopy` (calm) | `radial-gradient(circle at 30% 30%, rgba(232,210,140,.45) 0 5%, transparent 6%), radial-gradient(circle at 65% 55%, rgba(232,210,140,.35) 0 7%, transparent 8%), linear-gradient(160deg, #1d3328, #07100c)` | nature, health, food, sport |
  | `chalk` (calm) | `repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 6px, transparent 6px 14px), linear-gradient(#26343a, #0f1518)` | science, education, explainers |
  | `linen` (calm) | `linear-gradient(115deg, transparent 45%, rgba(255,255,255,.7) 46% 58%, transparent 59%), linear-gradient(#e6e1d8, #d6d0c4)` (dark text on it) | lifestyle, home, family; footage in a frame |
  | `mist` (calm) | `radial-gradient(circle at 30% 30%, #f6d8e4, transparent 55%), radial-gradient(circle at 75% 70%, #d6e4f6, transparent 55%), #f4f2f6` (dark text on it) | coaching, mental health, self-care; footage in a frame |

- **The speakers' names** as they should appear on the name tag: tell who is who with one line each said (A is who speaks first in a short), buttons "No names" and, when the episode's title or description names them, the names you found. They type others.
- **The speakers' colours**: per voice a row of swatches (a button with that colour as its background) and "The world's colours". On the dark worlds light colours: `#7fe3ff #ffb36b #c9a7ff #9dffb0 #ff8fb1 #ffe066`; on the light ones (`editorial`, `geometry`, `linen`, `mist`) dark ones: `#08609c #b0400a #5d33c4 #11703e #ad1452 #7a5c00`. A colour the other kind of world would hide is unreadable: say so if they pick one.
- **The top line**: the show's name (from the channel or the episode title, as a button), "No title", or typed.
- **An end card**: "Follow @<handle>" with the handles of their connected accounts as buttons (step 5 lists them; you may look them up now), or "No end card".

The same look goes for every short unless they ask for one to differ. Format is 9:16 for Reels, TikTok and Shorts; ask only when a platform needs another.

### 4. The previews beside the chat

Say in one sentence that you are preparing the shorts and that the previews appear on the right one by one. Then, for the series once:

```bash
bin/new shorts hyperframes && rm artifacts/shorts/composition/index.html
```

and for every chosen moment `<k>` (`01`, `02`, … in the order you showed them; `<slug>` a short name):

```bash
node <skill>/tools/episode.mjs cut work/episode <first>-<last> work/<k>.mp4
node <skill>/tools/short.mjs new work/<k> work/<k>.mp4
node <skill>/tools/short.mjs brief work/<k>
# read work/<k>/source/brief.md, write work/<k>/source/staging.json (see "Directing a short")
node <skill>/tools/short.mjs build work/<k> --out artifacts/shorts/composition/<k>-<slug> \
  --world … --title "…" --names "A=…,B=…" --colors "A=#…,B=#…" --cta "…" --handle @…
node <skill>/tools/short.mjs check work/<k>
```

Without composition/index.html the project shows every `composition/<name>/` side by side, a player each, titled by the short's hook. Fix the check's errors (✗) before you go on. A short's names follow its own voices (A is who speaks first in that short): map them from the episode's speakers.

Then show the list in the chat (title and length per short) with buttons "They are good" and "Change something", and `[:button {:open "artifacts/shorts"} "Show the previews"]` in case the pane shows something else. For a change, build the short again with the new settings (`short.mjs build work/<k>` keeps the others); for the staging (a word, an effect), change `staging.json` and build again.

### 5. Which account gets which short

The accounts are the ones ticked in step 2. Propose the simple rule first ("every short on all chosen accounts"); a short may go to several accounts. Offer a choice per short only when they want one: per short a row of checkboxes of the chosen accounts and one button.

The limits are Storrito's, from `list-social-accounts`, never from memory: before the plan, hold every short's length (the built composition's duration, the end card included) against `minDurationSeconds` and `maxDurationSeconds` of each post type it goes to. A short that does not fit one of them: say which and why in one sentence and offer to shorten it, or to leave that account out for it.

### 6. When

Propose a plan and show it as a table: per short the date and time, the accounts, and the caption you wrote (the hook, one or two sentences, a few fitting hashtags, in the episode's language). A caption keeps to the shortest `maxCaptionLength` of its post types (X 280, Snapchat Spotlight 160 …) or gets a shorter version for those; post types whose `captionPublished` is false get none; a post type with `captionRequired` must get one. Options of a post type (`options`, e.g. the title and privacy of a YouTube Short) go into the plan too. A good default: one short a day at 18:00 in the person's time zone, the strongest first, the same short on all its accounts at the same time. Buttons: "Take the plan", "One every two days", "All today", "Change the captions", and they can type anything else. Ask for the time zone only when you cannot tell (German speaks for Europe/Berlin). TikTok posts are private unless you set `privacyLevel` to `PUBLIC_TO_EVERYONE`: ask once whether they should be public.

Write the plan into `work/plan.json` as you agree on it: per short its folder, file, caption, and per account its platform, id, procedure, `postType`, time (ISO 8601 with offset) and a UUID made now with `uuidgen` (or `node -e 'console.log(crypto.randomUUID())'`), never with a tool, so that a retry never posts twice.

### 7. Render and schedule

When everything is agreed, show the whole plan once more and ask: "Shall I render all shorts and schedule them?" In the same block ask whether they want a message when everything is done, and how: radio buttons (one `:name`) for "No message" (ticked), E-mail, Slack, Telegram, a push message to the phone (Pushover), SMS and WhatsApp, then the buttons "Render and schedule" (`:send "Render and schedule; tell me when done: {checked}"`) and "Not yet".

A message goes out through Composio: in rragent `composio/search` and `composio/execute` of the REPL (`(doc composio/search)`; without a Composio connector `(connectors)` lists none, then offer no message), in pchat the agent's own connection `mcp__storrito-agent__…`, its tools there from the start. When they chose one, before anything else:

- `COMPOSIO_SEARCH_TOOLS` (rragent: `composio/search`) for the use case ("send an email", "send a Telegram message", …) names the tool and whether the service is connected. Not connected: `COMPOSIO_MANAGE_CONNECTIONS` (rragent: `(composio/connections ["gmail"])`) with the toolkit gives a sign-in link; show it as `[:a {:href …} "Connect Gmail"]` and ask them to say when they are done.
- Ask for what the service needs to reach them and you cannot know: the e-mail address, the phone number, the Slack name. Write it into `work/plan.json` under `notify`.

Only after "Render and schedule" (and, with a message, the connection and the address):

1. Tell them in one or two sentences that you are rendering N shorts now (a few minutes each) and scheduling them, that **they can close this window**, and that everything finishes by itself; the result will be here in the chat, and with a message also there.
2. Render every short: `node <skill>/tools/short.mjs render work/<k> work/out/<k>.mp4`. Never with `&` or `nohup`: a process left running after your turn is no work the machine knows of, it may be paused, and nobody goes on with the uploads when it ends.
   - With `bin/background` (pchat): all of them as one background task, `bin/background 'for k in 01 02 03; do node <skill>/tools/short.mjs render work/$k work/out/$k.mp4 || exit 1; done'`, and end your turn. pchat keeps the machine awake while it runs and writes to you when it has ended; then check the videos and go on with step 3 (a failed render: its log is in the task's folder (`.background/<n>/log`), fix and render that one again).
   - Without it: one short per command, in the foreground, with a timeout of 15 minutes each, all in this turn.
3. Upload it: `create-temp-blob-upload-url` with a new UUID from `uuidgen`, `contentType` `video/mp4` and the file's exact size, then `curl -sS -T work/out/<k>.mp4 -H 'Content-Type: video/mp4' '<uploadUrl>'`. Its `url` is the video for every post of this short (at most 100 MB; a minute is about 45).
4. Per account of the short, the procedure the plan names, with `html` `<insta-story src="<url>"></insta-story>`, the time as `date` and the UUID of the plan: `schedule-instagram-reel` (`instagramUsername`, `caption`, `shareToFeed: true`), `schedule-tiktok-post` (`tiktokAccountId`, `title`, `privacyLevel`), `schedule-social-post` (`socialAccountId`, `postType`, `text`, `name` as the title of a YouTube Short) for the others. Read a procedure's schema before its first use (rragent: `(doc storrito/<name>)`). Note each answer in `work/plan.json`.
5. Check with the status tools that each post is scheduled, then write the result into the chat: a table of short, account, time and status, and the videos as `[:video {:src "…" :controls true}]` only when they ask for them.
6. With a message chosen, send it last, once, in their language: the episode's title, how many shorts are scheduled on which accounts, the first and the last date, what failed if anything, and that the details are in the chat (no tokens, no ids). E-mail with the subject "Your shorts are scheduled" (in their language). If it cannot be sent, say so in the chat; the chat holds the result either way.

If something fails, retry it with the same UUID; if it keeps failing, say which and why in one sentence and go on with the rest.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/shorts"` shows the previews. Links and pictures point at `https://…`, at `artifacts/…` or at `uploads/…` (a file of yours there shows in the chat without taking the pane). An `input` is a checkbox or a radio button (`:type "checkbox"` / `"radio"`, nothing else is shown); `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated, when it is clicked. There are no text fields: for a name or a time they type, so say what to type.

- One question per block, with buttons for the likely answers and a hint that they can type anything else; a choice of several (accounts, shorts) as checkboxes with one button.
- Make a button's text say what happens, and its `:send` text read as the person's answer ("Take 4 shorts", "Colour of Dominik: #ff9a5a").
- Cards: a `div` with `:style {:display "flex" :flex-wrap "wrap" :gap "10px"}` around `div`s with a border, a radius and padding; a swatch is a `button` with `:style {:background "#ffb36b" :width "34px" :height "34px" :border-radius "50%"}`. A button keeps its light look on a dark card; one you give a `:background` with text on it needs a `:color` that reads on it.
- Never put a token, an id the person does not need or a raw error into the chat.

For example, the moments:

```hiccup
[:div
 [:div {:style {:display "flex" :flex-direction "column" :gap "8px"}}
  [:div {:style {:border "1px solid #ddd" :border-radius "12px" :padding "10px 12px"}}
   [:strong "1 · Der verschwundene Kuchen"] [:small " · 1:06:44 · 38 s"]
   [:p [:em "„Du hast morgens einen Kuchen gebacken …“"]]
   [:small "A riddle with a surprising answer, the punchline at the end."] " "
   [:a {:href "https://youtu.be/STqnETZ9kRc?t=4004"} "▶ watch on YouTube"]]]
 [:p "I recommend 4 shorts. How many should it be?"]
 [:button {:send "Take 4 shorts"} "4 (recommended)"] " "
 [:button {:send "Take all 6 shorts"} "All 6"] " "
 [:button {:send "Take only the best 2"} "2"]]
```

and where they go, from `list-social-accounts`:

```hiccup
[:div
 [:p "Where should the shorts go? These accounts are connected to Storrito:"]
 [:strong "Instagram"]
 [:label [:input {:type "checkbox" :value "Instagram Reel @soul.globe" :checked true}] " Reel · @soul.globe"]
 [:label [:input {:type "checkbox" :value "Instagram Story @soul.globe"}] " Story · @soul.globe (60 s at most)"]
 [:strong "TikTok"]
 [:label [:input {:type "checkbox" :value "TikTok storrito.com" :checked true}] " storrito.com"]
 [:strong "YouTube"]
 [:label [:input {:type "checkbox" :value "YouTube Short Audiocado"}] " Short · Audiocado"]
 [:button {:send "Post the shorts on: {checked}"} "Take these accounts"]]
```

## Directing a short

Every short is directed by you, from its brief:

1. `short.mjs new <dir> <clip>` writes down every word with its timing and speaker into `<dir>/source/` (a minute or so).
2. `short.mjs brief <dir>` writes `<dir>/source/brief.md`: the vocabulary of the engine, the rules and the numbered words. Read all of it.
3. Write the staging it asks for into `<dir>/source/staging.json`, all words, one JSON file: the hook (a short headline in the clip's language), the phrases, the words that get an effect and the marks; respell words the recognition clearly misheard under `fixes`, and give a word heard from the wrong voice its speaker there (`{"i": 40, "speaker": "B"}`). Phrases follow the sentences; at fast speech (four words a second and more) longer ones, 5–8 words in two lines, each on screen for 1.5 s or more. Where two voices talk at once, list the interjecting voice's words under `drop` (they are still heard, not shown), so the other reads in whole phrases.
4. `short.mjs build <dir> [--out …]` builds the HyperFrames project; a staging mistake names its field: fix it and build again. Footage wider than the short (a podcast's wide shot) is cut to the frame on whoever speaks, the first build asks Gemini once who sits where (half a minute, a cent).
5. `short.mjs check <dir> [4,15]` lists what a viewer would notice; fix the errors (✗); the warnings (⚠) are mostly words read quickly. A `crosstalk` warning means a run of flashes: drop the interjections there. The seconds named become pictures in `<dir>/stills/<t>.png`.

Settings stay with the short: `--title`, `--subtitle`, `--hook`, `--world`, `--names "A=Anna,B=Ben"`, `--colors "A=#ff5a36"`, `--aspect 9:16` (or `1:1`, `4:5`, `16:9`), `--cta "…" --handle @name`, `--out`. For a change to a word, an effect or a phrase, change the staging and build again; never edit the built files by hand. When a wish needs an effect the brief does not offer, say so in one sentence. The fonts are the engine's own (League Gothic, Instrument Serif).

## A single clip

When the person attaches a clip instead of a link, it is one short: `short.mjs new work/01 uploads/<clip>` and on from step 3 of the main use (the look), with the series of one in `artifacts/shorts/`. A long recording (an episode, a talk, more than a few minutes) is the main use with the file in place of the link: `node <skill>/tools/episode.mjs fetch uploads/<file> work/episode` writes down its words the same way (it needs `OPENROUTER_API_KEY`, a file has no captions), and `cut` cuts the moments from the file.

## Rights

Only material the person may use: when the episode is someone else's, say once, before scheduling, that publishing needs the rights holder's permission.

## Other uses

`tools/build.mjs` takes any word-timed transcript directly, with presets `lyric` (music, big gestures, 16:9), `podcast` and `social` (9:16, hook card, CTA): `node <skill>/tools/build.mjs transcript.json --audio voice.wav --preset lyric|podcast|social [--world …] --out <project>`. Check any built project with `node <skill>/tools/qa.mjs <project>`.

## Rules

- Everything stays deterministic: no `Date.now()`, `Math.random()` or network in compositions.
- Change transcript overrides, the staging or `plan.json` and rebuild; never hand-edit generated `compositions/*.html` or `assets/engine/*`.
- When working on the engine itself (not a video), follow [AGENTS.md](AGENTS.md) for the HyperFrames rules.
