# launch-video

A product's website, a feature, a script or a brief → a launch or promo video for social media, made with [HyperFrames](https://github.com/heygen-com/hyperframes) in rragent's chat: three storylines to pick from, a preview to agree on, then the render.

It is a thin layer over HyperFrames' own guides (story, spec, look, motion, sound, review), read from the HyperFrames CLI installed on the machine, so the film follows the version that renders it and improves with every release. It replaces HyperFrames' retired `product-launch-video` workflow skill, which needed a HeyGen account for voice and music and placed text by one generic frame. What it adds:

- **The platforms' zones.** The frame and the safe box come from agentitos' [platform-zones](../platform-zones/) for the platforms the video goes to (Reels, TikTok, Shorts, Stories, the feeds, YouTube, LinkedIn, X, …), or the usual ones of its frame together. A check finds every text an app would cover, with when and under which buttons, and draws the zones over the review's stills.
- **The brand kit.** The film uses `brand/DESIGN.md` (agentitos' [brand-kit](../brand-kit/)), drafted from the product's site when there is none.
- **Voice, music and pictures through OpenRouter**, instead of a HeyGen account: any of OpenRouter's speech models (ElevenLabs, Gemini, HeyGen's own voices, Mistral, …), every word's time heard back with ElevenLabs Scribe and put on the script's own spelling; music from Google's Lyria 3; pictures from Gemini's image models. Sound effects and logos come from HyperFrames' media-use, which needs no account.
- **Captions** for the voice through agentitos' [captions](../captions/) skill, placed for the platforms.

## What it needs

- Node 20+ and ffmpeg.
- The HyperFrames CLI (`hyperframes` on the PATH, or `RRAGENT_HYPERFRAMES`/`HYPERFRAMES` naming it) with a Chrome; its package carries the guides (`dist/skills/`), else `~/.agents/skills/` (`hyperframes skills update`).
- agentitos' `platform-zones` and `captions` beside this folder (or `PLATFORM_ZONES` and `CAPTIONS_TOOL` naming their tools), `brand-kit` beside it for a brand without a kit.
- OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (see the [README](../README.md#models-openrouter-with-a-key-or-through-the-sprites-gateway)). A 30 s film costs a few cents: the voice 4–8 cents (ElevenLabs v3: $0.08 per 1000 characters), its timing well under a cent, the music $0.04 (Lyria 3 Clip, up to 30 s) or $0.08 (Pro, longer), a picture a few cents.

## The tool

```
node tools/launch.mjs guides                                    where HyperFrames' guides are, and its CLI
node tools/launch.mjs zones <work> [platform…] [--frame 9:16 | --size WxH]
node tools/launch.mjs check <work> <composition>                text under the apps' buttons
node tools/launch.mjs draw <work> <stills-folder>               the zones over every still
node tools/launch.mjs voices [--model <id>]                     speech models, prices, voices
node tools/launch.mjs sample <work> --text "…" --voices a,b [--model <id>] [--out <folder>]
node tools/launch.mjs voice <work> <script.json> <composition>  the lines spoken, every word timed
node tools/launch.mjs words <work> <composition>                the voice's words at their times in the film
node tools/launch.mjs captions <work> <composition> --style hormozi|karaoke|wipe|clean [--mark]
node tools/launch.mjs music <work> <composition> --prompt "…" --seconds 30 [--vocals]
node tools/launch.mjs image <out.png> --prompt "…" [--ratio 9:16] [--ref <image>]…
node tools/launch.mjs finish <video.mp4>                        −14 LUFS, as the platforms play
```

`<work>` is the film's working folder (`launch/<name>/`): `launch.json` (the platforms, the size), `zones.json`, `voice.json` (every line's words with their times in the line), `words.json` (the same in the film), the planning files. `<composition>` is the HyperFrames project (`artifacts/<name>/composition/` in rragent).

- **zones** asks platform-zones for the frame and saves the platforms; without platforms and a frame it takes 9:16 and the usual vertical platforms. It prints the safe box, the wide stretch, where captions end, what each app covers and where a feed crops, and the same as CSS custom properties.
- **check** runs HyperFrames' own check (`hyperframes check --caption-zone`) once per band outside the safe box (and the wide stretch), sampling every quarter second, and names each text that reaches into one: when, where, under which app's buttons. Text meant as texture under the buttons carries `data-layout-allow-caption-zone`. Words inside pictures it cannot read: `draw` puts the zones over the stills for the agent to look at.
- **voice** reads `script.json`, `{"model"?, "voice"?, "instructions"?, "speed"?, "lines": [{"id", "text", "instructions"?}]}`, speaks every line through OpenRouter's speech endpoint into `<composition>/assets/voice/<id>.mp3`, hears it back with Scribe and aligns what was heard to the script, so every word keeps the script's spelling ("Storrito", "2026") with the time it is said. A line spoken before with the same words, model, voice and instructions is kept; a line taken out loses its file.
- **words** and **captions** read where the root composition's `<audio>` elements play each line (`data-start`, `data-media-start`, `data-duration`) and put the words on the film's clock; captions builds them with the captions skill into `<composition>/captions/` for the saved platforms, in the brand's colour and font.
- **music** streams a track from Lyria 3 (Clip up to 28 s, Pro beyond; `--model` to choose), keeps the whole take in `<work>` and writes `<composition>/assets/music.mp3` at the film's length with a fade at the end.
- **finish** levels the rendered video to −14 LUFS with peaks under −1 dBTP, in two passes, the picture untouched.

## How a film is made

[SKILL.md](SKILL.md) holds the agent's steps: the source (`hyperframes capture`) and the brand, the frame and its zones, three storylines and the person's pick, SPEC.md, the sound, the film by HyperFrames' guides, the zone check and the review, the preview, changes, the render and `finish`.

## License

MIT. HyperFrames and its guides are Apache-2.0, © HeyGen; this skill only points at the guides the installed CLI carries.
