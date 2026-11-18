---
name: publish-video
description: Checks a finished video, agrees on short-form (Reels, TikTok, Shorts, …) or long-form YouTube, the accounts and texts, then schedules or posts it through Storrito; for any finished video to publish.
license: MIT
metadata:
  title: "Publish a video"
  title-de: "Video veröffentlichen"
  summary: "Your finished video checked, its texts written for each platform, and scheduled on the accounts you pick."
  summary-de: "Dein fertiges Video geprüft, die Texte für jede Plattform geschrieben und auf den Accounts eingeplant, die du wählst."
  ask: "Upload your finished video or paste a link to it. I check whether it is ready, ask where it should go, write the texts for each platform and schedule it once you like them."
  ask-de: "Lade dein fertiges Video hoch oder füge einen Link ein. Ich prüfe, ob es bereit ist, frage, wohin es soll, schreibe die Texte für jede Plattform und plane es ein, sobald sie dir gefallen."
  placeholder: "Upload a video or paste a link"
  placeholder-de: "Video hochladen oder Link einfügen"
  inputs: "video"
---

# publish-video

`<skill>` is the folder of this file. Run `node <skill>/tools/publish.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+ and ffmpeg. agentitos' **video-descriptions** beside this skill (the texts; without it the tool says so and publishes nothing) and **platform-zones** (what the apps cover). Storrito: on a Sprite the gateway's Storrito connection, elsewhere `STORRITO_API_URL` and `STORRITO_CREDENTIAL`. When something is missing, say so in one sentence; never install it.

The tool measures, rewrites the video where that is mechanical, and talks to Storrito. Whether the video is good to go, where it goes, the style and the texts are decisions: yours from what the tool shows you, or the person's.

## From the video to the posts, all in the chat

The video comes as an upload (a line `video: uploads/<file>`), a link (Google Drive, Dropbox or a direct link to the file; not a YouTube or Instagram page), or the video another skill just made. Your files: `publish/<name>/` and `descriptions/<name>/` (`<name>` one short slug of the topic for both). Every message one or two sentences and a hiccup block, in the person's language.

### 1. Check it

Say in one sentence that you check the video, then `node <skill>/tools/publish.mjs check <video or link> publish/<name>`. It suggests **short** or **long**, lists what keeps it from going out (✗) and what to weigh (⚠), and makes `uploads/publish-<name>/frames.jpg`: twelve frames, first and last among them; on a 9:16 video what Reels, TikTok, Shorts and Facebook cover is outlined red, the safe box green.

### 2. Short or long

When `check` is certain (9:16 up to 3 min: short; 16:9 over 3 min: long), take it and say it in passing. When it says to ask:

```hiccup
[:div
 [:p "Your video is 16:9 and 0:48 long. How should it go out?"]
 [:button {:send "As a YouTube video"} "YouTube video (16:9)"] " "
 [:button {:send "As a short video, reframed to 9:16"} "Short video (9:16)"]
 [:p [:small "A short video goes to Reels, TikTok, Shorts and the others; it needs 9:16."]]]
```

Then `check publish/<name> --mode short|long`. A wide video going out short: reframed to follow the subject with agentitos' auto-reframe (then `check` its result), or black bars (`prepare --pad`); ask which, with those two buttons.

### 3. Is it ready?

Look at the sheet for what no tool measures: does the first frame make someone stay, does the end close or cut off mid-move, is every text readable, inside the green box and spelled right, is there another app's watermark (a TikTok logo on a Reel costs reach), black bars, a test frame, something private?

- **✗ that `prepare` fixes** (size, codec, container, bitrate): run it without asking. `--crop` for a nearly 9:16 video only when the sheet shows nothing near the edges; else ask: cropped or thin bars.
- **⚠ about the sound** (too quiet, too loud, peaks): `prepare --loudness`. **Black or silence at the start or end**, plainly empty: `prepare --start <s>` / `--end <s>`.
- All fixes in one `prepare` call; it writes `publish/<name>/video.mp4` and checks it again.
- The sheet shows twelve moments, not every frame. A subtitle touching a red outline in a frame or two, a word in the margin that stays readable, the edge of a picture under the buttons: leave it and say nothing.
- **Ask only when it hides what must be read or seen** (the hook or a title under the buttons, a name, a price, a call to action, a face cut by the caption area, subtitles under the buttons through most of the video), or for a weak first second, a cut-off end, a typo in the picture, another app's watermark: one sentence of what you see with the frame's time, then

```hiccup
[:div
 [:p "At 0:12 the subtitle runs under TikTok's buttons."]
 [:img {:src "uploads/publish-launch/frames.jpg" :style {:max-width "100%"}}]
 [:button {:class "primary" :send "Publish it anyway"} "Publish anyway"] " "
 [:button {:send "I'll fix the video first"} "I'll fix it"]]
```

Ready, or nearly: say so in one sentence and go straight on to the accounts; no sheet, no list of what you converted, cut or noticed.

### 4. Where it goes

`node <skill>/tools/publish.mjs accounts publish/<name>` lists the targets the video fits (an account's post type, e.g. `instagram/storrito_com/reel`; an Instagram Story `instagram/storrito_com/story` up to 60 s), and the others with why not. `node <skill>/tools/publish.mjs accounts publish/<name> --hiccup --lang de` prints the question as a hiccup block (accounts grouped by platform with picture or icon, disconnected and too-long ones greyed out with why, only the accounts of the person's last publish ticked): put it into your answer as it is, after one sentence. Never tick them all yourself.

No account fits (the tool says so): say why in a sentence (length, frame, nothing connected) and what would change it.

### 5. The style

- **A brand kit** (`brand/DESIGN.md`): the style comes from its Voice and Tone; say which and why in one sentence, no question.
- **No brand kit**: ask once, as video-descriptions' SKILL.md says: the three or four styles that fit as buttons, the one you would pick `:class "primary"`.
- The person already said how it should sound: that is the style.
- Only Instagram Stories chosen: no style and no texts (a Story publishes none); go on with step 7.

### 6. The texts

Follow video-descriptions' SKILL.md, steps 1 and 4 to 6, with its folder `descriptions/<name>/` and the job's video (`publish/<name>/video.mp4` when `prepare` wrote one, else the original), for exactly the platforms in the `texts:` column of `accounts` (`instagram-reels`, `tiktok`, `youtube-shorts`, `linkedin`, `x`, …; long: `youtube`; a Story has none). Its `check` must have no ✗; its overview is what the person agrees to: "Looks good" (`:class "primary"`) and "Show all texts ↗" that opens the page, with a line that they can type what to change.

Long-form on YouTube: read `<skill>/references/long-form.md` before writing its texts (thumbnail, chapters, tags).

### 7. The last questions, then publish

After the texts are agreed, ask what applies, all in one block as "UI in the chat" says (example below), none ticked, one button that publishes.

- **When**: "Now" and two likely times ("Today 18:00", "Tomorrow 9:00"); they may type another. The time zone only when you cannot tell (German speaks for Europe/Berlin).
- **TikTok, who may see it**: "Everyone", "Friends", "Followers", "Only me" (`--tiktok-privacy public|friends|followers|private`); the person's own choice, none assumed.
- **TikTok's cover**: no question. Pick the moment from the frames you saw (subject clear, a face or a readable title; never a cut, a blur or a black frame), `--tiktok-cover <s>`, and name it in the "When" question ("cover: the frame at 0:12"). Without it TikTok takes the first frame.
- **YouTube, Short or video**: visibility "Public", "Unlisted", "Private" (`--privacy`) and **made for kids** "No" or "Yes" (`--made-for-kids no|yes`); the tool refuses a YouTube target without both.
- **An option `accounts` names as required** (LinkedIn's visibility, …): one more group (`--option <target>:<key>=<value>`).
- **An Instagram Story target**: read `<skill>/references/story-stickers.md` before this block (its sticker question, `--stickers` / `--no-stickers`).
- **Disclosures, only when you see signs of one**: realistic AI-made people or scenes (`--ai-generated`), a paid partnership (`--paid`), the person's own brand promoted on TikTok (`--own-brand`); unticked checkboxes in the same block, never set without the person.

```hiccup
[:div
 [:p "When should it go out, and who may see it? Cover on TikTok: the frame at 0:12."]
 [:p [:strong "When"] [:br]
  [:label [:input {:type "radio" :name "when" :value "when: now"}] " Now"] " "
  [:label [:input {:type "radio" :name "when" :value "when: today 18:00"}] " Today 18:00"] " "
  [:label [:input {:type "radio" :name "when" :value "when: tomorrow 09:00"}] " Tomorrow 09:00"]]
 [:p [:strong "TikTok, who may see it"] [:br]
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: everyone"}] " Everyone"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: followers"}] " Followers"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: friends"}] " Friends"] " "
  [:label [:input {:type "radio" :name "tiktok" :value "TikTok: only me"}] " Only me"]]
 [:p [:strong "YouTube Short"] [:br]
  [:label [:input {:type "radio" :name "youtube" :value "YouTube: public"}] " Public"] " "
  [:label [:input {:type "radio" :name "youtube" :value "YouTube: unlisted"}] " Unlisted"] " "
  [:label [:input {:type "radio" :name "youtube" :value "YouTube: private"}] " Private"] [:br]
  "Made for kids? "
  [:label [:input {:type "radio" :name "kids" :value "for kids: no"}] " No"] " "
  [:label [:input {:type "radio" :name "kids" :value "for kids: yes"}] " Yes"]]
 [:button {:class "primary" :send "Publish: {checked}"} "Publish"]
 [:p [:small "Another time: type it, with your time zone."]]]
```

Then

```bash
node <skill>/tools/publish.mjs publish publish/<name> --to <target>,<target> (--at 2026-10-29T18:00:00+01:00 | --now) [--tiktok-privacy …] [--tiktok-cover <s>] [--privacy …] [--made-for-kids no|yes] [--thumbnail <image>] [--option …] [--stickers stickers/<name>/layer.html | --no-stickers]
```

It reads the texts from `descriptions/<name>/descriptions.json` (another folder: `--texts`), runs video-descriptions' check, checks every target's parameters before uploading, uploads once and schedules each target. A ✗ names what is missing: fix it or ask, then run the same command again; what is done stays done, nothing is posted twice.

`--now`: `status publish/<name> --wait 300` until the posts are out, then a table of account, status and link. A time: `status publish/<name>` shows them scheduled. One sentence, the table below; a failed post with its reason in plain words.

### 8. Changes

Read `<skill>/references/changes.md` before changing or taking back what is scheduled (another text or time, all back, another video).

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block; `:open "artifacts/descriptions-<name>.html"` shows the texts' overview. Pictures point at `uploads/…`. No text fields: a time or a change they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you go on, none depending on another: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers. An answer that leaves a group out is asked again for that group only. One after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- A button only where a click makes you act at once: an answer you go on with, a choice you carry out, a page you open. Never one that only leads to your next question ("Change something"): they type what to change.
- The button that moves on gets `:class "primary"`; alternatives stay plain. A button that opens an artifact ends with " ↗".
- Never a token, a path of `publish/` or `descriptions/`, a target id or a raw error in the chat: account names and platforms as people say them.

## Rules

- Nothing is published before the person agreed to the texts and named the accounts and the time.
- Change the inputs (`descriptions.json`, the video, the options) and run the tool again; never call Storrito's procedures around it for a target it handles.
