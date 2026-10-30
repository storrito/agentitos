# story-stickers

A picture or a video as an Instagram Story with Instagram's own stickers: link, poll, question, quiz, countdown, emoji slider, mention, hashtag and location, tappable, exactly where the person saw them. A picture is laid out on the 9:16 Story in HTML (filled when it is nearly 9:16, else centred over a blurred enlargement of itself), a video is rendered without stickers; [Storrito](https://storrito.com/) renders the Story from that HTML, lays its sticker components over it when it publishes, and Instagram gets them as real stickers.

> Agents: start with [`SKILL.md`](SKILL.md).

This skill has no tools. Everything it needs lives in Storrito, so that every agent (rragent's REPL, an MCP client, a script) gets the same rules:

1. **The layer**: in `stickers/<name>/layer.html` one flexbox over a **band** of the frame that the picture or the film keeps free (`position:absolute; left/right 60px; top/bottom` the band, inside the safe zone; `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:40px`), the `<insta-…>` stickers in it. The agent decides only where it is free; flexbox spaces the stickers, keeps their natural size and never lets them overlap. Storrito takes the boxes the browser shows (checked: check, draft and the HyperFrames preview show the same). A band too small spills over both of its edges, so the agent compares the boxes of the check with its band. A sticker that must sit on an exact spot is placed alone by its centre (`left`/`top`, `width:max-content`, `translate(-50%,-50%)`).
2. **The preview**: a HyperFrames project (a picture, a brought video or the film being made) with a scene of the same lines, loading Storrito's components, mounted with `data-preview-only`: the person sees the Story as Instagram will. rragent's render leaves such elements out of the video. Checked: the preview of a picture matches Storrito's render of the same HTML (RMSE 1.2 %).
3. **Is the band free**: text the agent places, `hyperframes check --caption-zone` with the band (reports every collision with its moment, even a text shown for 2 s); a video's pixels, sheets of every moment that differs from the one before (`fps=2,mpdecimate`, the band drawn) and an occupancy map (edges, running maximum over time); where the map finds no free band (busy footage), the agent decides from the moments.
4. **A picture**: uploaded with `create-temp-blob-upload-url`, laid out in the Story's HTML (two `<img>`: a blurred `object-fit:cover` enlargement and the picture across the width; or one filling the frame), shown in the preview and scheduled with `schedule-instagram-story` from the REPL, a UUID per frame and account remembered before, so that a retry posts nothing twice; Storrito refuses what would make the post fail.
5. **Publishing a video**: agentitos' [publish-video](../publish-video/) with `--stickers stickers/<name>/layer.html` puts the lines inside the `<insta-story src="…">` of each Instagram Story target (not of Reels or other platforms) and counts them in the post's version.

Requirements: Storrito reachable from the agent (on a [Sprite](https://sprites.dev) the gateway's Storrito connection), the HyperFrames CLI and ffmpeg, publish-video beside this skill to publish, and for the preview the network (the components come from Storrito).

## Limits

- A sticker shows for the whole Story; there is no sticker that comes in later.
- The film's own text and faces under a sticker are not measured: the agent looks at Storrito's picture.
