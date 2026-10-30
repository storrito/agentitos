# story-stickers

A picture or a video as an Instagram Story with Instagram's own stickers: link, poll, question, quiz, countdown, emoji slider, mention, hashtag and location, tappable, exactly where the person saw them. A picture is laid out on the 9:16 Story in HTML (filled when it is nearly 9:16, else centred over a blurred enlargement of itself), a video is rendered without stickers; [Storrito](https://storrito.com/) renders the Story from that HTML, lays its sticker components over it when it publishes, and Instagram gets them as real stickers.

> Agents: start with [`SKILL.md`](SKILL.md).

This skill has no tools. Everything it needs lives in Storrito, so that every agent (rragent's REPL, an MCP client, a script) gets the same rules:

1. **The layer**: one `<insta-…>` element per line in `stickers/<name>/layer.html`, each placed by its centre: `position:absolute;left:<x>px;top:<y>px;width:max-content;transform:translate(-50%,-50%) [rotate] [scale]`. Storrito takes the box the browser shows, so a sticker placed by its centre lands exactly there (checked against a measured `left`/`top` placement: the same design to half a pixel). `width:max-content` keeps a sticker's natural size; without it one at `left:540px` is laid out in the 540 px right of it.
2. **The check**: Storrito's `check-instagram-story` (in rragent `storrito/check-instagram-story`) renders the HTML as `schedule-instagram-story` would, without posting or saving anything: each sticker's box, the warnings (outside the safe zone, overlapping, squeezed, unknown attributes, CSS the story cannot show) and a `previewUrl`, a picture of the Story with its stickers and the video's first frame.
3. **The preview**: a HyperFrames scene with the same lines, loading Storrito's components, mounted over the film with `data-preview-only`. rragent's render leaves such elements out of the video.
4. **A picture**: uploaded with `create-temp-blob-upload-url`, laid out in the Story's HTML (two `<img>`: a blurred `object-fit:cover` enlargement and the picture across the width; or one filling the frame), checked like the stickers and scheduled with `schedule-instagram-story` from the REPL, a UUID per frame and account remembered before, so that a retry posts nothing twice. Checked against Storrito: a 1920×1080 photo with a line of text and a link sticker renders in the draft exactly as the check's picture.
5. **Publishing a video**: agentitos' [publish-video](../publish-video/) with `--stickers stickers/<name>/layer.html` puts the lines inside the `<insta-story src="…">` of each Instagram Story target (not of Reels or other platforms) and counts them in the post's version.

Requirements: Storrito reachable from the agent (on a [Sprite](https://sprites.dev) the gateway's Storrito connection), a Storrito with `check-instagram-story` (older ones: `create-draft` and `status-draft` for the picture), publish-video beside this skill to publish, and for the preview the network (the components come from Storrito).

## Limits

- A sticker shows for the whole Story; there is no sticker that comes in later.
- The film's own text and faces under a sticker are not measured: the agent looks at Storrito's picture.
