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

With OpenRouter (`OPENROUTER_API_KEY` in the environment, or, on a Sprite, the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`; an rragent agent there often has no key of its own)), the words and who speaks them come from Gemini 3.5 Transcribe through OpenRouter: nothing else to install. yt-dlp is taken from the PATH or downloaded once by `tools/episode.mjs`. Without OpenRouter, transcription runs on this machine and needs Parakeet (`npx hyperframes models install parakeet`), speaker detection `<skill>/.venv` with sherpa-onnx, gap repair `whisper-cli` (see README). When something is missing, say so in one sentence instead of installing it yourself.

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

Do not read `sentences.txt` yourself: an hour of talk is some 30,000 tokens, and what you read stays in every later step of this chat and makes each of them slower and dearer. `node <skill>/tools/episode.mjs moments work/episode` has a model read it once (a minute or two, about ten cents an hour) and lists the candidates, best first, each with its sentence range, time, length, title, the first line and why it works, and a score; `work/episode/moments.json` holds them with their YouTube links. Read that list; when you need a candidate's words, `sed -n '<first+1>,<last+1>p' work/episode/sentences.txt` prints just them. Without OpenRouter read `sentences.txt` yourself. The moments it looks for, and you too when you choose among them:

**at most 59 seconds** (it fits every post type Storrito offers, the 60-second stories too), best 25–50. A good moment

- is understandable without the rest of the episode: no "as I said", no unexplained "he" or "that thing";
- opens with a hook in its first sentence (a question, a surprising claim, a vivid image), not with "and", "so", "yeah" or small talk;
- builds to a payoff (a punchline, an insight, a striking number, an emotional turn) and ends right after it;
- is concrete and visual rather than abstract; a host's question followed by the answer is fine;
- is spoken by one voice at a time: in `sentences.txt` a stretch of one- and two-word sentences flipping between voices is people talking at once, which the type can only follow by leaving one of them out. Prefer a moment without it (the list marks one with "crosstalk"), or say on its card that a few seconds are crosstalk.

Keep more than the strongest: roughly one strong moment per 8–10 minutes of episode, at most 10; drop one that the list's title or first line show to be weak. Then show them as cards and say in a sentence how they compare ("the first four are the strongest, the rest are good fillers"). Each card has the title, the time and length, the first line as a quote, why, and a link to that moment on YouTube (`https://youtu.be/<id>?t=<seconds>`). Ask how many it should be, with buttons for the numbers that make sense (the strong ones, all, fewer), none marked as recommended, and say they can also name the ones they want.

### 3. Where the shorts go

Once they chose the moments, ask where the shorts go, **one question per message**; checkboxes may come with the likely ones ticked, radio buttons with none (the person decides), and an answer that comes without a choice is asked again; a question with only one possible answer is not asked. First call `list-social-accounts` of the Storrito connection. How you reach Storrito's procedures depends on the harness:
- **rragent:** they are functions of your REPL, through the organization's Storrito connector (its key never reaches you): one `eval` with `(storrito/list-social-accounts {})`; `(doc storrito/schedule-instagram-reel)` shows a procedure's input. Nothing to load first, and no `tool_search`.
- **pchat:** they are the tools `mcp__storrito__…`, loaded on demand, and each load makes the model read this whole chat again without its cache, slower and dearer the longer the chat is: load every one you will need now, while the chat is short, in **one answer with two tool_search calls**, `{"query": "returns the current posting status", "limit": 4}` and `{"query": "schedule reel story tiktok post social post list social accounts presigned upload url connect-link", "limit": 8}`. That loads `list-social-accounts`, `create-temp-blob-upload-url`, `create-connect-link`, the four `schedule-…` and the four `status-…` at once; one still missing, load it by its name right away, not at the end.

`list-social-accounts` lists every connected account (Instagram, TikTok, YouTube, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X …) with its `postTypes`: what it takes, the `procedure` that schedules it, `minDurationSeconds` and `maxDurationSeconds`, `maxCaptionLength`, whether the caption is published, its `options`. An account with `disconnected: true` counts as not there ("reconnect it in Storrito"). Never offer what the list does not have.

1. **The platforms.** Checkboxes, one per platform and post type that takes a video and has a connected account, labelled "Instagram Reel", "TikTok", "YouTube Short", "Facebook Reel", "Snapchat Spotlight", "LinkedIn video" …; the ones made for shorts ticked; a button whose text holds `{checked}` (see "UI in the chat"). No accounts yet. A platform they name that has no account: for Instagram `create-connect-link` makes a link (`[:a {:href …} "Connect Instagram"]`, ask them to say when they are done), for the others they connect it in the Storrito app.
2. **One video for all, or adapted?** Radio buttons (one `:name`): "One video for all", "Adapted per platform", "Adapted per account". Offer only what differs: one platform with one account, no question; one platform with several accounts, "One video for all" or "Adapted per account"; several platforms with one account each, "One video for all" or "Adapted per platform". An adapted short is one video per platform or account, each rendered on its own, so it takes that many times as long: say so in one line.
3. **What is adapted?** Only when they chose to adapt: checkboxes "Hook and wording" (the top line and the hook in the platform's tone) and "End card" (the account's handle, the platform's call to action: "Follow" on Instagram and TikTok, "Subscribe" on YouTube). The language of the words on screen stays the language spoken.

Write the answers into `work/plan.json` as `platforms` and `variants` (`"one"`, `"platform"` or `"account"`, and what is adapted).

### 4. The look

Ask one thing per message, each with buttons, and offer to take your proposal for everything at once ("Take your suggestions"):

- **The background world.** Over the speakers' footage the dark worlds add their light; the light ones put the footage into a frame on paper or in a studio, with dark type below. Show them as tiles (see "UI in the chat"), each with its picture, its name, what it fits and a button. The pictures are stills of each world, `<skill>/assets/worlds/<world>.jpg`: copy the folder once to your uploads (`cp -r <skill>/assets/worlds uploads/`), so that `uploads/worlds/<world>.jpg` shows in the chat. You may say in a sentence which fit the episode's mood (for most talk a calm one, which moves little and keeps its motifs quiet), but mark none as recommended.

  | world | fits |
  | --- | --- |
  | `bokeh` | people, comedy, health |
  | `noir` | crime, secrets, psychology |
  | `neon` | tech, sport, speed |
  | `cosmos` | big ideas, dreams |
  | `aurora` | motivation, lifestyle |
  | `editorial` (light) | business, education; footage in a frame |
  | `geometry` (light) | products, explainers; footage in a frame |
  | `slate` (calm) | news, politics, business, finance |
  | `dusk` (calm) | reflection, relationships, wellbeing |
  | `canopy` (calm) | nature, health, food, sport |
  | `chalk` (calm) | science, education, explainers |
  | `linen` (calm, light) | lifestyle, home, family; footage in a frame |
  | `mist` (calm, light) | coaching, mental health, self-care; footage in a frame |

- **The speakers' names** as they should appear on the name tag: tell who is who with one line each said (A is who speaks first in a short), buttons "No names" and, when the episode's title or description names them, the names you found. They type others.
- **The speakers' colours**: per voice a row of swatches (a button with that colour as its background) and "The world's colours". On the dark worlds light colours: `#7fe3ff #ffb36b #c9a7ff #9dffb0 #ff8fb1 #ffe066`; on the light ones (`editorial`, `geometry`, `linen`, `mist`) dark ones: `#08609c #b0400a #5d33c4 #11703e #ad1452 #7a5c00`. A colour the other kind of world would hide is unreadable: say so if they pick one.
- **The top line**: the show's name (from the channel or the episode title, as a button), "No title", or typed.
- **An end card**: "Follow @<handle>" with the handles of the accounts of the chosen platforms as buttons, or "No end card". With the end card adapted (step 3), propose per platform or account its call to action and handle in one table and ask once.
- **Hook and wording**, only when adapted: per platform (or account) the top line and the hook in its tone, proposed in one table, "Take these" or they change one.

The same look goes for every short unless they ask for one to differ; an adapted variant differs only in what step 3 adapts. Format is 9:16 for Reels, TikTok and Shorts; ask only when a platform needs another.

### 5. The previews beside the chat

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

An adapted short has a variant per platform or account `<v>` (`ig`, `tiktok`, `yt`, or the account's handle): build the short first as above, then per variant a copy of its folder built with the variant's settings into a composition of its own, rendered later on its own:

```bash
cp -r work/<k> work/<k>-<v>
node <skill>/tools/short.mjs build work/<k>-<v> --out artifacts/shorts/composition/<k>-<slug>-<v> --title "…" --cta "…" --handle @…
```

Without composition/index.html the project shows every `composition/<name>/` side by side, a player each, titled by the short's hook. Fix the check's errors (✗) before you go on. A short's names follow its own voices (A is who speaks first in that short): map them from the episode's speakers.

Then show the list in the chat (title and length per short) with buttons "They are good" and "Change something", and `[:button {:open "artifacts/shorts"} "Show the previews"]` in case the pane shows something else. For a change, build the short again with the new settings (`short.mjs build work/<k>` keeps the others); for the staging (a word, an effect), change `staging.json` and build again.

### 6. The accounts

Only now the accounts, and only where there is a choice: per chosen platform with several connected accounts a row of checkboxes of its accounts ("@carfunnews", "@soul.globe" …), the ones adapted for already set by step 3, and one button. A platform with one account takes it without a question. Propose the simple rule ("every short on all chosen accounts"); offer a choice per short only when they want one: per short a row of checkboxes of the chosen accounts and one button.

The limits are Storrito's, from `list-social-accounts`, never from memory: before the plan, hold every short's length (the built composition's duration, the end card included) against `minDurationSeconds` and `maxDurationSeconds` of each post type it goes to. A short that does not fit one of them: say which and why in one sentence and offer to shorten it, or to leave that account out for it.

### 7. The plan, the message, and go

Then one last message holds everything still to decide, so that nothing is asked once the rendering runs (they may close the window then). Propose a plan and show it as a table: per short the date and time, the accounts, and per account the caption you wrote (the hook, one or two sentences, a few fitting hashtags, in the episode's language unless the person says an account posts in another, in the platform's tone). A caption keeps to the shortest `maxCaptionLength` of its post types (X 280, Snapchat Spotlight 160 …) or gets a shorter version for those; post types whose `captionPublished` is false get none; a post type with `captionRequired` must get one. Options of a post type (`options`, e.g. the title and privacy of a YouTube Short) go into the plan too. A good default: one short a day at 18:00 in the person's time zone, the strongest first, the same short on all its accounts at the same time. Below the plan, in the same block, ask whether they want a message when everything is done, and how: radio buttons (one `:name`, none ticked) for "No message", E-mail, Slack, Telegram, a push message to the phone (Pushover), SMS and WhatsApp. Buttons: "Render and schedule" (`:class "primary"`, `:send "Render and schedule; tell me when done: {checked}"`), "One every two days", "All today", "Change the captions", and they can type anything else; a change shows the block again. Ask for the time zone only when you cannot tell (German speaks for Europe/Berlin). TikTok posts are private unless you set `privacyLevel` to `PUBLIC_TO_EVERYONE`: ask once whether they should be public.

Write the plan into `work/plan.json` as you agree on it: per short its folder and file (an adapted short: per variant), and per account the video it gets, its caption, its platform, id, procedure, `postType`, time (ISO 8601 with offset) and a UUID made now with `uuidgen` (or `node -e 'console.log(crypto.randomUUID())'`), never with a tool, so that a retry never posts twice.

### 8. Render and schedule

A message goes out through Composio: in rragent `composio/search` and `composio/execute` of the REPL (`(doc composio/search)`; without a Composio connector `(connectors)` lists none, then offer no message), in pchat the agent's own connection `mcp__storrito-agent__…`, its tools there from the start. When they chose one, before anything else:

- `COMPOSIO_SEARCH_TOOLS` (rragent: `composio/search`) for the use case ("send an email", "send a Telegram message", …) names the tool and whether the service is connected. Not connected: `COMPOSIO_MANAGE_CONNECTIONS` (rragent: `(composio/connections ["gmail"])`) with the toolkit gives a sign-in link; show it as `[:a {:href …} "Connect Gmail"]` and ask them to say when they are done.
- Ask for what the service needs to reach them and you cannot know: the e-mail address, the phone number, the Slack name. Write it into `work/plan.json` under `notify`.

Only after "Render and schedule" (and, with a message, the connection and the address):

1. Tell them in one or two sentences that you are rendering N shorts now (a few minutes each) and scheduling them, that **they can close this window**, and that everything finishes by itself; the result will be here in the chat, and with a message also there.
2. Render every short: `node <skill>/tools/short.mjs render work/<k> work/out/<k>.mp4`, and every variant of an adapted one: `node <skill>/tools/short.mjs render work/<k>-<v> work/out/<k>-<v>.mp4`. Never with `&` or `nohup`: a process left running after your turn is no work the machine knows of, it may be paused, and nobody goes on with the uploads when it ends.
   - With `bin/background` (pchat): all of them as one background task, `bin/background 'for k in 01 02 03; do node <skill>/tools/short.mjs render work/$k work/out/$k.mp4 || exit 1; done'`, and end your turn. pchat keeps the machine awake while it runs and writes to you when it has ended; then check the videos and go on with step 3 (a failed render: its log is in the task's folder (`.background/<n>/log`), fix and render that one again).
   - Without it: one short per command, in the foreground, with a timeout of 15 minutes each, all in this turn.
3. Upload it: `create-temp-blob-upload-url` with a new UUID from `uuidgen`, `contentType` `video/mp4` and the file's exact size, then `curl -sS -T work/out/<k>.mp4 -H 'Content-Type: video/mp4' '<uploadUrl>'`. Its `url` is the video for every post of this short, or of this variant (at most 100 MB; a minute is about 45).
4. Per account of the short, the procedure the plan names, with `html` `<insta-story src="<url>"></insta-story>`, the time as `date` and the UUID of the plan: `schedule-instagram-reel` (`instagramUsername`, `caption`, `shareToFeed: true`), `schedule-tiktok-post` (`tiktokAccountId`, `title`, `privacyLevel`), `schedule-social-post` (`socialAccountId`, `postType`, `text`, `name` as the title of a YouTube Short) for the others. Read a procedure's schema before its first use (rragent: `(doc storrito/<name>)`). Note each answer in `work/plan.json`.
5. Check with the status tools that each post is scheduled, then write the result into the chat: a table of short, account, time and status, and the videos as `[:video {:src "…" :controls true}]` only when they ask for them.
6. With a message chosen, send it last, once, in their language: the episode's title, how many shorts are scheduled on which accounts, the first and the last date, what failed if anything, and that the details are in the chat (no tokens, no ids). E-mail with the subject "Your shorts are scheduled" (in their language). If it cannot be sent, say so in the chat; the chat holds the result either way.

If something fails, retry it with the same UUID; if it keeps failing, say which and why in one sentence and go on with the rest.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/shorts"` shows the previews. Links and pictures point at `https://…`, at `artifacts/…` or at `uploads/…` (a file of yours there shows in the chat without taking the pane). An `input` is a checkbox or a radio button (`:type "checkbox"` / `"radio"`, nothing else is shown); `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated, when it is clicked. There are no text fields: for a name or a time they type, so say what to type.

- One question per block, with buttons for the likely answers and a hint that they can type anything else; a choice of several (platforms, accounts, shorts) as checkboxes with one button.
- In the main use, from the link to "Render and schedule", the person decides: no button or option marked "(recommended)", and radio buttons with none ticked. Elsewhere use your judgment.
- Make a button's text say what happens, and its `:send` text read as the person's answer ("Take 4 shorts", "Colour of Dominik: #ff9a5a").
- `:class "primary"` fills a button with the accent: give it to the one button that sends the block's ticked choices or starts the work ("Take these platforms", "Render and schedule"). Buttons that are alternative answers stay plain, none of them primary: the person decides.
- Tiles, for a choice of looks: a grid, `:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(150px, 1fr))" :gap "8px"}`, around tiles of the same build, each a column with a border, a radius and padding, `:style {:display "flex" :flex-direction "column" :gap "4px" :border "1px solid rgba(127,127,127,.35)" :border-radius "10px" :padding "8px"}`: the picture first (`[:img {:src "uploads/worlds/slate.jpg" :style {:width "100%" :aspect-ratio "3 / 4" :object-fit "cover" :border-radius "6px"}}]`), the name in `strong`, what it fits in `small`, the button last. Text stays on the page's background, never on a picture or a colour: what reads on one does not on the other.
- A swatch is a `button` with `:style {:background "#ffb36b" :width "34px" :height "34px" :border-radius "50%"}`.
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
 [:p "The first four are the strongest. How many should it be?"]
 [:button {:send "Take 4 shorts"} "4"] " "
 [:button {:send "Take all 6 shorts"} "All 6"] " "
 [:button {:send "Take only the best 2"} "2"]]
```

the platforms, from `list-social-accounts`:

```hiccup
[:div
 [:p "On which platforms should the shorts appear? These are connected to Storrito:"]
 [:label [:input {:type "checkbox" :value "Instagram Reel" :checked true}] " Instagram Reel"]
 [:label [:input {:type "checkbox" :value "TikTok" :checked true}] " TikTok"]
 [:label [:input {:type "checkbox" :value "YouTube Short" :checked true}] " YouTube Short"]
 [:label [:input {:type "checkbox" :value "LinkedIn video"}] " LinkedIn video"]
 [:button {:class "primary" :send "The shorts go to: {checked}"} "Take these platforms"]]
```

and one video or adapted, the radio buttons with none ticked:

```hiccup
[:div
 [:p "One video for all platforms, or adapted to each? Adapted means one video per platform, rendered each on its own."]
 [:label [:input {:type "radio" :name "variants" :value "one video for all"}] " One video for all"]
 [:label [:input {:type "radio" :name "variants" :value "adapted per platform"}] " Adapted per platform"]
 [:button {:class "primary" :send "Make it {checked}"} "Go on"]]
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

When the person attaches a clip instead of a link, it is one short: `short.mjs new work/01 uploads/<clip>` and on from step 4 of the main use (the look), with the series of one in `artifacts/shorts/`. A long recording (an episode, a talk, more than a few minutes) is the main use with the file in place of the link: `node <skill>/tools/episode.mjs fetch uploads/<file> work/episode` writes down its words the same way (it needs OpenRouter, a file has no captions), and `cut` cuts the moments from the file.

## Rights

Only material the person may use: when the episode is someone else's, say once, before scheduling, that publishing needs the rights holder's permission.

## Other uses

`tools/build.mjs` takes any word-timed transcript directly, with presets `lyric` (music, big gestures, 16:9), `podcast` and `social` (9:16, hook card, CTA): `node <skill>/tools/build.mjs transcript.json --audio voice.wav --preset lyric|podcast|social [--world …] --out <project>`. Check any built project with `node <skill>/tools/qa.mjs <project>`.

## Rules

- Everything stays deterministic: no `Date.now()`, `Math.random()` or network in compositions.
- Change transcript overrides, the staging or `plan.json` and rebuild; never hand-edit generated `compositions/*.html` or `assets/engine/*`.
- When working on the engine itself (not a video), follow [AGENTS.md](AGENTS.md) for the HyperFrames rules.
