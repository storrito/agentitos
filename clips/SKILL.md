---
name: clips
description: Turn one long video (a YouTube link or an upload: a podcast, an interview, a webinar, a talk, a livestream) into finished vertical shorts in the video's own look, the speaker's footage framed 9:16 on whoever speaks, pauses and "äh"s cut, every clip at one level, captions and, where the first line is weak, a hook card; find the moments that stand alone (one idea, 20 to 59 seconds, a cold open, a clean end), agree on them in the chat, show them side by side, then render them and schedule them on the person's social accounts through Storrito. Use for clips, long to short, repurposing a podcast or a webinar into Reels, TikToks and YouTube Shorts.
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

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

The look is the video's own: the speaker's footage, cut and framed, captions, at most a hook card. For every word big on screen over a world of light, kinetic-lyrics is the other skill; for recordings filmed in several attempts, best-takes.

## What it needs

Node 20+, ffmpeg, the HyperFrames CLI, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tools find it at `http://sprite.internal`). agentitos' `best-takes`, `captions` and `platform-zones` beside this one; `video-descriptions` for the post texts when it is there. yt-dlp is taken from the PATH or downloaded once. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

Costs: the episode's words a few cents an hour, the moments about ten cents an hour, per clip about a cent to frame it and well under a cent for its words and captions.

## From the long video to scheduled shorts, all in the chat

Go through the steps in order; each ends with a question in the chat, and the person's answer starts the next. Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Decide small things yourself and say what you decided.

**Keep the pane clean.** Everything you work on lives in `work/`. The only artifact is `artifacts/clips/`, a HyperFrames project that shows every clip side by side.

### 1. The video

Say in one sentence that you are listening to the whole video now and that it takes a few minutes. Then

```bash
node <skill>/tools/episode.mjs fetch <url or uploads/<file>> work/episode
```

writes `work/episode/episode.json` (title, channel, length, the voices), `words.json` (every word with its time and speaker) and `sentences.txt`, one numbered sentence a line.

### 2. The moments

Do not read `sentences.txt` yourself (an hour is some 30,000 tokens that would stay in every later step). `node <skill>/tools/episode.mjs moments work/episode` has a model read it once and prints:

- **what is inside**: claims, stories, numbers, mistakes, how-tos, answers. Under four in all, the video is too thin for clips: say so and offer the one or two it gives.
- **the moments**, best first: sentence range, time, length, kind, title, the first line, why it works, and a score out of 10, two points each for a cold open, one idea, a clean end, leaning on nothing said before, and a length of 20–59 s. Under 7 it says `weak`: drop those unless the person wants more. A moment whose first line is weak comes with a **hook** for the screen (6 words or fewer).
- **the ideas too spread out to clip**: worth recording anew as a short of their own. Mention them in one line at the end, never as clips.

`work/episode/moments.json` holds all of it with the YouTube links. When you need a moment's words: `sed -n '<first+1>,<last+1>p' work/episode/sentences.txt`. Without OpenRouter, read `sentences.txt` yourself and judge by the same points.

Show the moments as cards (title, time and length, the first line as a quote, why, the hook when there is one, the link to the moment) and ask how many it should be, with buttons for the numbers that make sense; they can also name the ones they want.

### 3. Where they go, and the look

Ask one thing per message. First `list-social-accounts` of the Storrito connection (rragent: a function of your REPL, `(storrito/list-social-accounts {})`; `(doc storrito/<name>)` shows a procedure's input). An account with `disconnected: true` counts as not there.

1. **The platforms**: checkboxes, one per post type that takes a video and has a connected account ("Instagram Reel", "TikTok", "YouTube Short", …), the ones made for shorts ticked. Keep them as platform-zones names them (`reels,tiktok,shorts,facebook-reels,spotlight,linkedin`): the captions and the hook keep clear of what those apps lay over the video.
2. **The captions**: the styles as buttons, none marked: **Hormozi** (one to three big words in capitals), **Karaoke pill**, **Wipe**, **Clean subtitles** (whole phrases on a soft box, for interviews and explainers), or none.
3. **The brand**: with a `brand/DESIGN.md` in your working directory (agentitos' brand-kit), its colour and font go into the captions and the hook; say so, do not ask.

### 4. The previews beside the chat

Say in one sentence that the previews appear on the right one by one. Make the project once with the `project` tool (create, name `clips`, kind `hyperframes`) and remove its `artifacts/clips/composition/index.html`: without it the project shows every `composition/<name>/` side by side. Then for every chosen moment `<k>` (`01`, `02`, … in the order you showed them; `<slug>` a short name):

```bash
node <skill>/tools/clips.mjs prepare work/episode work/<k> <first>-<last> \
  --out artifacts/clips/composition/<k>-<slug> --platform <platforms> --title "<title>" \
  [--hook "<hook>"] [--brand brand/DESIGN.md]
```

It cuts the moment, frames it 9:16 on whoever speaks (a model watches the clip once and names the faces with their voices; footage that is already vertical stays as it is), and hands it to best-takes: every word written down again, closer, "äh"s marked, the level measured, every pause over 0.4 s cut (`--pauses tight`), and `work/<k>/takes/cut.json` as one keep of the whole moment. It prints the next command lines with best-takes' path (`<takes>` below). Then:

1. Read `work/<k>/takes/source/brief.md`. Fix misheard names in `cut.json` `"fixes"`; move the start of the keep past a stray "und", "also", "so", or the end to the last word of the payoff. The moment must still open cold and end clean.
2. `node <takes> build work/<k>/takes`, then `node <takes> captions work/<k>/takes --style <style>` (with `--brand` when there is one), then `node <takes> check work/<k>/takes`: fix every ✗; a ⚠ unless you have a reason.

The hook: use the moments' hook where the first line is weak, rewrite it when it is a label, and leave it out where the first line carries itself. One `*word*` may stand out. To change it: `node <takes> build work/<k>/takes --hook "…"` (`--hook ""` takes it out). It sits at the top of the free box, centred, on the first frame, and stays while the first sentence is said.

Then show the list (title and length per clip) with buttons "They are good" and "Change something", and `[:button {:open "artifacts/clips"} "Show the previews"]`.

### 5. Changes

| They say | You do |
| --- | --- |
| "Start later / end earlier" | move the keep's ends in `cut.json`, build |
| "The pauses are too tight" | `build … --pauses picture` (only pauses over a second, following the picture) |
| "Another hook" / "no hook" | `build … --hook "…"` / `--hook ""` |
| "Another caption style" | `captions … --style …` |
| "The wrong person is in the picture" | look at `work/<k>/framed.json` (the windows) and the clip; say what you saw. Framing again: `rm work/<k>/framed.mp4`, then prepare that clip anew (`rm -r work/<k>` first) |
| "Longer" | a new moment with more sentences (`prepare` with the wider range into a new folder) |

### 6. The plan, then render and schedule

Per platform the limits come from `list-social-accounts` (`minDurationSeconds`, `maxDurationSeconds`, `maxCaptionLength`, `captionPublished`, `options`), never from memory: hold every clip's length against them. Write the post texts with agentitos' video-descriptions when it is beside this skill (its `platforms` and `check`), else yourself within `maxCaptionLength`: the hook in the platform's tone, one or two sentences, a few fitting hashtags, in the video's language.

Propose the plan in one message: per clip the date and time, the accounts, and the text per account; a good default is one clip a day at 18:00 in the person's time zone, the strongest first. Buttons: "Render and schedule" (primary), "One every two days", "All today", "Change the texts". TikTok posts are private unless `privacyLevel` is `PUBLIC_TO_EVERYONE`: ask once. Write the plan into `work/plan.json` with a UUID per post made now (`uuidgen`), so that a retry never posts twice.

After "Render and schedule":

1. Say in one sentence that you render N clips now (about one and a half times their length each) and schedule them, and that they can close the window.
2. Render each, in the foreground, one command each: `node <skill>/tools/clips.mjs render work/<k> work/out/<k>.mp4`. It renders the preview with HyperFrames and brings it to −14 LUFS with subtitles beside it (`work/out/<k>.srt`). Never with `&` or `nohup`.
3. Upload each: `create-temp-blob-upload-url` with a new UUID, `contentType` `video/mp4` and the file's exact size, then `curl -sS -T work/out/<k>.mp4 -H 'Content-Type: video/mp4' '<uploadUrl>'`.
4. Per account the procedure the plan names, with `html` `<insta-story src="<url>"></insta-story>`, the time as `date` and the plan's UUID: `schedule-instagram-reel`, `schedule-tiktok-post`, or `schedule-social-post` for the others. Read a procedure's schema before its first use.
5. Check with the status tools that each post is scheduled, then show a table of clip, account, time and status.

If something fails, retry it with the same UUID; if it keeps failing, say which and why in one sentence and go on with the rest.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only: `div span p ul ol li strong em b i s small h1–h4 a img video button table thead tbody tr th td label input br`. `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/clips"` shows the previews; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the ticked `:value`s. There are no text fields: for a hook or a time they type.

- One question per block, buttons for the likely answers, and a hint that they can type anything else.
- `:class "primary"` on the one button that moves on; the person decides the moments, platforms and plan, so nothing there is marked as recommended.
- Never a token, a path of `work/`, a word number or a raw error in the chat.

The moments:

```hiccup
[:div
 [:p [:small "Inside: 5 claims, 2 stories, 4 numbers, 1 mistake, 3 how-tos"]]
 [:div {:style {:border "1px solid #ddd" :border-radius "12px" :padding "10px 12px"}}
  [:strong "1 · Täglich posten hat uns geschadet"] [:small " · 12:04 · 47 s · 9/10"]
  [:p [:em "„Jeden Tag zu posten hat diesen Kanal fast umgebracht.“"]]
  [:small "A claim against the usual advice, the number that proves it at the end."] " "
  [:a {:href "https://youtu.be/abc?t=724"} "▶ watch"]]
 [:p "How many should it be?"]
 [:button {:send "Take 4 clips"} "4"] " " [:button {:send "Take all 6 clips"} "All 6"]
 [:p [:small "Or name the ones you want."]]]
```

## Rights

Only material the person may use: when the video is someone else's, say once, before scheduling, that publishing needs the rights holder's permission.
