# story-from-link

Turns a link (a blog post, a product, an event, any page) into an **Instagram Story of a few frames** in the brand's own look, with a **link sticker** back to the page, and schedules it through [Storrito](https://storrito.com/).

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
npm install
node tools/page.mjs https://www.example.com/blog/post work/post   # what the page says, its pictures, its look
node tools/brand.mjs draft work/post brand                          # a first brand kit from that look
# write work/post/story.json (see below)
node tools/story.mjs build work/post                                # the frames, checked; preview in artifacts/
node tools/story.mjs publish work/post --account mybrand --at 2026-10-22T18:00:00+02:00
node tools/story.mjs status work/post --wait 120                    # what Storrito rendered
```

Requirements: Node 20+, agentitos' [platform-zones](../platform-zones/) beside this skill (where Instagram covers a story), Chrome (`CHROME`, or `google-chrome` / `chromium` on the PATH), network access to the page, Google Fonts and Storrito.

## How it works

1. **`page.mjs`** opens the page in headless Chrome, accepts the cookie banner, and reads
   - the main text with Mozilla's [Readability](https://github.com/mozilla/readability) (`text.txt`),
   - the facts of its schema.org data: a product's price and availability, an event's date and place, an article's author and date,
   - its pictures (`og:image`, the article's, the biggest shown), downloaded to `images/`,
   - its look: the colours weighted by where they are used (logo, buttons, links, headings, large areas), the fonts by role (the font most large text is set in, the body text's, the buttons'), where each font comes from (Google Fonts, or the site's own files), the logo candidates (scored like [dembrandt](https://github.com/dembrandt/dembrandt) does: in the header, linked home, named "logo", partner rows left out; inline SVGs kept as SVG files), the social profiles linked from the page.
2. **`brand.mjs`** turns that look into a brand kit: a [DESIGN.md](https://github.com/google-labs-code/design.md) with the tokens in its front matter, the logo and the font files beside it (see "The brand kit").
3. **`story.mjs build`** renders each frame of `story.json` as a 1080×1920 page in Chrome: a layout of the frame's kind in the brand's colours and fonts, every text shrunk step by step until it fits, the stickers drawn by Storrito's own components (`/js/insta-components.js` of the organization's host). It then measures where each sticker sits and takes two pictures: what a viewer sees (small, for the chat and the preview) and the frame without its stickers, which is what gets uploaded. Instagram draws the stickers itself, so they stay tappable.
4. **`story.mjs publish`** uploads each frame's picture as a Storrito temp-blob and schedules the frames in their order with `schedule-instagram-story` (or `create-draft`). The HTML of a frame is its picture plus the stickers at the measured positions, so Storrito's extraction finds them exactly where the preview had them; the posting order is the scheduled time, then the order of creation, so frames scheduled for the same time go out one after another.

The checks of a build: text that does not fit, text over a picture with too little contrast, pictures enlarged so far that they blur, stickers outside Instagram's safe zone (from agentitos' [platform-zones](../platform-zones/), which must be beside this skill: 250 px at the top, 300 px at the bottom, 60 px at the sides) or overlapping, more than one link or interactive sticker in a frame, frames with too many words for five seconds, a cover title over 40 characters, a story without a link sticker.

## The brand kit

A folder with a `DESIGN.md` in Google's [DESIGN.md format](https://github.com/google-labs-code/design.md) (Apache-2.0): YAML front matter with the design tokens, then prose. Other tools read the same file: HyperFrames takes `DESIGN.md` as its design spec, and the [brand-kit](../brand-kit/) skill writes a fuller one (voice, audience, do's and don'ts). On top of the format a kit uses four keys of its own, which the format allows:

```yaml
---
version: alpha
name: mymuesli
colors:
  primary: "#DD004F"       # the brand colour: the cover, the call to action, highlights
  secondary: "#FE94AF"     # optional: highlights on the brand colour
  tertiary: "#E20000"      # optional
  surface: "#FFFFFF"       # the light ground
  on-surface: "#0B0B0B"    # the text on the light ground, and the dark ground
  on-primary: "#FFFFFF"    # the text on the brand colour
typography:
  headline-display: {fontFamily: Adobe Futura Std, fontWeight: 700, lineHeight: 1.1}
  body-md: {fontFamily: Work Sans, fontWeight: 400}
  label-md: {fontFamily: Work Sans, fontWeight: 600}
rounded: {md: 16px}
uppercase: [label-md]                     # the typography tokens set in capitals
logo: {primary: logo.jpg, on-dark: logo-white.svg}
fonts:                                    # where each family's files come from
  Work Sans: google
  Adobe Futura Std: [{file: fonts/adobe-futura-std-700.woff2, weight: 700}]
social: {instagram: mymuesli, website: https://www.mymuesli.com}
---
```

The frames take the display font from `headline-display` (else `display`, `headline-lg`, `h1` …), the body font from `body-lg`/`body-md`/`body`, the kicker's from `label-md`/`label`, and the corner radius from `rounded.lg`/`md`. A logo that does not read on a frame's ground is shown white or black when it has one colour, its `on-dark` version when there is one, else on a white chip; a logo with a ground of its own (a box) stays as it is. Fonts taken from a site's files are the brand's own web fonts: whether their licence covers pictures is the brand's to know; a Google font by its name always works.

## story.json

```json
{
  "link": "https://www.example.com/products/berry",
  "lang": "de",
  "frames": [
    {"kind": "cover", "kicker": "Neu", "title": "Weniger Zucker. *Volle Beeren.*", "image": "images/07.png"},
    {"kind": "product", "title": "Bio Berry Müsli", "price": "9,95 €", "badge": "–30 % Zucker", "image": "images/01.png", "theme": "light"},
    {"kind": "cta", "title": "Jetzt *probieren*", "stickers": [{"type": "link", "text": "Zum Müsli"}]}
  ]
}
```

Kinds: `cover`, `text`, `list`, `quote`, `stat`, `image`, `product`, `event`, `cta`; fields per kind and the stickers (`link`, `poll`, `question`, `quiz`, `countdown`, `slider`, `mention`, `hashtag`, `location`) in [SKILL.md](SKILL.md#3-the-story). Themes: `brand` (the brand colour), `light` (the surface), `dark` (the on-surface colour as ground), `photo` (the frame's picture over the whole frame, darkened towards the text).

## Files

```
work/<name>/page.json      the page: kind, facts, pictures, look
work/<name>/text.txt       its main text
work/<name>/images/        its pictures; logos/ the logo candidates; page.png the top of the page
work/<name>/story.json     the story (written by the agent)
work/<name>/frames/NN.png  each frame without its stickers: what is uploaded
work/<name>/frames.json    each frame's stickers, their positions and the HTML for Storrito
work/<name>/plan.json      what was uploaded and scheduled, with the UUIDs that make a retry safe
uploads/story-<name>/<build>/NN.jpg   the frames as a viewer sees them, for the chat (a folder per build)
artifacts/story-<name>.html   the preview beside the chat
brand/DESIGN.md (+ logo, fonts/)   the brand kit
```

## Reaching Storrito

The tools call Storrito's API themselves: on a [Sprite](https://sprites.dev) through the sprite's gateway (`http://sprite.internal/v1/gateway/list` names the organization's Storrito connection, a custom API on its `storrito.com` host; the gateway adds the credential), elsewhere with `STORRITO_API_URL` (`https://<org>.storrito.com`) and `STORRITO_CREDENTIAL` (`<id>:<secret>`). Without either, `publish` says how to call the procedures by hand: `create-temp-blob-upload-url`, a `PUT` of the picture, then `schedule-instagram-story` with the frame's HTML from `frames.json`, its `{{BACKGROUND}}` replaced by the temp-blob's URL.

## Limits

- Image stories: a frame shows for five seconds; there is no motion yet.
- Instagram only: the interactive stickers exist only there. With `--facebook` the story is cross-posted to the account's Facebook page as Storrito does it.
- A page behind a login or a bot wall cannot be read; the person can paste the text and attach the pictures instead.
