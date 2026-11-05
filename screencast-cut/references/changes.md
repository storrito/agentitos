# screencast-cut: typical change wishes

For a moment the person names, `node <skill>/tools/screencast.mjs at screencast/<name> 0:23` says which keep plays there; `node <skill>/tools/screencast.mjs frame screencast/<name> 0:23` saves that moment's source with a grid and the shot's zoom in red. Change the keep in `cut.json`, build, check, and ask again in one sentence.

| They say | You do |
| --- | --- |
| "Too small" / "show more of …" / "zoom on …" | a tighter or other `"zoom"` on that keep, from `frame` |
| "… is cut off" / "too fast at the end" | `"hold": 1.5` on that keep, or end it a word later |
| "Faster" / "slower" / "as I spoke" | `build … --speed 1.3` / `--speed 1.1` / `--speed 1` (by default the build speeds a slow speaker up to 1.2× by itself and says so; the voice keeps its pitch) |
| "Show the phone larger" | `"circle": false` on that keep: the whole phone takes the frame's height above the captions (no zoom: its bars show it is the real app) |
| "Show the result here" / "something wrong is on screen here" | `"show": {"file": "<the result's video>"}` on that keep: that video over the words, the recording's sound on |
| "… with its sound / the music getting louder" | `"sound": 0.8` in that `"show"`: quiet under the first words, up by the last one; a `"hold"` to let it play on |
| "Cut that out" (something on screen that does not belong) | split the keep around it and leave out only that; the way to what comes next stays, sped up (its last word in `"waits"`), or covered with `"show"` |
| "Show the phone" / "show my face" | `"view": "phone-screen"` / `"face"` on that keep |
| "Hide my face here" | `"circle": false` on that keep: the screen takes its room too |
| "No background" / "plain background" | `"background": "plain"` in cut.json (the brand's colours) |
| "Other captions" / "no captions" | `screencast.mjs captions screencast/<name> --style hormozi` (karaoke, wipe, clean) / `--off` |
| "Longer waits as time-lapses" | the last word before it into `"waits"` |
| "Start with …" | move that keep to the top |
| "Vertical" / "square" / "for TikTok" | `build … --frame 9:16` / `1:1` / `--platform tiktok` |
| "Hide that" (a password on screen) | a `"zoom"` past it, or another `"view"` |
| "Music under it" | `"music": {"file": "<path>", "volume": 0.3}` |
