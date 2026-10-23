# platform-zones

Where the platforms lay their buttons, names and captions over a video, per frame, as one table that every skill of this collection asks instead of keeping numbers of its own: the box that stays clear for text, faces and the thing being shown; what each app covers; where a feed or a profile grid shows the video cut to another ratio. When nobody said where the video goes, the usual platforms of its frame together.

It is an agent of its own (upload a frame, see what Reels covers, see [SKILL.md](SKILL.md)) and the zones step of the other agents: captions, screencast-cut, kinetic-lyrics and story-from-link call its tool with `--json` (folders never import from each other; calling another skill's tool is allowed).

```
node tools/zones.mjs list
node tools/zones.mjs zones [platform…] (--of <video|image> | --size 1080x1920 | --frame 9:16) [--json]
node tools/zones.mjs check <x,y,w,h> [platform…] (--of … | --size … | --frame …) [--json]
node tools/zones.mjs draw <video|image> <out.png> [platform…] [--at <s>]
```

Needs Node 20+, and ffmpeg for `draw` and `--of`. No model, no key, no npm packages.

## What it answers

`zones` on a frame (`--json` for programs, every value in px of the frame):

| key | what |
| --- | --- |
| `safe` | `[x, y, w, h]`: text, faces, the thing being shown and the logo stay inside |
| `margins` | the same as distances from the edges |
| `wide` | in a vertical video, the stretch above the buttons' column on the right that is clear across the frame (`null` where there is none) |
| `covers` | `[{platform, what, box}]`: each thing an app lays over the video |
| `crops` | `[{platform, where, ratio, box}]`: the part a feed or grid shows (a reel at 4:5 in Instagram's feed, at 3:4 in the grids) |
| `platforms` | `[{id, name, basis, standIn?}]`: whose zones these are |
| `fallback` | `true` when no platform was named and the frame's usual ones stand in |
| `notes`, `sources` | what to know about the numbers, and where they come from |

The text output adds where captions' lowest line ends (the safe box's bottom) and how wide they may be.

`check` takes a box and says what of it leaves the frame, what leaves the safe box (px per side; a box inside the wide stretch counts as clear), what share of it each app covers, and what share a crop cuts away. `draw` lays the zones over a frame (the first, or `--at`): covers red, each app's on top of the others' (darker where several apps cover), the safe box green, the crops yellow.

## Several platforms, and none

- Several platforms named: their zones together. The safe box keeps each side's largest margin, so what is inside it is clear on every one of them; the covers and crops of all are listed.
- None named (`DEFAULTS` in `tools/lib/platforms.mjs`): the usual platforms of the frame together.

  | frame | stand in |
  | --- | --- |
  | 9:16 | Instagram Reels, Instagram Story, TikTok, YouTube Shorts, Facebook Reels |
  | 4:5 | Instagram feed, Facebook feed, LinkedIn |
  | 1:1 | Instagram feed, Facebook feed, LinkedIn, X |
  | 16:9 | YouTube, Facebook feed, LinkedIn, X |

  Pinterest (790 px of the bottom), Snapchat and the full-screen views of LinkedIn and X stay out: they would take a large part of every vertical video for places it seldom goes. Named, they are in.
- A frame near one of these (within 15 %) takes its numbers: 3:4 those of 4:5, a phone's 9:19.5 those of 9:16. Any other frame (2:3, 21:9) gets the broadcast title-safe border, 5 % each side, with 10 % at the bottom for a player's controls.
- A platform named for a frame it has no numbers for is replaced by the same app's view of that frame (Instagram's feed for Reels at 4:5, Shorts for YouTube at 9:16), else by the frame's usual platforms (TikTok at 16:9), with a note.
- On a frame of another ratio than the measured one the zones keep their size and stick to their edge, as the apps size their buttons by the phone's width (a player its controls by its height) and pin them to the edges: on a phone's 1080×2340 the buttons' column moves down with the bottom, and the wide stretch above it grows.

## The numbers

Measured on 1080×1920 (9:16), 1080×1350 (4:5), 1080×1080 (1:1) and 1920×1080 (16:9), in px; compared 2026-10-23. The margins are the safe box; `tools/lib/platforms.mjs` has the covers box by box.

| platform | id | frame | top | bottom | left | right | crops | basis | sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Instagram Reels | `instagram-reels` | 9:16 | 250 | 420 | 60 | 200 | 4:5, 3:4 | guides | [1](https://outfy.com/blog/instagram-safe-zone) [2](https://pod2reels.com/blog/instagram-reels-safe-zone-guide) [3](https://reelsafezone.com) [4](https://campaignswift.com/blog/instagram-safe-zone-sizes) [5](https://blog.adnabu.com/meta-ads/meta-safe-zones/) |
| Instagram Story | `instagram-story` | 9:16 | 250 | 300 | 60 | 60 | – | guides | [1](https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide) [2](https://argil.ai/blog/instagram-story-dimensions) [3](https://videobgremover.com/blog/instagram-story-specs) |
| Instagram feed post | `instagram-feed` | 4:5 | 54 | 100 | 54 | 54 | 3:4 | estimate | [1](https://www.clipspeed.ai/blog/best-aspect-ratio-short-form-video.html) |
| Instagram feed post | `instagram-feed` | 1:1 | 54 | 100 | 54 | 54 | 3:4 | estimate | [1](https://www.clipspeed.ai/blog/best-aspect-ratio-short-form-video.html) |
| TikTok | `tiktok` | 9:16 | 160 | 480 | 60 | 180 | 3:4 | guides | [1](https://www.revid.ai/tiktok-safe-zone) [2](https://imagevideofit.com/guides/tiktok-safe-zone) [3](https://novustools.com/social-safe-zone/guides/tiktok-safe-zone) [4](https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide) [5](https://www.relevantaudience.com/tiktok-ads/tiktok-video-size-ad-specs/) |
| YouTube Shorts | `youtube-shorts` | 9:16 | 200 | 400 | 48 | 192 | – | guides | [1](https://www.revid.ai/youtube-shorts-safe-zone) [2](https://www.poster.ly/tools/youtube-shorts-safe-zone-checker) [3](https://imagevideofit.com/guides/youtube-shorts-safe-zone) [4](https://support.google.com/google-ads/answer/13547298?hl=en) |
| YouTube video | `youtube` | 16:9 | 108 | 150 | 96 | 96 | – | estimate | [1](https://support.google.com/youtube/answer/6375112) [2](https://postfa.st/blog/youtube-dimensions-video) |
| Facebook Reels | `facebook-reels` | 9:16 | 250 | 480 | 60 | 200 | – | guides | [1](https://adkit.so/tools/safe-zones/facebook) [2](https://www.socialync.io/tools/safe-zones/facebook-reels) [3](https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/) |
| Facebook Story | `facebook-story` | 9:16 | 270 | 384 | 60 | 60 | – | ads | [1](https://blog.adnabu.com/meta-ads/meta-safe-zones/) [2](https://withblip.com/blog/how-to-use-meta-ad-safe-zones-without-cutting-off-your-creative/) |
| Facebook feed post | `facebook-feed` | 4:5 | 54 | 110 | 54 | 54 | – | estimate | [1](https://adkit.so/tools/safe-zones/facebook) |
| Facebook feed post | `facebook-feed` | 1:1 | 54 | 110 | 54 | 54 | – | estimate | [1](https://adkit.so/tools/safe-zones/facebook) |
| Facebook feed post | `facebook-feed` | 16:9 | 54 | 110 | 96 | 96 | – | estimate | [1](https://adkit.so/tools/safe-zones/facebook) |
| Snapchat Story | `snapchat-story` | 9:16 | 150 | 150 | 48 | 48 | – | guides | [1](https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide) [2](https://brand-qa2.canadiantire.ca/en/ctr/design-system/omni-channel/motion/margins-and-safe-space.html) [3](https://strikesocial.com/blog/snapchat-ad-specs/) |
| Snapchat Spotlight | `snapchat-spotlight` | 9:16 | 150 | 400 | 48 | 180 | – | estimate | [1](https://instasize.com/size-guides/snapchat/story) |
| Pinterest video Pin | `pinterest` | 9:16 | 270 | 790 | 65 | 195 | – | official | [1](https://help.pinterest.com/en/article/review-pin-specs) |
| LinkedIn video | `linkedin` | 9:16 | 230 | 420 | 60 | 180 | 4:5 | estimate | [1](https://www.tella.com/help/editing/social-safe-zones) [2](https://quso.ai/blog/linkedin-video-specs) |
| LinkedIn video | `linkedin` | 4:5 | 54 | 120 | 54 | 54 | – | estimate | [1](https://quso.ai/blog/linkedin-video-specs) |
| LinkedIn video | `linkedin` | 1:1 | 54 | 120 | 54 | 54 | – | estimate | [1](https://quso.ai/blog/linkedin-video-specs) |
| LinkedIn video | `linkedin` | 16:9 | 54 | 120 | 96 | 96 | – | estimate | [1](https://quso.ai/blog/linkedin-video-specs) |
| X (Twitter) | `x` | 16:9 | 54 | 110 | 96 | 96 | – | estimate | [1](https://socialk.it/it/sizes/x-video-size) |
| X (Twitter) | `x` | 1:1 | 54 | 110 | 54 | 54 | – | estimate | [1](https://socialk.it/it/sizes/x-video-size) |
| X (Twitter) | `x` | 9:16 | 200 | 420 | 60 | 60 | – | estimate | [1](https://www.clipspeed.ai/tools/social-media-video-dimensions.html) |

**Basis.** `official`: the platform publishes the numbers for organic posts (only Pinterest does). `ads`: the platform's numbers for ads, which leave room for the ad's button. `guides`: third-party guides that roughly agree; they disagree by up to 200 px, and the numbers lean to their larger side. `estimate`: no source gives numbers; read off the app's layout, rounded up.

The ad numbers are larger and left out on purpose: Meta asks Reels ads to keep 14 % top, 35 % bottom and 6 % of the sides free (269, 672, 65 px), Google's template for vertical video ads 288 px top, 672 px bottom, 48 left and 192 right. An organic post has no ad button, and those margins would leave less than half of a vertical video.

The apps change their layout without notice. When a frame looks wrong on a phone, correct the entry in `tools/lib/platforms.mjs` with its source and the day, and `CHECKED`; the skills that ask follow by themselves.

## What it does not do (yet)

- Times: YouTube's end screens cover large parts of the last 5–20 seconds, the apps' captions grow when tapped. The zones are for the whole video.
- Ads: the zones are for organic posts.
