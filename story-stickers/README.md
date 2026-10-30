# story-stickers

Instagram's own stickers on a video Story: link, poll, question, quiz, countdown, emoji slider, mention, hashtag and location, tappable, exactly where the person saw them. The video is rendered without stickers; [Storrito](https://storrito.com/) lays its sticker components over it when it publishes the Story, and Instagram gets them as real stickers.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/stickers.mjs layer stickers/launch/stickers.json                    # layer.html, each sticker placed by its centre, no browser
node tools/stickers.mjs check stickers/launch                                  # Storrito's check-instagram-story: boxes and warnings
node tools/stickers.mjs mount stickers/launch artifacts/launch/composition     # over the film in the preview, data-preview-only
node tools/stickers.mjs unmount artifacts/launch/composition                   # only before a render that keeps data-preview-only (CLI, Studio)
node tools/stickers.mjs build stickers/launch/stickers.json --video launch.mp4 # over the finished video's frames, in Chrome
node ../publish-video/tools/publish.mjs publish publish/launch --to instagram/<account>/story --now \
  --stickers stickers/launch/layer.html
```

Requirements: Node 20+ and the network for `layer`, `check` and `mount`; `build` also ffmpeg, Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH) and `npm install` (puppeteer-core). agentitos' [platform-zones](../platform-zones/) beside this skill (`PLATFORM_ZONES` may name its `tools/zones.mjs`) for where Instagram covers a Story, [publish-video](../publish-video/) to publish. Storrito's components come from the organization's host (on a [Sprite](https://sprites.dev) the gateway's Storrito connection; elsewhere `STORRITO_API_URL`), else from the host Storrito's documentation loads them from.

## How it works

1. **`stickers.json`** names each sticker with its attributes and its centre (`x`, `y` in px of 1080×1920), optionally `rotate` and `scale`.
2. **`layer`** writes `layer.html`: one `<insta-…>` per line, `position:absolute;left:<x>px;top:<y>px;width:max-content;transform:translate(-50%,-50%) [rotate] [scale]`. Storrito takes the box the browser shows, so a sticker placed by its centre lands exactly there (checked against the measured `left`/`top` form: the same design to half a pixel). `width:max-content` keeps a sticker's natural size; without it, one at `left:540px` is laid out in the 540 px right of it (a poll at 70 %).
3. **`check`** sends `<insta-story [src]>` with the layer to Storrito's `check-instagram-story`: the extraction of `schedule-instagram-story` without posting or saving, each sticker's box, the warnings (overlaps, unknown attributes, CSS the story cannot show) and stickers outside Instagram's safe zone. An agent without the tools calls the same procedure from rragent's REPL.
4. **`mount`** writes `compositions/story-stickers.html` into a HyperFrames project: the layer in a scene that loads Storrito's components from the organization's host, and its host element in `index.html`, marked with a comment and `data-preview-only`, over the whole film. rragent's render leaves such elements out; `unmount` removes the host for a render that does not.
5. **`build`** opens the layer in a 1080×1920 `<insta-story>` page with Storrito's components in Chrome, measures the boxes, runs platform-zones' layout check for `instagram-story` and takes pictures for the chat: over frames of `--video` (taken with ffmpeg) or over a dark ground.
6. **publish-video `--stickers <layer.html>`** puts the layer inside the `<insta-story src="…">` of each Instagram Story target (not of Reels or other platforms), and counts it in the post's version: a Story scheduled with other stickers is refused until it is cancelled.

Storrito renders the Story's preview and the posted video from the same components, so the pictures of `build` and the Studio preview are what the Story will look like (checked against Storrito's own render of the same layer).

## Limits

- A sticker shows for the whole Story; there is no sticker that comes in later.
- The film's own text and faces under a sticker are not measured: the agent looks at the pictures.
- The preview needs the network for the components; the render does not need them.
