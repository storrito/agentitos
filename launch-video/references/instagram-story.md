# An Instagram Story in a launch video

When one of the film's targets is an Instagram Story, it can carry Instagram's own stickers: a link to the page, a poll, a question, a countdown. The person has picked one (or "none").

## Building the stickers

Follow agentitos' **story-stickers** (`<skill>/../story-stickers/SKILL.md`, on a Sprite else `/home/sprite/skills/story-stickers/SKILL.md`):

- the stickers as Storrito's elements in `stickers/<name>/layer.html`;
- in the preview as a `data-preview-only` scene mounted at the start;
- the band checked with `hyperframes check --caption-zone` (and on the rendered video's moments where footage you do not know runs under it);
- published with publish-video's `--stickers`.

## The band in the film

- Keep a band free for them in the film, planned with the scenes (a link sticker needs about 180 px of height, a poll about 570).
- For the whole length nothing in that band that the viewer must see or read: no text or captions, no face, no product, no logo, no content. Background, texture and decorative motion may lie behind the stickers.
- The stickers go into a flexbox over that band.
- Never draw a sticker, a "link in bio" or an arrow to a link into the Story's video: Storrito lays the real stickers over it, and Instagram makes them tappable.
