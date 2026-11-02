---
name: page-shot
description: A web page or a post on X as a picture (PNG), as a phone or a laptop shows it, with the cookie banner clicked away and animations at their end; a post as its card. Use when the person wants a screenshot of a page or a post, and as the page capture of other skills (b-roll, thumbnail-and-intro, …): they run its tool instead of keeping their own.
license: MIT
metadata:
  title: "Page shot"
  title-de: "Seiten-Screenshot"
  summary: "A picture of a web page or a post on X, as a phone shows it, without the cookie banner."
  summary-de: "Ein Bild einer Webseite oder eines Posts auf X, so wie ein Handy sie zeigt, ohne Cookie-Banner."
  ask: "Send me a link to a page or to a post on X. I take a picture of it as a phone shows it (or a laptop, if you say so), without the cookie banner."
  ask-de: "Schick mir einen Link zu einer Seite oder zu einem Post auf X. Ich mache ein Bild davon, so wie ein Handy sie zeigt (oder ein Laptop, wenn du das sagst), ohne Cookie-Banner."
  placeholder: "Paste a link"
  placeholder-de: "Link einfügen"
  inputs: ""
---

# page-shot

You run in rragent. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/shot.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+ (22+ to close cookie banners; the Sprites run 26) and a Chrome: the one HyperFrames renders with, or `CHROME`. Nothing to `npm install`. When something is missing, say so in one sentence instead of installing it yourself.

## The picture

```bash
node <skill>/tools/shot.mjs <url> shots/<name>.png                     # as a phone shows it
node <skill>/tools/shot.mjs <url> shots/<name>.png --desktop           # as a laptop shows it
node <skill>/tools/shot.mjs <url> shots/<name>.png --from 900          # further down the page
node <skill>/tools/shot.mjs https://x.com/<account>/status/<id> shots/<name>.png   # the post's card
```

- A page: 430 css px wide and its first 640 px (`--height` more or less), at twice the density; `--desktop` 1440 × 900. A cookie banner is clicked away, animations run to their end, `--from` scrolls there and waits for what scrolling loads.
- A post on X: its card, cut out on a transparent background. A post that is gone or private shows nothing, and the tool says so.
- Beside the picture, `<name>.png.json`: the link, `page` or `post`, the source in a few words for a credit ("X / @jack", "spiegel.de").

**Look at every picture** (`Read` it) before you use it or show it: a banner still in the way, a login wall, a site's notice that it blocks automated visits (zeit.de does), an empty or half-drawn page. Take it again (`--from`, `--desktop`, `--height`), or ask the person for a screenshot. Never get round a site that blocks automated visits. A post on Instagram, TikTok or LinkedIn: ask for a screenshot.

## For another skill

A skill runs the tool as a program, never imports its code: `PAGE_SHOT` naming `tools/shot.mjs`, else `<skill>/../page-shot/tools/shot.mjs` beside it, else `/home/sprite/skills/page-shot/tools/shot.mjs`. It reads the PNG and its `.png.json`; the tool's one line on stdout says what it took, with exit 1 the error in one sentence. Without the tool such a skill says: "Pictures of pages and posts need agentitos' page-shot skill beside this one (or PAGE_SHOT naming its tools/shot.mjs)."

## In the chat

Speak the person's language and keep it short: the picture, and a sentence of what it shows (a phone's view, the post's card, the banner closed). A picture of someone else's page or post is a quote: when the person publishes it, its source goes with it. Never put a token, a path of your working files or a raw error into the chat.
