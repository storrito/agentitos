# story-stickers

Instagram's own stickers on a video Story: link, poll, question, quiz, countdown, emoji slider, mention, hashtag and location, tappable, exactly where the person saw them. The video is rendered without stickers; [Storrito](https://storrito.com/) lays its sticker components over it when it publishes the Story, and Instagram gets them as real stickers.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/stickers.mjs build stickers/launch/stickers.json                   # measured, checked, pictures on a dark ground
node tools/stickers.mjs mount stickers/launch artifacts/launch/composition    # over the film in the HyperFrames preview
node tools/stickers.mjs unmount artifacts/launch/composition                  # before the delivery render
node tools/stickers.mjs build stickers/launch/stickers.json --video launch.mp4 # over the finished video's frames
node ../publish-video/tools/publish.mjs publish publish/launch --to instagram/<account>/story --now \
  --stickers stickers/launch/layer.html
```

Requirements: Node 20+, ffmpeg, Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH), `npm install` (puppeteer-core), the network. agentitos' [platform-zones](../platform-zones/) beside this skill (`PLATFORM_ZONES` may name its `tools/zones.mjs`) for where Instagram covers a Story, [publish-video](../publish-video/) to publish. Storrito's components come from the organization's host (on a [Sprite](https://sprites.dev) the gateway's Storrito connection; elsewhere `STORRITO_API_URL`), else from the host Storrito's documentation loads them from.

## How it works

1. **`stickers.json`** names each sticker with its attributes and its centre (`x`, `y` in px of 1080×1920), optionally `rotate` and `scale`.
2. **`build`** opens a 1080×1920 `<insta-story>` page with Storrito's `insta-components.js`, waits for the components, measures each sticker and places it on its centre. platform-zones' layout check judges the boxes for `instagram-story`. It writes `layer.html` (one `<insta-…>` per line, `position:absolute` with `left`, `top` and the `transform`: the form Storrito turns into its design and Instagram's tap areas), `placed.json` (boxes and the components' host) and pictures for the chat: over frames of `--video` (taken with ffmpeg) or over a dark ground.
3. **`mount`** writes `compositions/story-stickers.html` into a HyperFrames project: the layer in a scene that loads Storrito's components from the same host, and its host element in `index.html`, marked with a comment, over the whole film. `unmount` removes that host again. The Studio preview and rragent's preview show the stickers; the delivery render must go without them.
4. **publish-video `--stickers <layer.html>`** puts the layer inside the `<insta-story src="…">` of each Instagram Story target (not of Reels or other platforms), and counts it in the post's version: a Story scheduled with other stickers is refused until it is cancelled.

Storrito renders the Story's preview and the posted video from the same components, so the pictures of `build` and the Studio preview are what the Story will look like (checked against Storrito's own render of the same layer).

## Limits

- A sticker shows for the whole Story; there is no sticker that comes in later.
- The film's own text and faces under a sticker are not measured: the agent looks at the pictures.
- The Studio preview needs the network for the components; the delivery render does not need them.
