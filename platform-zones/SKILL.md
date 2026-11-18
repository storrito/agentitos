---
name: platform-zones
description: Shows what Instagram, TikTok, YouTube, Facebook, Snapchat, Pinterest, LinkedIn and X cover of a video per frame, the rules for placing text, captions, faces and Story stickers, and a layout check.
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

`<skill>` is the folder this file is in. Run `node <skill>/tools/zones.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Needs Node 20+; ffmpeg for `draw` and `--of <file>`; Chrome for `layout` on a page. No model, no key, no cost. Full reference, with every number's sources: [README.md](README.md).

## The zones

```
node <skill>/tools/zones.mjs list
node <skill>/tools/zones.mjs zones [platform…] (--of <video> | --size 1080x1920 | --frame 9:16) [--json]
node <skill>/tools/zones.mjs check <x,y,w,h> [platform…] (--of … | --size … | --frame …) [--json]
node <skill>/tools/zones.mjs draw <video|image> <out.png> [platform…] [--at <s>]
```

- **Name the platforms the video goes to** (`reels`, `story`, `tiktok`, `shorts`, `youtube`, `facebook-reels`, `pinterest`, `linkedin`, `x`, …; `list` names them all). Several give the zones of all together: inside the safe box is clear on each.
- **When the person did not say where it goes**, name none: the tool takes the usual platforms of the frame together and says which. Tell the person so in a sentence, and that naming the platform frees more of the frame. Pinterest, Snapchat and the full-screen views of LinkedIn and X are only in when named.
- What it prints, in px of the frame:
  - `safe`: text, faces, the thing shown and the logo stay inside.
  - `centred`: the safe box even about the frame's middle. Text, titles, cards and captions are laid out in it (its left and width, or the frame's middle and at most its width), never centred in `safe`: where an app has buttons on one side only (Reels, TikTok, Shorts), that looks off.
  - `wide`: in a vertical video, clear across the frame above the buttons on the right: room for something wide at the top.
  - `captions`: where captions' lowest line ends and how wide they may be.
  - `covered`: what each app lays over the video, the hard limit: nothing that must be read or tapped under it; a background, a hand, the rest of a screen may run under it. The safe box's margins beyond it are a buffer for other phones and app versions (the guides disagree by up to 200 px): reaching into it a little is fine when the layout needs it (centred, bigger).
  - `cropped`: where a feed or profile grid shows the video at another ratio (Instagram: a reel at 4:5 in the feed, 3:4 in the grid). What must be seen there (the face, the hook's words) stays inside.
  - `basis`: how sure the numbers are. Only Pinterest publishes numbers for organic posts; the rest are third-party guides or estimates: say so when the person relies on them.
- **`check`** says of a box (a caption, a sticker, a shot) what an app covers (✗), what only leaves the safe box into the buffer (!) and what a feed cuts away. **`draw`** lays the zones over a frame of a video or image (red: covered, green: safe, yellow: crops): look at it before you show the person, and show it when they ask what is covered.

## Laying out a frame

The numbers come from `zones` for the platforms the frame goes to. Read `<skill>/references/layouts.md` before laying out a frame, and adapt the pattern that matches the content (a talking head, a hook, a list, a product, a quote, a Story with a poll, …). Its pictures (`<skill>/examples/`) are for the person: show them when they choose a style.

- **Text centred on the frame:** titles, cards, quotes and captions on the frame's middle, at most `centred` wide. Only what belongs to one side (a corner label, a price tag beside a product, a name over its person) takes the safe box's edge.
- **Something wide at the top** (a hook, a screenshot, a chart, a headline): in `wide`, above the buttons, as wide as the frame allows there.
- **Captions:** lowest line on the safe box's bottom. Two people one above the other: on the seam between them. A picture or screen filling the top: between it and the face.
- **Faces:** eyes in the upper third of the frame; never text on a face (a name tag beside it or below the chin). A face stays inside the safe box; the body may run under the apps' bars.
- **Under what the apps cover:** only ground, texture, the rest of a picture.
- **No eyebrow:** a headline stands alone, without a small label above it ("NEW", "TIP", "DID YOU KNOW?", "NEW ON THE BLOG", "WE'RE HIRING", the brand's name). Only when it says what the headline does not and the viewer needs it first: a series' part ("Part 2/5"), an event's date or place, "Ad" where the law asks for it, the source of a quote or number. Label words worth saying go into the headline ("Now open in Berlin", not "NEW OPENING" over "Berlin").
- **Stickers on Stories:** Storrito puts Instagram's own stickers (link, poll, question, quiz, countdown, emoji slider, mention, hashtag, location) on any Story it schedules, picture or video, from any skill: `<insta-…>` elements in the story's HTML, at their place and size there ([Storrito's component reference](https://storrito.com/documentation/api/v1/story-components.md)). A Story keeps room for its sticker: a link at the bottom of the safe box below the call to action; a poll, question or countdown in the middle; never on text or a face; 40 px between stickers. Pills (link, mention, hashtag, location) are 177 px tall; polls, questions, quizzes, countdowns and sliders 690–820 px wide and 260–890 px tall. Reels, TikTok and the feeds have no stickers: a call to action there is text.

## Check a layout

```
node <skill>/tools/zones.mjs layout <page.html> [platform…] [--json]
node <skill>/tools/zones.mjs layout <boxes.json> [platform…] [--json]
```

For a page showing one frame (a story's HTML, a still, a card): Chrome measures every text by its letters, every `<insta-…>` sticker and every element marked `data-zone="face"` (mark the faces: no tool sees them). A page with `<insta-story>` is a Story unless platforms are named. For a film, measure inside your own page at its moment with `<skill>/tools/measure.js` (`await platformZonesMeasure()`) and pass the boxes as JSON.

Each finding names what is wrong and what to do.

- `✗` (what a viewer would see broken: under an app's buttons or bars, cut off or out of the frame, text on text, on a face or under a sticker, stickers on each other or without a size): fix every ✗ and check again.
- `!` (the safe box's margin, text centred in the safe box instead of on the frame, stickers closer than 40 px, text a feed's crop cuts, a sticker on a frame that is no Story): may stay when the layout needs it.

Text meant as texture (under the buttons on purpose) gets `data-zone="ignore"`.

## For another skill

Call it with `--json` and read `safe`, `centred`, `wide`, `covers`, `crops`: `node <platform-zones>/tools/zones.mjs zones reels tiktok --size 1080x1920 --json` (beside this skill, `<platform-zones>` is `<skill>/../platform-zones`). Pass the platforms the person named, none when they named none; never copy the numbers into the skill.

## In the chat

In rragent the chat is on the left, the artifacts beside it. Speak the person's language, keep it short: which platforms the zones are for, what of their frame is covered (with the drawn frame as an image), and what to move. Never a path of your working files or a raw error in the chat.
