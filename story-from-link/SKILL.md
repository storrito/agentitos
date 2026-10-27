---
name: story-from-link
description: Turn a link (a blog post, a product, an event, any page) into an Instagram Story of a few frames in the brand's own look, with a link sticker back to the page; agree on it with the person in the chat, then schedule it through Storrito or save it as a draft. Use for story sequences from articles, product launches, offers, events and announcements.
license: MIT
metadata:
  title: "Story from a link"
  title-de: "Story aus einem Link"
  summary: "A story from a link: a few frames in your brand's look, with a link sticker, scheduled on your Instagram."
  summary-de: "Eine Story aus einem Link: ein paar Frames im Look deiner Marke, mit Link-Sticker, auf deinem Instagram eingeplant."
  ask: "Paste a link: a blog post, a product, an event. I make an Instagram Story of a few frames in your brand's look, with a link sticker back to the page, and schedule it once you like it."
  ask-de: "Füge einen Link ein: einen Blogartikel, ein Produkt, ein Event. Ich mache daraus eine Instagram-Story aus ein paar Frames im Look deiner Marke, mit Link-Sticker zur Seite, und plane sie ein, sobald sie dir gefällt."
  placeholder: "Paste a link"
  placeholder-de: "Link einfügen"
  inputs: "image"
---

# story-from-link

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
```

It needs Node 20+, agentitos' `platform-zones` skill beside this one (where Instagram covers a story) and Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH), and the network: the page, Google Fonts, Storrito. When something is missing, say so in one sentence instead of installing it yourself.

## The main use: a story from a link, all in the chat

The person pastes a link. You read the page, settle the brand once, write the story, show its frames, agree on the account and the time, and only then schedule it. Each step ends with a question in the chat; the answer starts the next. Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Decide small things yourself and say what you decided.

Your files: `work/<name>/` for this story (`<name>` a short slug of the page), `brand/` for the brand kit, which stays for every later story. The only artifact is the preview `artifacts/story-<name>.html`; pictures for the chat go to `uploads/`.

### 1. The page

Say in one sentence that you are reading the page. Then

```bash
node <skill>/tools/page.mjs <url> work/<name>
```

prints what the page is (an article, a product, an event), its facts (price, date, place), its pictures and its look, and writes `work/<name>/text.txt`, the main text. Read the text (of a long one, what you need) and look at the pictures you might use: avoid pictures with text or other brands' logos in them; a picture over a whole frame needs 1080 px of width or more.

### 2. The brand, once

- `brand/DESIGN.md` exists (an earlier story, or the brand-kit skill made it): take it. Say nothing about it, unless this is the first story.
- Else, when the page is the person's own site, `node <skill>/tools/brand.mjs draft work/<name> brand`. When it is not (a press article about them, a partner's event page), ask for their website once, read it with `page.mjs <their url> work/site` and draft from `work/site`.
- `node <skill>/tools/brand.mjs show brand` prints a hiccup block with the logo, the colours and the font. Show it and ask once whether this is their brand.
- A change: edit the front matter of `brand/DESIGN.md` (`colors`, `typography`, `logo`), then `node <skill>/tools/brand.mjs check brand`. Another logo: the candidates are in `work/<name>/logos/` (show them as tiles); one they attach, copy it to `brand/logo.png` and set `logo.primary: logo.png`. A font: one of Google Fonts by its name with `fonts: {<family>: google}`.

### 3. The story

Write `work/<name>/story.json`. A good story:

- has **3 to 7 frames, one idea each**. Frame 1 is the hook: a promise, a surprise or a question in under 40 characters, not the page's title as it stands. The last frame is the call to action with the link sticker;
- has **10 to 25 words per frame**: a frame shows for 5 seconds. Short words, nothing twice;
- takes **facts from the page only**: prices, dates and numbers exactly as written there; never invent a quote, a rating or a number;
- is in the page's language, unless the person wants another;
- uses the page's pictures (or ones the person attaches). In rragent the `image` tool can make a picture a frame needs; then give that frame `"aiImage": true`, so that Instagram labels the story as made with AI;
- may ask something in the middle: a poll or a question sticker gets taps, and taps get the story shown to more people. One interactive sticker per frame at most.

```json
{
  "link": "https://example.com/products/berry",
  "lang": "de",
  "frames": [
    {"kind": "cover", "title": "Weniger Zucker. *Volle Beeren.*", "image": "images/07.png"},
    {"kind": "product", "title": "Bio Berry Müsli", "price": "9,95 €", "badge": "–30 % Zucker", "image": "images/01.png", "theme": "light"},
    {"kind": "list", "title": "Was drin ist", "items": ["Erdbeeren", "Himbeeren", "Knuspriger Hafer"], "marks": "check"},
    {"kind": "stat", "value": "30 %", "title": "weniger Zucker", "stickers": [{"type": "poll", "question": "Schon probiert?", "options": ["Ja", "Noch nicht"], "color": "pink"}]},
    {"kind": "cta", "title": "Jetzt *probieren*", "image": "images/08.png", "stickers": [{"type": "link", "text": "Zum Müsli"}]}
  ]
}
```

| kind | fields | for |
| --- | --- | --- |
| `cover` | `title`, `image`, `kicker` (rarely: only what the title does not say and the viewer needs first, e.g. a date or "Part 2/5"; never "New", "Tip" or the brand) | the hook |
| `text` | `title`, `body`, `number` ("02") | one point |
| `list` | `title`, `items` (2–5), `marks: "check"` | steps, contents, reasons |
| `quote` | `quote`, `author`, `role`, `image` (a portrait) | a voice, a review |
| `stat` | `value` ("87 %"), `title` (what it means), `source` | a number |
| `image` | `image`, `title`, `body` | a picture that tells |
| `product` | `image` (a product shot, best without background), `title`, `price`, `badge` | a product |
| `event` | `date` (ISO with offset), `timeZone`, `title`, `body` ("18:00 · Place") | an event |
| `cta` | `title`, `body`, `image` (a small teaser), `stickers` with the link | the call to action |

Every frame may have `theme` (`brand`, `light`, `dark`, `photo`; left out, a cover with a picture is `photo`, the call to action `brand`, the rest take turns), `image` (relative to `work/<name>/`, or `uploads/…`), `focus` (the part of the picture to keep, `"center 30%"`), `align` (`top`, `center`, `bottom`), `logo` (shown on the cover and the call to action unless `false`) and `stickers`. `*Words in stars*` stand out in the accent colour.

| sticker | fields |
| --- | --- |
| `link` | `text` (1–3 words: "Read more", "Zum Shop"), `url` (the story's `link` when left out) |
| `poll` | `question`, `options` (2–4), `color`: black pink lavender purple orange green blue |
| `question` | `question`, `color` (as poll, or white) |
| `quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`), `color`: black white purple red orange yellow green blue |
| `slider` | `question`, `emoji` |
| `mention`, `hashtag`, `location` | `username`, `hashtag`, `location` |

### 4. The frames

Say in one sentence that you are making the frames. Then

```bash
node <skill>/tools/story.mjs build work/<name>
```

renders every frame in Chrome with the brand's fonts and Storrito's own stickers (a few seconds), prints a line per frame with its picture for the chat (`uploads/story-<name>/<build>/NN.jpg`, a new folder per build) and what a viewer would notice: fix every ✗ in `story.json` and build again; fix a ⚠ unless you have a reason not to. The preview beside the chat shows the frames side by side. Look at one or two of the pictures yourself for what no check sees (a face cut off, a picture that does not fit the words). Then show them in the chat as a row of pictures with "Looks good" and "Change something". A change: edit `story.json`, build again.

### 5. Where and when

Ask one thing per message, and only what has more than one answer:

- **The account.** `node <skill>/tools/story.mjs accounts` lists the Instagram accounts that take stories, with their Facebook pages. One account: take it. Several: checkboxes and one button. None, or one marked disconnected: `create-connect-link` of Storrito's procedures makes a link (`[:a {:href …} "Connect Instagram"]`); ask them to say when they are done.
- **The time.** Buttons for the likely ones ("Now", "Today 18:00", "Tomorrow 9:00"), none marked; they may type another. Ask for the time zone only when you cannot tell (German speaks for Europe/Berlin).
- **Facebook**, only when the account has a Facebook page: whether the story goes there too.
- Instead of scheduling they may want a **draft**: it lands in Storrito's gallery, where they can change it in the editor and schedule it themselves.

### 6. Schedule

Only after their "yes":

```bash
node <skill>/tools/story.mjs publish work/<name> --account <username> --at 2026-10-22T18:00:00+02:00 [--facebook]
node <skill>/tools/story.mjs publish work/<name> --account <username> --now
node <skill>/tools/story.mjs publish work/<name> --draft
```

uploads the frames and schedules them in their order (Instagram shows them one after another), on several accounts with `--account a,b`. It is safe to run again: what is done stays done, nothing posts twice. Then

```bash
node <skill>/tools/story.mjs status work/<name> --wait 120
```

shows what Storrito rendered of each frame (`rendered …`, a picture); it must look like the preview. Tell the person in one or two sentences what is scheduled when and where; show the rendered pictures only when they ask. A failure: say which frame and why in one sentence. `story.mjs cancel work/<name>` takes the story back; to change a scheduled story: cancel, change, build, publish.

The tools reach Storrito by themselves through the machine's gateway (rragent on a Sprite) or with `STORRITO_API_URL` and `STORRITO_CREDENTIAL`. When `publish` says it cannot reach Storrito, use Storrito's procedures yourself, in the frames' order, as it explains: in rragent they are functions of your REPL (`(storrito/create-temp-blob-upload-url {…})`, `(doc storrito/schedule-instagram-story)`), elsewhere the Storrito tools of the same names.

### 7. The next link

The brand stays in `brand/`. Remember the account and the usual time (rragent: `remember`), and for the next link ask only what changed.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/story-<name>.html"` shows the preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a time or a name they type.

- One question per block, buttons for the likely answers, and a hint that they can type anything else.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain.
- A button's text says what happens; its `:send` reads as the person's answer ("The story is good", "Post it tomorrow at 9:00").
- Never put a token, an id the person does not need or a raw error into the chat.

The frames:

```hiccup
[:div
 [:div {:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(96px, 1fr))" :gap "8px"}}
  [:img {:src "uploads/story-berry/mvhv2k1q/01.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/story-berry/mvhv2k1q/02.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/story-berry/mvhv2k1q/03.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]]
 [:p "Five frames, the link sticker on the last one. Good like this?"]
 [:button {:class "primary" :send "The story is good"} "Looks good"] " "
 [:button {:send "I want to change something in the story"} "Change something"] " "
 [:button {:open "artifacts/story-berry.html"} "Show them large"]]
```

The time:

```hiccup
[:div
 [:p "When should it go out on @mymuesli?"]
 [:button {:send "Post it now"} "Now"] " "
 [:button {:send "Post it today at 18:00"} "Today 18:00"] " "
 [:button {:send "Post it tomorrow at 9:00"} "Tomorrow 9:00"] " "
 [:button {:send "Save it as a draft in Storrito"} "As a draft"]
 [:p [:small "Or type another time."]]]
```

## Rules

- Only what the page says: no invented price, date, quote, rating or number.
- Pictures from the person's own site are theirs to use; for pictures of others, say once before scheduling that they need the right to use them.
- One link sticker per story is enough, on the last frame; stickers never lie under Instagram's bar or reply field, on text or on each other (the build checks every frame with platform-zones' layout check: ✗ under or on top, ⚠ in the safe zone's margin or closer than 40 px).
- Change `story.json` or `brand/DESIGN.md` and build again; never edit the built frames by hand.
