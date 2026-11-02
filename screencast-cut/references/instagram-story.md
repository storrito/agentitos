# screencast-cut: Instagram Story stickers

When one of the targets is an Instagram Story and the person picked a sticker (a link to the page, a poll, a question, a countdown), follow agentitos' **story-stickers** (`<skill>/../story-stickers/SKILL.md`, on a Sprite else `/home/sprite/skills/story-stickers/SKILL.md`):

- the stickers as Storrito's elements in `stickers/<name>/layer.html`;
- in the preview as a `data-preview-only` scene mounted at the start;
- the band checked with `hyperframes check --caption-zone` (and on the rendered video's moments where footage you do not know runs under it);
- published with publish-video's `--stickers`.

Keep a band free for them in the film, planned with the scenes: a link sticker needs about 180 px of height, a poll about 570. For the whole length nothing in it that the viewer must see or read (no text or captions, no face, no product, no logo, no content); background, texture and decorative motion may lie behind the stickers. The stickers go into a flexbox over that band.
