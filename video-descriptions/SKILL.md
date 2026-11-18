---
name: video-descriptions
description: Write a video's post texts (captions, titles, descriptions, tags, hashtags, mentions) for every platform it goes to, within each platform's limits, in one fitting style, shown on one overview page.
license: MIT
metadata:
  title: "Post texts for a video"
  title-de: "Posttexte zum Video"
  summary: "Captions, titles, hashtags and mentions for every platform your video goes to, each within its rules, in a style that fits."
  summary-de: "Captions, Titel, Hashtags und Erwähnungen für jede Plattform deines Videos, jeweils nach ihren Regeln, in einem passenden Stil."
  ask: "Upload your video. I watch it, pick a style that fits, and write the caption, title, hashtags and mentions for each platform, within every limit. You see them all on one page to check."
  ask-de: "Lade dein Video hoch. Ich schaue es mir an, wähle einen passenden Stil und schreibe Caption, Titel, Hashtags und Erwähnungen für jede Plattform, innerhalb aller Limits. Du siehst alle auf einer Seite zum Prüfen."
  placeholder: "Upload a video"
  placeholder-de: "Video hochladen"
  inputs: "video"
---

# video-descriptions

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` is this file's folder. Run the tool as `node <skill>/tools/descriptions.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference, with the source of every limit: [README.md](README.md).

## What it needs

Node 20+ and ffmpeg. For the video's words, agentitos' `transcribe` skill beside this one (ElevenLabs Scribe through OpenRouter, about half a cent a minute): `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection; or words another tool already made (rragent's transcribe tool, the captions skill: `--words`). Nothing to `npm install`. Something missing: say so in one sentence, never install it yourself.

You write the texts; the tool reads the video, knows the rules, counts, checks and builds the overview.

## From the video to the texts, all in the chat

The person attaches a video; their message names it as a line `video: uploads/<file>`. Your files: `descriptions/<name>/` (`<name>` a short slug of the topic); the artifact: `artifacts/descriptions-<name>.html`. Every message: one or two sentences in the person's language and a hiccup block.

### 1. The video

Say in one sentence that you are watching the video, then run `node <skill>/tools/descriptions.mjs read uploads/<file> descriptions/<name>` (a video without speech: `--no-words`). It writes `video.json` (size, frame, length, the platforms the video fits), `words.txt` (what is said, line by line with its time) and `frames.jpg` (twelve frames with their times), and names the brand kit's handles. **Look at `frames.jpg` and read `words.txt` whole**: topic, who is in it, what is shown, text and account names in the picture, mood, pace, language. Correct a name the speech model misheard (a product, an account) before you quote it.

With a brand kit (`brand/DESIGN.md`), read its Voice and Tone, Audience, Social and Do's and Don'ts: the texts sound like the brand, with its du or Sie, its emoji or none, its own hashtag.

### 2. Where it goes

The platforms the person named; else every platform `read` says the video fits. Say in a sentence which ones you write for. An Instagram Story has no texts: its link, hashtag or mention goes on it as a sticker with agentitos' story-stickers, not here. X: 280 weighted characters unless they say they have Premium (`"x": {"premium": true}`, then up to 25,000): ask only when a long X post is what they want.

### 3. The style: choose it yourself

`node <skill>/tools/descriptions.mjs styles` lists them with what they do and which videos they fit: `professional`, `friendly`, `funny`, `glamorous`, `inspirational`, `educational`, `hype` (bold and energetic), `storytelling`, `minimal`. Do not ask; decide, in this order: (1) what the person said ("make it funny") wins; (2) the brand's voice (a brand kit that writes formally rules out `funny` slang; one that jokes allows it); (3) the video itself, what it shows and how; (4) the audience it speaks to.

When a skill that runs this one says to let the person choose (publish-video does, when there is no brand kit), ask once instead: the three or four styles that fit the video as buttons, the one you would pick `:class "primary"`, the rest named in a line.

One style for all platforms; the platform sets the register within it (LinkedIn and a YouTube title at its clear end, TikTok and Reels at its loose end). Write `"style"` and `"why"` (one sentence the person reads: why this style fits this video). A post that needs another style may have its own `"style"`.

### 4. The texts

`node <skill>/tools/descriptions.mjs platforms [platform…]` prints each platform's fields, limits, how it counts, what shows before "more", its hashtag, mention and link rules and what a copywriter must know there. Read it for the platforms you write for, then write `descriptions/<name>/descriptions.json`:

```json
{
  "title": "storrito-agent-demo",
  "lang": "en",
  "style": "educational",
  "why": "A screen demo that walks through four steps: the texts promise what one sees working.",
  "x": {"premium": false},
  "known": {"instagram": ["storrito_com"]},
  "posts": {
    "instagram-reels": {"caption": "One prompt. A Reel and a Story, posted. 📲\n\n…\n\n#InstagramTips #ContentScheduling #AIAgents"},
    "tiktok": {"caption": "…"},
    "youtube-shorts": {"title": "…", "description": "…", "tags": ["instagram scheduling", "ai agent"]},
    "youtube": {"title": "…", "description": "…\n\n0:00 Intro\n0:42 …", "tags": ["…"]},
    "facebook": {"caption": "…"},
    "linkedin": {"text": "…"},
    "x": {"text": "…"},
    "threads": {"text": "…"},
    "bluesky": {"text": "…", "alt": "…"},
    "pinterest": {"title": "…", "description": "…", "alt": "…", "link": "https://…"},
    "snapchat-spotlight": {"description": "…"}
  }
}
```

A good set of texts:

- **Each platform its own text**, written for how people read there, not one text cut to length: the Reel caption a hook and a few lines; TikTok short, in search words; the YouTube title a promise with the keyword, its description what the video gives, then details and chapters (`0:00 …` lines from the times in `words.txt`); LinkedIn a short insight in paragraphs; X one or two sentences; Pinterest the words people search for; alt texts what is seen and said.
- **The hook before the fold.** What shows before "more" (`check` prints it) carries the whole hook: a promise, a surprise, a question, in the video's language. Never a hashtag, a mention or a greeting there.
- **No long dash (—)**: readers take it for AI. A comma, colon, full stop or brackets instead.
- **Only what the video and the person say**: no invented number, price, date, result or quote. Words from `words.txt` are the best material.
- **Hashtags**: as many as `platforms` says the platform takes well, each about this video, **the specific before the general**: tags for exactly what it shows (the product, place, person, technique, event: #HelmuthVonMoltke, #WaxCylinder before #History) fill the slots first; a broad tag (#Marketing, #Travel) only when a slot is left, never more than one, never instead of a specific one. The brand's own tag when the brand kit names one. In the language the audience searches in. CamelCase for tags of several words (#ContentScheduling). Never #fyp, #viral, #explore or follow-for-follow tags. Where a web search is at hand, check that a tag is used for this topic before you rely on it; never claim a tag is trending. The tool does not check that a tag is used or brings reach, nor that an account exists: when the person relies on a tag or a mention, say so in a sentence.
- **Mentions** only of accounts you know are right on that platform: the brand kit's `social` handles, accounts the person named, accounts the video shows or says (ask when unsure of the spelling). A handle on one platform is not the same on another. List the known ones in `"known"` (`{"instagram": ["name"]}`, or a plain list for all platforms); `check` warns about every other. On LinkedIn and Facebook a mention is picked in the app: say so when you write one.
- **Links** only where they work (`platforms` says); where a link out costs reach (X, Facebook, LinkedIn), offer it as the first reply or comment.
- **No engagement bait** ("comment YES", "tag a friend", "like if"): ask a real question instead.
- Paid partnerships and realistic AI video are disclosed with the apps' switches, not only in the text: when the video is either, tell the person.

### 5. Check

```bash
node <skill>/tools/descriptions.mjs check descriptions/<name>
```

counts every field as its platform counts it, prints what shows before "more", the hashtags and mentions, and what is wrong: fix every ✗ in `descriptions.json` and check again; fix a ⚠ unless you have a reason not to (a brand that uses no hashtags). It also names platforms the video fits that have no texts.

### 6. The overview

```bash
node <skill>/tools/descriptions.mjs overview descriptions/<name>
```

writes `artifacts/descriptions-<name>.html` (refused while there is a ✗): every platform's texts as they will read. Tell the person in one sentence which style you chose and why, and show the overview with two buttons: "Looks good" (`:class "primary"`) and the one that opens the page ("Show all texts ↗"); a line under them says they can type what to change or another style.

### 7. Changes

Another style: write all texts again in it, not only a few words. Another hashtag, a shorter title, a platform more or less: change `descriptions.json`, `check`, `overview` again. `remember` the style and the handles the person chose for their next video.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; an `input` is a checkbox or a radio button, and `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block, comma-separated; `:open "artifacts/descriptions-<name>.html"` shows the overview. No text fields: they type a change.

- One question per block: buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else.
- Several picks from one list (platforms): checkboxes and one button.
- Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out: ask again for that group only. One question after the other only when it depends on the answer before, or on work the person should see first.
- Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; alternative answers (the styles) stay plain.
- Never a token, a path of `descriptions/` or a raw error in the chat.

The texts:

```hiccup
[:div
 [:p "Texts for 10 platforms, in the " [:strong "educational"] " style: the video walks through four steps, so the texts promise what one sees working."]
 [:button {:class "primary" :send "The texts are good"} "Looks good"] " "
 [:button {:open "artifacts/descriptions-storrito-agent-demo.html"} "Show all texts ↗"]
 [:p [:small "Or tell me what to change, or another style."]]]
```

When they ask for another style without naming one, the styles as buttons, each writing the texts in it:

```hiccup
[:div
 [:p "Which style instead?"]
 [:button {:send "Write them professional"} "Professional"] " "
 [:button {:send "Write them friendly"} "Friendly"] " "
 [:button {:send "Write them funny"} "Funny"] " "
 [:button {:send "Write them glamorous"} "Glamorous"] " "
 [:button {:send "Write them bold and energetic"} "Bold"]
 [:p [:small "Or: inspirational, storytelling, minimal; or describe the tone you want."]]]
```

## Rules

- Every limit as the platform counts it: run `check`, never count by eye.
- Change `descriptions.json` and build the overview again; never edit the built page by hand.
