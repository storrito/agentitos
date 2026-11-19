# screencast-cut: typical change wishes

For a moment the person names, `node <skill>/tools/screencast.mjs at screencast/<name> 0:23` says which keep plays there; `node <skill>/tools/screencast.mjs frame screencast/<name> 0:23` saves that moment's source with a grid and the shot's zoom in red. Change the keep in `cut.json`, build, check, and ask again in one sentence.

| They say | You do |
| --- | --- |
| "Too small" / "show more of …" / "zoom on …" | a tighter or other `"zoom"` on that keep, from `frame` |
| "… is cut off" / "too fast at the end" | `"hold": 1.5` on that keep, or end it a word later |
| "Faster" / "slower" / "as I spoke" | `build … --speed 1.3` / `--speed 1.1` / `--speed 1` (by default the build speeds a slow speaker up to 1.2× by itself and says so; the voice keeps its pitch) |
| "Show the phone" / "show my face" | `"view": "phone-screen"` / `"face"` on that keep |
| "My face is too small" / "too large" / "the subtitles are on my mouth" (a face keep) | another of that keep's face-view candidates, `"layout": "crop 1:1"` (a ✓ or !), from the list the build printed; check it with `frame` |
| "Hide my face here" | `"circle": false` on that keep: the screen takes its room too |
| "No background" / "plain background" | `"background": "plain"` in cut.json (the brand's colours) |
| "Other captions" / "no captions" | `screencast.mjs captions screencast/<name> --style hormozi` (karaoke, wipe, clean; on a busy screen `outline` or `fill` stand out, `bold` and `subtitle` have nothing behind the words) / `--off` |
| "Longer waits as time-lapses" | the last word before it into `"waits"` |
| "Keep that moment" (shown to the phone's camera in silence, cut as a pause) | `"pauses": "keep"` on its keep (its other pauses then stay too; for that one alone, make the sentences around it a keep of their own), or a keep by its time, `"at"` |
| "Start with …" | move that keep to the top |
| "Vertical" / "square" / "for TikTok" | `build … --frame 9:16` / `1:1` / `--platform tiktok` |
| "Hide that" (a password on screen) | a `"zoom"` past it, or another `"view"` |
| "Music under it" | `"music": {"file": "<path>", "volume": 0.3}` |
