# story.json: frame kinds, frame fields, stickers

`work/<name>/story.json` holds the story's `link`, its `lang` and its `frames`, in order. `story.mjs build work/<name>` renders it.

## Frame kinds

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

## Fields of every frame

- `theme`: `brand`, `light`, `dark`, `photo`. Left out, a cover with a picture is `photo`, the call to action `brand`, the rest take turns.
- `image`: relative to `work/<name>/`, or `uploads/…`.
- `focus`: the part of the picture to keep, `"center 30%"`.
- `align`: `top`, `center`, `bottom`.
- `logo`: shown on the cover and the call to action unless `false`.
- `aiImage`: `true` when the frame's picture was made with the `image` tool (Instagram then labels the story as made with AI).
- `stickers`: a list, see below.

`*Words in stars*` stand out in the accent colour.

## Stickers

| sticker | fields |
| --- | --- |
| `link` | `text` (1–3 words: "Read more", "Zum Shop"), `url` (the story's `link` when left out), `design`: default gray black rainbow |
| `poll` | `question`, `options` (2–4), `color`: black pink lavender purple orange green blue |
| `question` | `question`, `color` (as poll, or white) |
| `quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`), `color`: black white purple red orange yellow green blue |
| `slider` | `question`, `emoji` |
| `mention`, `hashtag`, `location` | `username`, `hashtag`, `location`; `design`: default gray rainbow (location also black, orange) |

A sticker's look: `default`, unless it sits on something very bright (then `black` or `gray`); `rainbow` only for playful content; a poll's or question's `color` is the Instagram colour nearest the brand's primary colour.
