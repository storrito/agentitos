# launch-video

A product's website, a feature, a script or a brief → a launch or promo video for social media, made with [HyperFrames](https://github.com/heygen-com/hyperframes) in rragent's chat: three storylines to pick from, every beat as a still for their go before anything is animated, a preview to agree on, then the render.

It is a thin layer over HyperFrames' own guides (story, spec, look, motion, sound, review), read from the HyperFrames CLI installed on the machine, so the film follows the version that renders it and improves with every release. It replaces HyperFrames' retired `product-launch-video` workflow skill, which needed a HeyGen account for voice and music and placed text by one generic frame. What it adds:

- **The platforms' zones.** The frame and the safe box come from agentitos' [platform-zones](../platform-zones/) for the platforms the video goes to (Reels, TikTok, Shorts, Stories, the feeds, YouTube, LinkedIn, X, …), or the usual ones of its frame together. A check finds every text an app would cover, with when and under which buttons, and draws the zones over the review's stills.
- **The brand kit.** The film uses `brand/DESIGN.md` (agentitos' [brand-kit](../brand-kit/)), drafted from the product's site when there is none.
- **Voice, music and pictures through OpenRouter**, instead of a HeyGen account: any of OpenRouter's speech models (ElevenLabs, Gemini, HeyGen's own voices, Mistral, …), every word's time heard back with ElevenLabs Scribe and put on the script's own spelling; music from Google's Lyria 3; pictures from Gemini's image models. Sound effects and logos come from HyperFrames' media-use, which needs no account.
- **Captions** for the voice through agentitos' [captions](../captions/) skill, placed for the platforms.

## What it needs

- Node 20+ and ffmpeg.
- The HyperFrames CLI (`hyperframes` on the PATH, or `RRAGENT_HYPERFRAMES`/`HYPERFRAMES` naming it) with a Chrome; its package carries the guides (`dist/skills/`), else `~/.agents/skills/` (`hyperframes skills update`).
- agentitos' `platform-zones`, `captions` and `transcribe` beside this folder (or `PLATFORM_ZONES`, `CAPTIONS_TOOL` and `TRANSCRIBE` naming their tools), `brand-kit` beside it for a brand without a kit.
- OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (see the [README](../README.md#models-openrouter-with-a-key-or-through-the-sprites-gateway)). A 30 s film costs a few cents: the voice 4–8 cents (ElevenLabs v3: $0.08 per 1000 characters), its timing well under a cent, the music $0.04 (Lyria 3 Clip, up to 30 s) or $0.08 (Pro, longer), a picture a few cents.

## The tool

```
node tools/launch.mjs guides                                    where HyperFrames' guides are, and its CLI
node tools/launch.mjs zones <work> [platform…] [--frame 9:16 | --size WxH]
node tools/launch.mjs check <work> <composition>                text under the apps' buttons
node tools/launch.mjs draw <work> <stills-folder>               the zones over every still
node tools/launch.mjs fill <work> <stills-folder>               how much of every still the picture fills, and where
node tools/launch.mjs board <work> <stills-folder> [--out <file>]   the posed stills as one picture for the chat
node tools/launch.mjs voices [--model <id>]                     speech models, prices, voices
node tools/launch.mjs sample <work> --text "…" --voices a,b [--model <id>] [--out <folder>]
node tools/launch.mjs voice <work> <script.json> <composition>  the lines spoken, every word timed
node tools/launch.mjs narration <work> <voice> <words.json> <composition> [--gap <s>+<len>,…]   a recorded voice (best-takes' cut) as the film's voice, stopped for footage
node tools/launch.mjs words <work> <composition>                the voice's words at their times in the film
node tools/launch.mjs captions <work> <composition> --style <a style of captions> [--mark] [--pause <from>-<to>,…] [--follow] [--edge]
node tools/launch.mjs music <work> <composition> --prompt "…" --seconds 30 [--vocals] [--under 17]
node tools/launch.mjs level <work> <composition> [--rise 8] [--pause 1]   the music level under the voice, up in its long pauses, out under footage
node tools/launch.mjs image <out.png> --prompt "…" [--ratio 9:16] [--ref <image>]…
node tools/launch.mjs finish <video.mp4>                        −14 LUFS, as the platforms play
node --test tools/test.mjs                                      the music's level and lane under the voice, a recorded voice, the captions' pauses, footage in a narrated film, how a still is filled, the board; no request
```

`<work>` is the film's working folder (`launch/<name>/`): `launch.json` (the platforms, the size), `zones.json`, `voice.json` (every line's words with their times in the line), `words.json` (the same in the film), the planning files (`STORYLINES.md`, `SPEC.md`, `STORYBOARD.md`, `REVIEW.md`). `<composition>` is the HyperFrames project (`artifacts/<name>/composition/` in rragent).

- **zones** asks platform-zones for the frame and saves the platforms; without platforms and a frame it takes 9:16 and the usual vertical platforms. It prints the safe box, the centred box (the safe box even about the frame's middle, for text centred on the frame), the wide stretch, where captions end, what each app covers and where a feed crops, and the same as CSS custom properties.
- **check** runs HyperFrames' own check (`hyperframes check --caption-zone`) once per band outside the safe box (and the wide stretch), sampling every quarter second, and names each text that reaches into one: when, where, under which app's buttons. Text under an app's buttons fails the check (✗); text only in the safe box's margin, a buffer for other phones, is a `!`. Text meant as texture under the buttons carries `data-layout-allow-caption-zone`. Words inside pictures it cannot read: `draw` puts the zones over the stills for the agent to look at.
- **board** lays the stills of `hyperframes snapshot --at … --no-end` (`frame-NN-at-<seconds>s.png`) out as one picture about a phone's width (three a row for a vertical film, two for any other), in film order, each with its number, its name and its time from the frames of `<work>/STORYBOARD.md` (HyperFrames' format, `## Frame 1: The hook (0-3s)`), and writes it to `uploads/<work's name>-board.jpg`, where the chat's pictures are. It judges nothing. An ffmpeg without `drawtext` gives tiles without labels, and says so.
- **voice** reads `script.json`, `{"model"?, "voice"?, "instructions"?, "speed"?, "lines": [{"id", "text", "instructions"?}]}`, speaks every line through OpenRouter's speech endpoint into `<composition>/assets/voice/<id>.mp3`, hears it back with Scribe and aligns what was heard to the script, so every word keeps the script's spelling ("Storrito", "2026") with the time it is said. A line spoken before with the same words, model, voice and instructions is kept; a line taken out loses its file.
- **narration** takes a voice the person recorded, cut by agentitos' [best-takes](../best-takes/) (`voice.cut.m4a` and the words of `edit.json`, timed in the cut; transcribe's `words.json` works too), copies it into `<composition>/assets/voice/narration.m4a` without its tags and writes it into `voice.json` as one line with every word's time (`"recorded": true`, which `voice` keeps), so the steps after it take it as a spoken line. `--gap <s>+<len>,…` stops the voice after the last word that ends by `<s>` for `<len>` s of footage that plays its own sound, and prints the pieces of the voice to place (one `<audio>` of the same file each, by `data-media-start` and `data-duration`) and each footage's place between them, a quarter second clear of the voice.
- **words** and **captions** read where the root composition's `<audio>` elements play each line (`data-start`, `data-media-start`, `data-duration`) and put the words on the film's clock; captions builds them with the captions skill into `<composition>/captions/` for the saved platforms, in the brand's colour and font. `--pause <from>-<to>,…` (seconds of the film, kept in `launch.json` until `--pause none`) leaves out the words said where the picture carries them, from `<work>/captions.words.json`. `--follow` and `--edge` go to the captions skill as they are: the word being said lit, a style's box with an edge for a ground as light as it.
- **music** streams a track from Lyria 3 (Clip up to 28 s, Pro beyond; `--model` to choose), keeps the whole take in `<work>` and writes `<composition>/assets/music.mp3` at the film's length with a fade at the end, and its `<audio>` at the volume that lays it 17 LU (`--under`) under the voice, both measured; `check` measures it again as the film places it.
- **--plain** on voice and music, for another skill whose own build places the voice and the music (narrated-short): they print what was made and measured (the files, the cost, the volume that lays the music under the voice), without launch-video's next steps (the `<audio>` elements for the root, captions, beats).
- **level** writes the music's level along the voice as a volume lane on `<audio id="music">` (`data-automation`, with `data-volume` and `data-under-voice`): the distance `--under` while the voice speaks and through pauses shorter than `--pause` (1 s), `--rise` (8 dB) more in longer pauses (up 0.15 s after a word, down again 0.2 s before the next, ramps of up to 0.5 and 0.4 s), before a voice that starts late and after its last word. A compressor keyed by the voice brings the music up in every breath (2026-11-18, the first narrated film); a lane cut from the words cannot. Footage that plays its own sound (a `<video>` or `<audio>` that is neither the voice nor the music, not muted, not `data-sfx`, whose file has sound) takes the music out: down over 0.3 s before it, back after it, and the pauses beside it never bring the music up (a swell between the voice and the footage's own sound). `check` measures the distance at the lane's low point above 0.
- **fill** measures every still (a small grey copy of it) without the captions' band: the ground is the commonest level of its border, the rest is picture. ✗ a still with nothing but ground (a scene that opens empty until its first word), ! one whose picture is sparse (under 6 % of the frame), small (under 40 % of the safe box's height and width) or high (its middle in the safe box's top third). Measured on two narrated 16:9 explainers (2026-11-19): the one with small type and figures high in an empty frame had picture on a median 8 % of its stills (15 of 46 sparse), the ones that read well on 25 %. It judges size and place only.
- **finish** levels the rendered video to −14 LUFS with peaks under −1 dBTP, in two passes, the picture untouched.

## How a film is made

[SKILL.md](SKILL.md) holds the agent's steps: the source (`hyperframes capture`) and the brand, the frame and its zones, three storylines and the person's pick, SPEC.md, every beat posed as a still and the board for the person's go (HyperFrames' storyboard recipe), the sound, the film animated by HyperFrames' guides, the zone check and the review, the preview, changes, the render and `finish`.

## License

MIT. HyperFrames and its guides are Apache-2.0, © HeyGen; this skill only points at the guides the installed CLI carries.
