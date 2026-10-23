---
name: platform-zones
description: Where Instagram (Reels, Stories, feed), TikTok, YouTube (Shorts and videos), Facebook (Reels, Stories, feed), Snapchat, Pinterest, LinkedIn and X lay their buttons, names and captions over a video, per frame (9:16, 4:5, 1:1, 16:9): the box that stays clear for text, faces and what is shown, what each app covers, and where a feed or a profile grid shows the video cut to another ratio. When the person did not say where the video goes, the usual platforms of its frame together. Use before placing text, captions, a face or a screen in a video for social media, to check a finished frame, and as the zones step of other skills (captions, screencast-cut, kinetic-lyrics, story-from-link): they call its tool.
license: MIT
metadata:
  title: "Platform zones"
  title-de: "Plattform-Zonen"
  summary: "Where TikTok, Reels, Shorts and the others put their buttons over your video, and where your text and faces stay visible."
  summary-de: "Wo TikTok, Reels, Shorts und die anderen ihre Buttons über dein Video legen, und wo Text und Gesichter sichtbar bleiben."
  ask: "Upload a video or a still and tell me where it goes (Reels, TikTok, Shorts, …). I show you what the app will cover and where your text and faces stay clear."
  ask-de: "Lade ein Video oder Bild hoch und sag mir, wo es hingeht (Reels, TikTok, Shorts, …). Ich zeige dir, was die App verdeckt und wo Text und Gesichter frei bleiben."
  placeholder: "Upload a video or an image"
  placeholder-de: "Video oder Bild hochladen"
  inputs: "video, image"
---

# platform-zones

You run in rragent: the chat on the left, the artifacts beside it. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/zones.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference, with every number's sources: [README.md](README.md).

## What it needs

Node 20+; ffmpeg for `draw` and for `--of <file>`. No model, no key, no cost.

## The zones

```
node <skill>/tools/zones.mjs list
node <skill>/tools/zones.mjs zones [platform…] (--of <video> | --size 1080x1920 | --frame 9:16) [--json]
node <skill>/tools/zones.mjs check <x,y,w,h> [platform…] (--of … | --size … | --frame …) [--json]
node <skill>/tools/zones.mjs draw <video|image> <out.png> [platform…] [--at <s>]
```

- **Name the platforms the video goes to** (`reels`, `story`, `tiktok`, `shorts`, `youtube`, `facebook-reels`, `pinterest`, `linkedin`, `x`, …; `list` names them all). Several at once give the zones of all together: what is inside the safe box is clear on each.
- **When the person did not say where it goes**, name none: the tool takes the usual platforms of the video's frame together (9:16: Reels, Stories, TikTok, Shorts, Facebook Reels; 4:5 and 1:1: the feeds; 16:9: YouTube and the feeds; a frame near one of these takes its numbers, any other the broadcast border). Say so in a sentence, and that naming the platform frees more of the frame. Pinterest, Snapchat and the full-screen views of LinkedIn and X are only in when named.
- What it prints, in px of the frame:
  - `safe`: the box for text, faces, the thing being shown, the logo.
  - `wide`: in a vertical video, the stretch above the buttons on the right that is clear across the frame: room for something wide at the top.
  - `captions`: where captions' lowest line ends and how wide they may be.
  - `covered`: each thing an app lays over the video. A background, a hand, the rest of a screen may run under it; nothing that must be read.
  - `cropped`: where a feed or a profile grid shows the video at another ratio (Instagram shows a reel at 4:5 in the feed, at 3:4 in the grid). What must be seen there (the face, the hook's words) stays inside.
  - `basis`: how sure the numbers are. Only Pinterest publishes numbers for organic posts; the rest are third-party guides or estimates. Say so when the person relies on them.
- **`check`** says of a box (a caption, a sticker, a shot) what leaves the safe box, what an app covers and what a feed cuts away. **`draw`** lays the zones over a frame of a video or an image (red: covered, green: safe, yellow: crops): look at it before you show the person, and show it when they ask what is covered.

## For another skill

Call it with `--json` and read `safe`, `wide`, `covers`, `crops`: `node <platform-zones>/tools/zones.mjs zones reels tiktok --size 1080x1920 --json`. Where the skill lives beside this one, `<platform-zones>` is `<skill>/../platform-zones`. Pass the platforms the person named, none when they named none; never copy the numbers into the skill.

## In the chat

Speak the person's language and keep it short: which platforms the zones are for, what of their frame is covered (with the drawn frame as an image), and what to move. Never put a path of your working files or a raw error into the chat.
