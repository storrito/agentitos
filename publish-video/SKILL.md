---
name: publish-video
description: Publish a finished video through Storrito. Check whether it is ready (frame, size, codec, length, sound level, black or silence at its ends, text under the apps' buttons, and what you see on a sheet of its frames), decide with the person whether it goes out as a short-form video (9:16 on Instagram Reels, TikTok, YouTube Shorts, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X) or as a long-form video on YouTube, let them pick the accounts connected to Storrito, write each platform's texts with video-descriptions in a style they agree on, and once they say yes schedule it or post it now. Use when someone hands over a finished video to post, schedule or publish, in whatever form (an upload, a link, a video another skill just made).
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

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/publish.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+ and ffmpeg. agentitos' **video-descriptions** beside this skill (the texts) and **platform-zones** (what the apps cover); without video-descriptions the tool says so and publishes nothing. Storrito: on a Sprite the gateway's Storrito connection, elsewhere `STORRITO_API_URL` and `STORRITO_CREDENTIAL`. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

The tool measures, writes the video again where that is mechanical, and talks to Storrito. Whether the video is good to go out, where it goes, the style and the texts are decisions: yours from what the tool shows you, or the person's.

## From the video to the posts, all in the chat

The person hands over a video: an upload (a line `video: uploads/<file>`), a link (Google Drive, Dropbox or a direct link to the file; not a YouTube or Instagram page), or the video another skill just made. Your files: `publish/<name>/` and `descriptions/<name>/` (`<name>` a short slug of the topic, the same for both). Keep every message short: one or two sentences and a hiccup block, one question per block. Speak the person's language.

### 1. Check it

Say in one sentence that you check the video. Then

```bash
node <skill>/tools/publish.mjs check <video or link> publish/<name>
```

It measures the video, suggests **short** or **long**, lists what keeps it from going out (✗) and what to weigh (⚠), and makes `uploads/publish-<name>/frames.jpg`: twelve frames, the first and the last among them, on a 9:16 video with what Reels, TikTok, Shorts and Facebook cover outlined in red and the safe box in green.

### 2. Short or long

When `check` is certain (9:16 up to 3 min: short; 16:9 over 3 min: long), take it and say it in passing. When it says to ask, ask:

```hiccup
[:div
 [:p "Your video is 16:9 and 0:48 long. How should it go out?"]
 [:button {:send "As a YouTube video"} "YouTube video (16:9)"] " "
 [:button {:send "As a short video, reframed to 9:16"} "Short video (9:16)"]
 [:p [:small "A short video goes to Reels, TikTok, Shorts and the others; it needs 9:16."]]]
```

Then `check publish/<name> --mode short|long`. A wide video that should go out short: reframed to follow the subject with agentitos' auto-reframe (then `check` its result), or with black bars (`prepare --pad`) when the person prefers bars; ask which, with those two buttons.

### 3. Is it ready?

**Look at the sheet** and judge what no tool measures: does the first frame make someone stay, does the end close or cut off mid-move, is every text readable, inside the green box and spelled right, is there another app's watermark (a TikTok logo on a Reel costs reach), black bars, a test frame, something private?

- **✗ that `prepare` fixes** (size, codec, container, bitrate): run it without asking, it changes nothing one sees. `--crop` for a nearly 9:16 video only when the sheet shows nothing near the edges; else ask: cropped or thin bars.
- **⚠ about the sound** (too quiet, too loud, peaks): `prepare --loudness`. **Black or silence at the start or end**: `prepare --start <s>` / `--end <s>` cuts it, when it is plainly empty.
- Several fixes go into one `prepare` call; it writes `publish/<name>/video.mp4` and checks it again.
- **Weigh what you see by what it costs.** The sheet shows twelve moments, not every frame. A subtitle that touches a red outline in a frame or two, a word that runs into the margin but stays readable, the edge of a picture under the buttons: leave it, and say nothing about it. A finished video is not sent back for that.
- **Ask only when it hides what must be read or seen**: the hook or a title under the buttons, a name, a price, a call to action, a face cut by the caption area, subtitles under the buttons through most of the video; or a weak first second, a cut-off end, a typo in the picture, another app's watermark. Then tell the person in a sentence what you see, with the frame's time, and ask:

```hiccup
[:div
 [:p "At 0:12 the subtitle runs under TikTok's buttons."]
 [:img {:src "uploads/publish-launch/frames.jpg" :style {:max-width "100%"}}]
 [:button {:class "primary" :send "Publish it anyway"} "Publish anyway"] " "
 [:button {:send "I'll fix the video first"} "I'll fix it"]]
```

When it is ready, or nearly so, say so in one sentence and go straight on to the accounts: no sheet, no list of what you converted, cut or noticed. The sheet goes into the chat only with a question about a real problem, as above.

### 4. Where it goes

```bash
node <skill>/tools/publish.mjs accounts publish/<name>
```

lists the targets the video fits (an account's post type, e.g. `instagram/storrito_com/reel`, an Instagram Story `instagram/storrito_com/story` up to 60 s), and the others with why not. Then

```bash
node <skill>/tools/publish.mjs accounts publish/<name> --hiccup --lang de
```

prints the question as a hiccup block: the accounts grouped by platform, each with its profile picture or the platform's icon, the disconnected ones and those the video is too long for greyed out with why, only the accounts of the person's last publish ticked. Put it into your answer as it is, after one sentence. Never tick them all yourself: with many accounts that is a list to untick.

No account fits (the tool says so): say why in a sentence (the video's length or frame, or nothing connected) and what would change it.

### 5. The style

- **A brand kit** (`brand/DESIGN.md`): the style comes from its Voice and Tone. Say which style you take and why in one sentence; no question.
- **No brand kit**: ask once, as video-descriptions' SKILL.md says for this case: the three or four styles that fit this video as buttons, the one you would pick `:class "primary"`.
- The person already said how it should sound: that is the style.

### 6. The texts

Follow video-descriptions' SKILL.md, steps 1 and 4 to 6, with its folder `descriptions/<name>/` and the job's video (`publish/<name>/video.mp4` when `prepare` wrote one, else the original), for exactly the platforms of the chosen targets: the `texts:` column of `accounts` (an Instagram Story has none: it publishes no text, and with only Stories chosen there are no texts to write) (`instagram-reels`, `tiktok`, `youtube-shorts`, `linkedin`, `x`, …; long: `youtube`). Its `check` must have no ✗; its overview is what the person agrees to: "Looks good" (`:class "primary"`) and the button that opens the page ("Show all texts ↗"), with a line that they can type what to change.

Long-form on YouTube also wants:
- **a thumbnail**: offer to make one with agentitos' thumbnail-and-intro, or let YouTube pick a frame;
- **chapters** in the description (`0:00 …` from `words.txt`) when the video has parts;
- the **tags** stay in descriptions.json but do not go through Storrito: say they are added in YouTube Studio.

### 7. The last questions, then publish

After the texts are agreed, ask what applies, all in one block (the example below): one group of radio buttons per question, none ticked, and one button that publishes. Each value says what it answers ("YouTube: public"), as `{checked}` sends them all in one line. An answer missing a group asks again only for that group.

- **When.** "Now" and two likely times ("Today 18:00", "Tomorrow 9:00"); they may type another. The time zone only when you cannot tell (German speaks for Europe/Berlin).
- **TikTok, who may see it**: "Everyone", "Friends", "Followers", "Only me". TikTok wants the person's own choice: none assumed (`--tiktok-privacy public|friends|followers|private`).
- **TikTok's cover**: not a question. Pick the moment yourself from the frames you saw (the subject clear, a face or a readable title; never a cut, a blur or a black frame), `--tiktok-cover <s>`, and name it in a few words in the "When" question ("cover: the frame at 0:12"). Without it TikTok takes the first frame.
- **YouTube, a Short or a video: visibility**: "Public", "Unlisted", "Private" (`--privacy`); **made for kids**: "No" or "Yes" (`--made-for-kids no|yes`). YouTube asks both of every video, a Short too; the tool refuses a YouTube target without them.
- **An option `accounts` names as required** (LinkedIn's visibility, …): its choices as one more group (`--option <target>:<key>=<value>`).
- **Disclosures, only when they apply**: realistic AI-made people or scenes (`--ai-generated`), a paid partnership (`--paid`), the person's own brand promoted on TikTok (`--own-brand`). Ask when you see signs of one, as unticked checkboxes in the same block; never set one without the person.

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
node <skill>/tools/publish.mjs publish publish/<name> --to <target>,<target> (--at 2026-10-29T18:00:00+01:00 | --now) [--tiktok-privacy …] [--tiktok-cover <s>] [--privacy …] [--made-for-kids no|yes] [--thumbnail <image>] [--option …]
```

It reads the texts from `descriptions/<name>/descriptions.json` (another folder: `--texts`), runs video-descriptions' check, checks every target's parameters before it uploads anything, uploads the video once and schedules each target. A ✗ names what is missing: fix it or ask, then run the same command again; what is done stays done, nothing is posted twice.

`--now`: `status publish/<name> --wait 300` until the posts are out, then a table of account, status and link. A time: `status publish/<name>` shows them scheduled. Say it in one sentence, the table below; a failed post with its reason in plain words.

### 8. Changes

- **Another text or time** for a target already scheduled: `cancel publish/<name> --to <target>`, change `descriptions.json` (then video-descriptions' `check`), `publish` again with the new time. `publish` refuses to schedule a target twice with other texts until the old post is taken back.
- **All back**: `cancel publish/<name>`. A post that is out is deleted in the app, not here: say so.
- **Another video**: `check <new video> publish/<name>` again; the scheduled posts of the old one are taken back first.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block; `:open "artifacts/descriptions-<name>.html"` shows the texts' overview. Pictures point at `uploads/…`. There are no text fields: for a time or a change they type.

- One question per block (the last questions of step 7 are one block), buttons for the likely answers, and a hint that they can type anything else.
- A button only where a click makes you act at once: an answer you go on with, a choice you carry out, a page you open. Never one that only leads to your next question ("Change something"): they type what to change.
- The button that moves on gets `:class "primary"`; alternative answers stay plain. A button that opens an artifact ends with " ↗".
- Never put a token, a path of `publish/` or `descriptions/`, a target id or a raw error into the chat: account names and platforms as people say them.

## Rules

- Nothing is published before the person agreed to the texts and named the accounts and the time.
- Every decision the tool cannot measure is yours or the person's, said in a sentence: the mode when it is open, the crop, the cut of the ends, whether a flaw is worth fixing. A small flaw in a finished video, and what prepare fixed, is neither asked about nor mentioned.
- TikTok's audience, YouTube's visibility and "made for kids", and every disclosure are the person's choice; never a default.
- Change the inputs (`descriptions.json`, the video, the options) and run the tool again; never call Storrito's procedures around it for a target it handles.
