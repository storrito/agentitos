# Safe zones for vertical video

Which parts of a 1080×1920 frame the apps cover with their own UI, and where on-screen text therefore has to go.
**No platform publishes margins for organic posts:** the values below come from ad templates (ads add a button at
the bottom, so they lean conservative) or from measurements, and the UI moves with caption length, device and app
version.

| platform | top | bottom | sides | button column | source |
|---|--:|--:|--:|---|---|
| TikTok | 240 | 660 (username, caption, sound; long captions grow upward) | 120 | 180 px wide on the right, from y 840 | TikTok In-Feed Ads template scaled from 720×1280 ([Socialync](https://www.socialync.io/tools/safe-zones/tiktok)); the column width is measured, not published |
| Instagram Reels, organic | ~220 | ~320 | ~65 | ~120 px on the right | third-party guides ([House of Marketers](https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/)) |
| Instagram Reels, ads | 14 % ≈ 270 | 35 % ≈ 672 | 6 % ≈ 65 | — | attributed to Meta ([Socialync](https://www.socialync.io/tools/safe-zones/instagram-reels)) |
| YouTube Shorts | 288 | 672 (channel, subscribe, title) | 48 left | 192 px on the right | attributed to Google's vertical ad specs ([Socialync](https://www.socialync.io/tools/safe-zones/youtube-shorts)) |
| Stories | ~250–270 | ~250–270 | ~40 | — | Meta guidance |

## The layout that follows

**Text-safe on every platform** (the intersection): x 120–960; from y 840 down x 120–888 (TikTok's buttons);
y 288–1248. Picture may run under the UI, text may not.

A layout that fits it, for landscape footage on a vertical canvas (sharp band over a blurred fill):

| element | position |
|---|---|
| brand or series pill, end handle | top ≈ 256 |
| footage credit | top ≈ 330 |
| text hook, chips, comparison graphic | from top ≈ 398, x 120–960 |
| video band | centred (y 656–1264 for 16:9; taller when zoomed) |
| word-by-word captions | top ≈ 1140, x 120–888, ≤ 3 words per page — on the lower edge of the band |
| progress bar | none: both apps draw their own, and at the bottom it sits under TikTok's caption block |

Pilot lesson: a template laid out only for Instagram's 320 px bottom zone put its captions and progress bar under
TikTok's username, caption and buttons, on the platform that brought most of the reach. Check every new template
by overlaying these zones on a few rendered frames; covers have their own rules (`covers.md`).
