# page-shot

A web page or a post on X as a picture: the one page capture of agentitos. [b-roll](../b-roll/) runs its tool as a program for the pages and posts a video talks about; other skills that need a picture of a page do the same instead of keeping their own.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/shot.mjs https://storrito.com shots/storrito.png                 # as a phone shows it
node tools/shot.mjs https://storrito.com shots/storrito.png --desktop       # as a laptop shows it
node tools/shot.mjs https://storrito.com shots/lower.png --from 640         # further down
node tools/shot.mjs https://x.com/jack/status/20 shots/post.png             # the post's card
```

Requirements: Node 20+ (22+ for what needs the DevTools protocol, below; the Sprites run 26), a Chrome: `CHROME`, one on the PATH (`google-chrome`, `chromium`, …), else the one HyperFrames renders with (`hyperframes browser path`). No npm packages.

## What it takes

- **A page** is taken as a phone shows it: 430 css px wide, its first 640 px (`--height` for more or less), at twice the density (`--scale`), with a phone's user agent. `--desktop` takes it as a laptop shows it: 1440 × 900. `--from` takes it that far down the page.
- **A post on X** (`x.com/…/status/…`, `twitter.com/…`) is taken through X's embed page (`platform.twitter.com/embed/Tweet.html`, no login), 550 css px wide on a transparent page, and cut to the card with a few pixels of air around it. A post that is gone or private draws nothing: the tool says so in a sentence.
- **Beside the picture**, `<file>.png.json`: `{url, kind: "page" | "post", credit, width, height, banner}`. `credit` is the source in a few words ("X / @jack", "spiegel.de"), for a skill that names it under the picture.

## How (`tools/lib/chrome.mjs`)

With Node 22 or later (its own WebSocket), Chrome is driven through its DevTools protocol:

- **One process**: Chrome starts headless with a debugging port and every frame in one process (`--disable-site-isolation-trials`), so that a banner's iframe from another site can be reached too.
- **Before the page loads**: the viewport and the user agent are a phone's or a laptop's, the page is told its visitor prefers reduced motion, and a post gets a transparent background.
- **The banner**: after the page has loaded, up to two rounds through every frame click the first accepting button. It is found by the usual banners' ids (OneTrust, Cookiebot, Usercentrics, Didomi, Sourcepoint, …) or by its words in eleven languages ("Alle akzeptieren", "Einwilligen und weiter", "Accept all", …, after story-from-link's). What is left of a banner (a fixed layer named so) is hidden, and the page may scroll again.
- **Animations and scrolling**: running animations play a hundred times as fast, so they are at their end. The page is scrolled to `--from` and given time to load what scrolling brings; then the visible part is taken.

Without a WebSocket, Chrome's own `--screenshot` takes the page as it first shows, with a banner and animations as they are, and the tool says so.

A site that blocks automated visits shows its notice (zeit.de does). The tool does not get round it: the agent sees the notice and asks the person for a screenshot.

## What it does not do (yet)

- **Posts of other networks**: only posts on X are taken as cards; for Instagram, TikTok or LinkedIn the person brings a screenshot.
- **A page behind a login**: no use of the person's own browser or cookies.
- **A whole long page in one picture**: it takes one screen, from `--from`.
