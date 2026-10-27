---
name: platform-zones
description: Where Instagram (Reels, Stories, feed), TikTok, YouTube (Shorts and videos), Facebook (Reels, Stories, feed), Snapchat, Pinterest, LinkedIn and X lay their buttons, names and captions over a video, per frame (9:16, 4:5, 1:1, 16:9): the box that stays clear for text, faces and what is shown, what each app covers, and where a feed or a profile grid shows the video cut to another ratio. When the person did not say where the video goes, the usual platforms of its frame together. Use before placing text, captions, a face or a screen in a video for social media, to check a finished frame, and as the zones step of other skills (captions, screencast-cut, kinetic-lyrics, story-from-link): they call its tool. Also the rules for laying out a frame (text centred on the frame, captions, faces, Instagram's stickers on Stories through Storrito) and a check of a laid-out page (text under the buttons, on a face or on other text, cut off, stickers on each other).
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

Node 20+; ffmpeg for `draw` and for `--of <file>`; Chrome for `layout` on a page. No model, no key, no cost.

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
  - `centred`: the safe box made even about the frame's middle. Text, a title, a card and captions are centred on the frame, not in the safe box: where an app has buttons on one side only (Reels, TikTok, Shorts), the safe box's middle lies left of the frame's, and text centred in it looks off. Lay them out in `centred` (its left and width, or the frame's middle and at most its width).
  - `wide`: in a vertical video, the stretch above the buttons on the right that is clear across the frame: room for something wide at the top.
  - `captions`: where captions' lowest line ends and how wide they may be.
  - `covered`: each thing an app lays over the video. A background, a hand, the rest of a screen may run under it; nothing that must be read.
  - `cropped`: where a feed or a profile grid shows the video at another ratio (Instagram shows a reel at 4:5 in the feed, at 3:4 in the grid). What must be seen there (the face, the hook's words) stays inside.
  - `basis`: how sure the numbers are. Only Pinterest publishes numbers for organic posts; the rest are third-party guides or estimates. Say so when the person relies on them.
- **How strict.** What an app covers (`covered`) is the hard limit: nothing that must be read or tapped lies under it. The safe box's margins beyond that are a buffer the guides keep for other phones and app versions: something reaching into it a little is fine, when the layout needs it (centred, bigger). No platform publishes numbers for organic posts; the guides disagree by up to 200 px.
- **`check`** says of a box (a caption, a sticker, a shot) what an app covers (✗), what only leaves the safe box into the buffer (!) and what a feed cuts away. **`draw`** lays the zones over a frame of a video or an image (red: covered, green: safe, yellow: crops): look at it before you show the person, and show it when they ask what is covered.

## Laying out a frame

What to place where, whatever the frame shows. The numbers come from `zones` for the platforms it goes to.

- **Text centred on the frame:** titles, cards, quotes and captions sit on the frame's middle, at most `centred` wide. Only what belongs to one side (a label in a corner, a price tag beside a product, a name over its person) takes the safe box's edge.
- **Something wide at the top:** a hook, a screenshot, a chart, a headline goes into `wide`, above the buttons; it is as wide as the frame allows there.
- **Captions:** their lowest line on the safe box's bottom. Two people one above the other: on the seam between them. A picture or a screen filling the top: between it and the face.
- **Faces:** the eyes in the upper third of the frame; text never on a face (a name tag beside it or below the chin). A face stays inside the safe box; the body may run under the apps' bars.
- **Under what the apps cover:** only ground, texture, the rest of a picture.
- **Stickers on Stories.** Storrito puts Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location) on any Story it schedules, a picture or a video, made by any skill: they are `<insta-…>` elements in the story's HTML, at the place and in the size they have there ([Storrito's component reference](https://storrito.com/documentation/api/v1/story-components.md)). So a Story keeps room for its sticker where it belongs: a link at the bottom of the safe box below the call to action, a poll, a question or a countdown in the middle, never on text or a face, 40 px between stickers. Pills (link, mention, hashtag, location) are 177 px tall; polls, questions, quizzes, countdowns and sliders 690–820 px wide and 260–890 px tall. Reels, TikTok and the feeds have no stickers: a call to action there is text.

## Check a layout

```
node <skill>/tools/zones.mjs layout <page.html> [platform…] [--json]
node <skill>/tools/zones.mjs layout <boxes.json> [platform…] [--json]
```

For a page that shows one frame (a story's HTML, a still, a card): Chrome opens it and measures every text by its letters, every `<insta-…>` sticker, and every element marked `data-zone="face"` (mark the faces: no tool sees them). A page with `<insta-story>` is a Story unless platforms are named. For a film, measure inside your own page at its moment with `<skill>/tools/measure.js` (`await platformZonesMeasure()`) and pass the boxes as JSON.

- `✗`: text, a sticker or a face under an app's buttons or bars; text cut off or out of the frame; text on text, on a face, under a sticker; stickers on each other, or one without a size. Fix every ✗ and check again.
- `!`: something in the safe box's margin; text centred in the safe box instead of on the frame; stickers closer than 40 px; text a feed's crop cuts; a sticker on a frame that is no Story. It may stay when the layout needs it.

Text meant as texture (under the buttons on purpose) gets `data-zone="ignore"`.

## For another skill

Call it with `--json` and read `safe`, `centred`, `wide`, `covers`, `crops`: `node <platform-zones>/tools/zones.mjs zones reels tiktok --size 1080x1920 --json`. Where the skill lives beside this one, `<platform-zones>` is `<skill>/../platform-zones`. Pass the platforms the person named, none when they named none; never copy the numbers into the skill.

## In the chat

Speak the person's language and keep it short: which platforms the zones are for, what of their frame is covered (with the drawn frame as an image), and what to move. Never put a path of your working files or a raw error into the chat.
