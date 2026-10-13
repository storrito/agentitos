# kinetic-lyrics

Turns a **per-word timing transcript** into a kinetic-typography video in the style of a lyric video, at any aspect ratio. Words animate according to their meaning, and a three.js world adds illustrating animation behind them. Built on [HyperFrames](https://hyperframes.heygen.com/).

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
npm install
node tools/build.mjs examples/demo/transcript.json --audio examples/demo/voice.wav --aspect 16:9 --title "My Title"
npx hyperframes preview --background       # Studio
npx hyperframes render                     # MP4 (software GPU, slow: ~3 s per frame)
npm run render:gpu -- -o renders/out.mp4   # MP4 via an NVIDIA GPU (~0.2 s per frame)
```

**Render speed:** By default HyperFrames renders on Linux with SwiftShader, i.e. WebGL on the CPU. For the three.js world with bloom that is about 3 s per frame. `--browser-gpu` uses the graphics card. On Optimus laptops (Intel + NVIDIA), Chrome then picks the NVIDIA card but only gets a WebGL context when EGL explicitly points at the NVIDIA driver. That is exactly what `render:gpu` sets. The frames are practically identical (PSNR 47 dB against the software version).

Options: `--aspect 16:9|9:16|1:1|4:5|21:9` or `--size 2560x1080`, `--audio <file>`, `--title`, `--seed` (another layout variant), `--tail` (seconds after the last word).

To create a transcript with timings: `npx hyperframes transcribe audio.wav` → `transcript.json`.

## A short from a clip, step by step (`tools/short.mjs`)

For agents: one folder per short, each step prints what to do next. Settings are kept in `<dir>/source/settings.json`.

```bash
node tools/short.mjs new shorts/ep12 upload.mp4                 # source/: audio.wav, video.*, transcript.json
node tools/short.mjs brief shorts/ep12 --speakers 2             # who speaks when; writes source/brief.md
# the agent reads brief.md and writes source/staging.json
node tools/short.mjs build shorts/ep12 --names "A=Anna,B=Ben"    # HyperFrames project in composition/
node tools/short.mjs check shorts/ep12 4,15                     # QA; stills/4.png, stills/15.png
```

It always uses the `podcast` preset, 9:16 by default and full-text mode; options: `--speakers`, `--names`, `--title`, `--subtitle`, `--hook`, `--world`, `--aspect`, `--cta`, `--handle`, `--keywords` / `--full-text`. `<dir>` may already exist (e.g. made by a harness); `new` replaces `<dir>/composition/`.

## Presets: lyric, podcast, social

```bash
# Podcast excerpt (16:9), speakers from the transcript's "speaker" field
node tools/build.mjs examples/podcast/transcript.json --preset podcast --audio examples/podcast/voice.wav \
  --title "Small Teams, Big Leverage" --subtitle "Ep. 12 — with Mara Lind" --speakers "A=Mara,B=Jonas" \
  --llm --out videos/podcast-demo

# Short-form video (9:16) with hook headline and call to action
node tools/build.mjs examples/social/transcript.json --preset social --audio examples/social/voice.wav \
  --cta "Try it tonight" --handle "@learnoutloud" --llm --out videos/social-demo

cd videos/social-demo && npm run render:gpu -- -o renders/social.mp4
```

| | `lyric` (default) | `podcast` | `social` |
| --- | --- | --- | --- |
| **Format** | 16:9 | 16:9 | 9:16 |
| **Pacing** | big gestures, up to 6 words | readable sentences, up to 7 words | 2–4 words, hero for the punchline |
| **3D world** | full presence | calm (45 %) | 70 % |
| **Text** | effects by meaning | markers on key statements, speaker colours | markers on key statements |
| **HUD** | title, timecode, concept | show title, speaker chip on every change, audiogram | hook card, progress bar, CTA card |
| **Safe zone** | title-safe (80 %) | clear of speaker chip and audiogram | below the hook, above the apps' caption bar, left of the button column |

Across all presets:
- **Numbers** such as "40%", "$3.5", "1,000" or "10x" count up as they are spoken. Years are excluded.
- **Concepts for factual content:** growth and money (chart motif), technology and people (network motif), idea, problem and success.
- **Speakers:** phrases break at every change of speaker.
- **Audiogram:** computed from real frequency bands of the audio (`tools/audio.mjs`).
- **Social:** the first frame is already fully composed, because it often serves as the thumbnail.
- **With `--llm`**, Claude writes the hook headline, picks the marker words and stages calmer (podcast) or faster (social), depending on the preset.

`--out <dir>` creates a separate HyperFrames project per video.

**Transcription:** Please use Parakeet (`npx hyperframes models install parakeet`, then `npx hyperframes transcribe audio.wav -e parakeet`). Whisper's word timings were off by up to 0.5 s in places in the demo.

## Worlds

Every video plays in a **world** that fits its topic. Each world has its own palettes for every mood:

| World | Look | Fits | Default for |
| --- | --- | --- | --- |
| `cosmos` | nebula, stars, bloom | night, dreams, big emotions, lyrics | `lyric` |
| `aurora` | flowing, saturated colour fields, soft light | lifestyle, motivation, social | `social` |
| `editorial` | paper with fibre texture, dark ink | business, education, interviews | `podcast` |
| `geometry` | bright studio, matte 3D shapes with soft shadows | tech, product, explainers | – |
| `bokeh` | warm, blurred circles of light in the dark, cinematic | people, lifestyle, health, animals, film, comedy | – |
| `neon` | glowing perspective grid, light streaks in the slipstream | tech, gaming, sports, racing, machines | – |
| `noir` | dark room, slanted light through blinds, dust in the beam | crime, espionage, secrets, history, psychology | – |

Select with `--world <name>`. If omitted, Claude picks one to fit the content with `--llm`, otherwise the preset's default applies.

- **Editorial** keeps using all motifs: the glowing 3D scene is put onto paper subtractively, so light becomes ink.
- **Geometry** expresses the concepts through its objects: they orbit (time), rise and fall (rise/fall), get pushed away (impact), grow (growth, numbers) and pulse (love). The key light brightens for light and idea.
- **Light worlds** switch typography and HUD to dark type and use darker speaker colours.

## Video as background

If the podcast exists as a video, the camera image can be the background:

```bash
node tools/build.mjs examples/my-clip/transcript.json --video examples/my-clip/video.mp4 \
  --preset podcast --aspect 9:16 --full-text --llm --speakers "A=Jane Doe" \
  --title "My Show" --subtitle "Jane Doe · Astrophysicist" \
  --video-shade 0.44:0.565 --video-dim 1 --out videos/my-clip
```

- **Layout:** The video fills the frame. A gradient darkens the lower half of the frame, where the typography sits. The face at the top stays clear.
- **The world** is laid over the video with `screen` blending, so only its light is visible (stars, sparks, rings). Over the face it is barely visible, in the dark area it is at full strength. Light worlds are replaced by `cosmos`, and the type is always light.
- **Motion:** The image slowly zooms in by 6 % and gives a small push (2.5 %) on hero lockups.
- **Burned-in captions** are found automatically by `tools/burnin.mjs`. It looks for bright, sharp-edged text that changes every few tenths of a second and sits in a fixed band. Temporary overlays such as name tags or title cards are detected as well. The gradient is fully dark just above them, never higher than 50 % (the face stays clear) and never lower than 60 % (the type needs room). Without burned-in text it is a little lighter (`dim` 0.85). Result on 7 shorts: 6 caption bands and 4 overlays found, and correctly none for the clip without captions.
- **`--video-shade a:b` / `--video-dim x`** override the detection: at frame height `a` the gradient is still transparent, from `b` on it is dark, and `x` sets how dark. The values are stored in `plan.json` under `video`.
- **Short-form layout:** The type ends at 78 % of the frame height and keeps 12 % clear on the right, so it stays free of the platform UI (title, channel, buttons). The name tag sits directly above the type, and the audio waveform is dropped. Speakers without names only get their colour, no "A"/"B" tag.
- **Worlds over video:** `cosmos`, `aurora` (keeps colour veils at half strength), `bokeh`, `neon` and `noir`. With `--llm` Claude only picks from these. Light worlds are replaced: `editorial` by `bokeh`, `geometry` by `neon`. Centred motifs (rings, network, chart, pulse rings, sun) move into the dark zone and get smaller.
- **Sound:** Without `--audio` the audio track is read from the video, and the video itself plays muted.
- **QA** (`tools/qa.mjs`) measures contrast and collisions on real video frames (ffmpeg, 8 fps).

### Word effects for footage

- `blink`: the word opens like an eye and blinks once (concept `eye`: see, look, watch, blink …).
- `redact`: a censor bar slides over the empty spot, the word appears underneath, the bar pulls away (concept `secret`: lie, secret, CIA, truth …).
- `bounce`: the letters bounce in one after another (concept `animal`: dog, cat, Tier …).
- `window`: the word sits dim behind a closed window whose two casements swing open as it is spoken (windows, doors, opening up, a reveal: "opened the door", "ein Fenster auf").
- Exit `mow`: a cute push mower drives through the phrase and cuts the letters down to stubble. A gag: only for a phrase about mowing, a lawn or cutting grass, at most once per video; the mower follows the letters in, so the phrase is cut while it is spoken.
- Concept `body` (brain, cortisol, sleep, stress, Körper …): heartbeat pulse. `speed` also knows car, lap, drive, Runde and Strecke.

## Numbers as graphics, annotations, checklists

Numbers show what they mean (`tools/viz.mjs`, deterministic, English and German):

| In the text | Graphic below the phrase |
| --- | --- |
| `40%`, `forty percent`, `half of` | bar of 20 segments that fills in sync with the count-up |
| `doubled`, `3x`, `three times more`, `verdoppelt`, `halbiert` | before/after bars, the second grows to N times |
| `team of six`, `thirty days`, `ten seconds` | N pictograms (people, calendar days, tally marks) that appear one after another |

Where the speaker **relates numbers to each other**, Claude picks a graphic itself with `--llm` (`charts` in the staging), using only numbers that were spoken or follow exactly from them:

| Graphic | Example |
| --- | --- |
| `growth`: a curve that keeps getting steeper, with the straight line dashed for comparison | "after 50 years around €258,000" – €60,000 paid in |
| `split`: one bar split into 2–3 parts of a whole, the part being discussed in the accent colour | €60,000 paid in · €198,000 return |
| `compare` / `gauge` with a computed value | "exceeds it many times over" → 3.3× |

There is at most one graphic per phrase; percentages and factors win over pictograms. The graphic is always complete before the phrase fades out.

**German numbers:** `258.000` and `3,5` count up in their own format (not as `258,000` / `3.5`), and graphics are labelled in the format of the detected language (`258.000 €` / `€258,000`). In keyword mode a number stays together with its unit: "100 Euro", "50 Jahren", "40 Prozent".

**Hand-drawn annotations** draw onto a word as if with a pen: `circle` (key term), `underline` (key statement), `strike` (what is negated or replaced; the word fades). Claude places them sparingly with `--llm`. Without the LLM the rule "not X but Y" / "nicht X sondern Y" / "instead of X" applies: X is struck through, Y circled. An underline across another line becomes a circle; a word that fills almost the whole width is underlined instead of circled.

**Lists** of 3–6 short comma-separated items ("Reports, tickets, first drafts") stay together in one phrase and are set as a checklist. Every item gets a box that is ticked as soon as it is spoken.

## Real podcasts: speakers and fillers

```bash
# once: local speaker detection (sherpa-onnx, ~47 MB of models, runs on the CPU)
python3 -m venv .venv && .venv/bin/pip install sherpa-onnx numpy soundfile
mkdir -p models/diarize && cd models/diarize
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
tar xjf sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 && rm sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx
cd ../..

# excerpt from a real episode (NASA, public domain): transcript without speakers, --diarize detects them
node tools/build.mjs examples/moonbase/transcript.json --preset podcast --audio examples/moonbase/audio.wav \
  --title "Houston We Have a Podcast" --subtitle "The Moon Base · NASA" --speakers "A=Host,B=Guest" \
  --diarize --llm --out videos/moonbase
```

`--diarize` (`tools/diarize.py`) uses pyannote segmentation and TitaNet voiceprints to find out who speaks when, and labels every word with `A`, `B`, … in order of first appearance. The number of voices is estimated; `--diarize 3` sets it. Then even a voice with only one short sentence ("Yes, that sounds solid.") counts as its own speaker. One- or two-word switches in the middle of a turn and "speakers" with only a few seconds of speaking time are merged into their neighbour. The result is cached as `<transcript>.speakers.json`. `--speakers A=Name,…` gives the voices names.

A second pass then checks every sentence by voiceprint. If a sentence clearly sounds like another speaker, it is moved over as a whole. This happens, for example, when the segmentation sets the boundary too late and the host's question sticks to the guest's answer.

Tightly cut clips such as shorts hardly have pauses. There the segmentation often only finds one voice. If a count is given and not reached, every sentence of the transcript gets its own voiceprint instead. Sentences of 0.7 s and longer are grouped into N voices, short interjections ("Yes.", "Exactly.") go to the most similar voice.
Tested on 10 minutes of "Houston We Have a Podcast": all four of the host's questions were separated correctly, in about 1.5 minutes on the CPU.

**Find a highlight** (`tools/highlight.mjs`): cut the strongest moment out of a whole episode.

```bash
node tools/highlight.mjs episode.mp3 --out examples/my-clip                  # Claude picks 40–75 s
node tools/highlight.mjs episode.mp3 --out examples/my-clip --from 1840.2    # editor: start on this sentence
node tools/build.mjs examples/my-clip/transcript.json --audio examples/my-clip/audio.wav --preset podcast \
  --aspect 9:16 --speakers "A=Jane Doe" --diarize --llm --out videos/my-clip
```

Long files are transcribed with Parakeet in 10-minute chunks (the CLI otherwise fails on its timeout) and cached as `<audio>.words.json`. Claude reads the episode as numbered sentences and proposes up to three clips: understandable without the rest of the episode, with a hook at the start and a payoff at the end. `highlight.json` contains the title, the reasoning and the alternatives. `--hint "…"` steers the search, `--from`/`--to` (seconds in the source) set the cut by hand to the nearest sentence boundary.

**Keyword mode** (podcast default, `--keywords` / `--full-text`): the sentence runs small as a caption, and the spoken word lights up in the speaker's colour. Only words with weight (hero, marker, image, number, annotation) appear big and animated. If two keywords are less than 1.4 s apart, they share a lockup, and each stays until the next one. **Quotes:** Claude picks the punchline (`quotes`), which appears as a whole sentence in quotation marks instead of in pieces. **Reading time:** phrases that would be shorter than the minimum reading time (podcast 1.25 s, social 0.95 s, lyric 0.8 s) merge with the nearest neighbour of the same voice.

**Full-text mode for short-form** (social default, `--full-text` for podcast): every word appears big. In portrait, phrases of five words or more are stacked instead of set in one or two small lines. No empty frame appears between two phrases if the pause is shorter than 0.8 s. If there isn't enough time for a long last word ("Neukundenverträgen"), it appears without an effect and stays until the next phrase comes; that phrase waits up to 0.3 s for it. Phrases that are too short merge into a slightly longer lockup if necessary.

**Effect budget:** So that long excerpts don't light up every second, accents keep a minimum distance per preset: image effects (word effect + 3D motif) 6 s for podcast, 2.4 s for social, 1.6 s for lyric; annotations 9 / 4.5 / 4 s; markers 3.2 / 1.6 s. The strongest words win (emphasis, hero, numbers), the rest are set calmly. Hand-set `fx`/`concept`/`note` always stay. The camera only pushes forward on hero words (at most every 2.4 s, weaker for podcast); single words only make the world breathe slightly.

Fillers and stutters ("is is", "the the") are removed before analysis; `--keep-fillers` keeps them. The fillers depend on the detected language: English "uh", "um", "er"; German "äh", "ähm", "öhm" – because German "um" and "er" are real words.

### Repairing gaps and mishearings

`tools/repair.mjs`: Parakeet occasionally drops a whole clause or merges two words ("verdeutliben" instead of "verdeutlicht eben"). The highlight finder therefore runs Whisper (whisper.cpp, multilingual) over every clip automatically:

- Stretches where the audio contains speech but the transcript has no words are cut out, transcribed again and spliced in.
- Whisper listens to the whole clip a second time. Where the two recognisers disagree on up to four words, Claude decides in the context of the sentence which reading is right, or corrects minimally (for example a wrongly joined compound). Both mishear: Parakeet turned "verdeutlicht eben" into "verdeutliben", Whisper turned "Netzentgelte" into "Netzeingelte". The timings stay Parakeet's. Longer differences are left untouched, and without Claude Parakeet wins. Only real words are taken over (no "-?") and never more words than fit into the time span.

```bash
# once: whisper-cli (whisper.cpp) on the PATH and a multilingual model
curl -L -o ~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin

node tools/repair.mjs clip.wav transcript.json --lang de --crosscheck   # also usable on its own
```

Repaired words carry `"repaired": true`. `--no-repair` makes the highlight finder skip this step.

## Automatic quality check

```bash
npm run qa -- videos/my-clip      # or: node tools/qa.mjs videos/my-clip [--no-contrast] [--frames 12.5,30]
```

`tools/qa.mjs` plays the finished project in headless Chrome with the same bundles as the render (puppeteer-core, Chrome from `~/.cache/puppeteer` or `CHROME=…`) and jumps, for every lockup, to the moment when all its words are fully drawn:

| | Check |
| --- | --- |
| ✗ | word sticks out of the frame · two lockups at once · contrast below 1.8:1 |
| ⚠ | word fully readable for less than 0.3 s before fading · lockup shorter than 0.6 s · outside the action-safe area (5 %) · words overlap each other or the HUD · contrast below 3:1 · caption needs more than two lines · speech in the audio without words in the transcript |

Contrast is measured, not estimated: two screenshots of the same frame, with and without the text layer. The pixels that differ strongly are the type; their luminance is compared with what lies directly around them in the finished frame, including the soft halo behind the type (WCAG formula). `--frames` additionally saves stills at the given times (`qa/at-<t>s.png`). Result: a list in the terminal, `qa/report.json` and one frame per finding in `qa/`. Exit code 1 on errors, so it fits into scripts.

## Alignment with the audio

Word timings from speech recognition often drift by 100–500 ms and sometimes land in the silence after the word. That is why the build aligns the timings with the audio whenever `--audio` is given (`tools/align.mjs`). Candidate word boundaries are voice onsets after pauses and after short energy dips between syllables. Dynamic programming picks, for all words together and in fixed order, the boundaries that best match the ASR times. A word that lies in silence is penalised. Word ends that reach into silence are pulled back to the end of the voice. With `--no-align` the timings stay as they are in the transcript.

In addition, every word effect starts earlier by its own lead time. So the moment the word becomes readable falls on the onset, not just the start of the animation. The last word of a phrase stays for at least 0.35 s.

## Directed by Claude (`--llm`)

```bash
node tools/build.mjs transcript.json --audio voice.wav --aspect 16:9 --llm                      # headless `claude -p` (Claude subscription)
node tools/build.mjs transcript.json --audio voice.wav --aspect 16:9 --llm --llm-backend api    # ANTHROPIC_API_KEY or `ant auth login`
```

With `--llm` Claude reads the whole transcript and stages it (`tools/llm-annotate.mjs`):

- **Phrases** by meaning and breath, not by rules of thumb
- the **hero word** of each phrase and **fillers** that are set small, in any language
- **concept, effect and strength** only for words that carry an image, taking context, negation, idioms and metaphors into account
- **mood, layout and exit** per phrase, with moods held across whole passages
- **annotations** (circle, underline, strike) and **checklists** for lists

Claude only chooses from the renderer's fixed vocabulary, and the output is schema-bound via structured output. The build checks that the phrases cover the transcript without gaps. The response is saved as `<transcript>.staging-landscape.json` or `-portrait.json` and reused on every further build. That keeps the render reproducible, and the file can be edited by hand. `--llm-refresh` asks again. Long transcripts are processed in windows of about 450 words, with the whole transcript running along as cached context. Without credentials or on an error, the build automatically falls back to the lexicon.

## Directed by another agent (`--staging-brief`, `--staging`)

If the build runs inside an agent (Claude Code, a chat agent, …), that agent can do the directing itself instead of `claude -p`:

```bash
node tools/clip.mjs upload.mp4 --out shorts/x          # audio, video, words (Parakeet, gaps via Whisper)
node tools/build.mjs shorts/x/transcript.json --audio shorts/x/audio.wav --video shorts/x/video.mp4 \
  --preset podcast --aspect 9:16 --full-text --diarize 2 --staging-brief shorts/x/brief.md --staging shorts/x/staging.json
# the agent reads brief.md and writes staging.json
node tools/build.mjs … --staging shorts/x/staging.json --out shorts/x/project
```

`brief.md` contains the same as the prompt for Claude: vocabulary, rules, numbered words and the JSON schema. The file is checked with the same rules as Claude's response. If something is wrong, the build stops with exit code 2 and the offending field (`words.0.fx: Invalid option …`) instead of falling back to the lexicon. The file may additionally contain `fixes`: words the speech recognition misheard, in the correct spelling; the timings stay. Tested with Claude Sonnet as director: valid on the first attempt, QA 0 errors.

All fonts are embedded in the composition, so it looks the same in a plain HTML player as in the render.

## Transcript format

Accepted: `[{text,start,end}]`, `{words:[…]}`, Whisper-style `{segments:[{words}]}` as well as `startMs`/`endMs`.
Optional per-word overrides:

| Field | Effect |
| --- | --- |
| `fx` | force a word effect: `rise drop flicker glow sparkle fog whisper slam glitch wave spin pulse shatter flash streak mask depth blur blink redact bounce window count` |
| `concept` | force a concept (`fire`, `water`, `time`, …) or `null` to switch it off |
| `emphasis` | 0..1, controls size and hero choice |
| `hero` | `true`: the word becomes the phrase's hero |
| `break` | `true`: a new phrase starts after this word |
| `note` | `circle`, `underline` or `strike`: force an annotation by hand |
| `viz` | e.g. `{"kind":"gauge","value":75}`, `{"kind":"compare","value":2}`, `{"kind":"units","value":5,"icon":"person"}`; `null` switches off the automatic graphic |

## Pipeline

```
transcript.json ──► tools/analyze.mjs ──► plan.json ──► compositions/
                     · phrases (punctuation, pauses, clause starters,       world.html   three.js world  (graphics)
                       word count per aspect, no dangling articles)         lyrics.html  typography      (captions)
                     · role: function word (serif italic) / content word    overlay.html grain + HUD     (graphics)
                       (League Gothic)                                      index.html   hosts + audio
                     · concept lexicon EN+DE (tools/lexicon.mjs)
                     · emphasis → hero word, layout (hero/block/cascade/inline/split)
                     · mood track (palette) + motif events + onsets
```

`plan.json` is editable (layouts, moods, exits, hero …). `node tools/build.mjs --plan plan.json` rebuilds from it.

**Concept → word effect → 3D motif** (excerpt):

| Concept | Word | World |
| --- | --- | --- |
| rise / sky | letters rise, phrase drifts up | rising particles, clouds |
| fall / rain | letters drop with a bounce | rain streaks |
| fire | flicker + ember glow | embers |
| light | glow burst | sun with rays |
| stars | sparkles | star field, twinkle |
| water | wave motion | dot ocean |
| time | 3D flip | gyroscope rings, clock ticks |
| world | 3D flip | dot planet with atmosphere |
| love | heartbeat pulses | double pulse rings |
| break | letters explode | glass shards |
| electric | glitch, RGB split | lightning, glitch pass |
| city | neon switch-on | neon grid + skyline |
| loud | slam + shake | shockwave, camera shake |
| dark / quiet | blur-in, wide spacing, serif | fog, desaturated |

Everything is deterministic: the world is a pure function `(plan, t)`, particle motion runs on pre-integrated phases, and randomness comes from seeded PRNGs. three.js's time and random helpers are replaced by deterministic stand-ins during bundling (`tools/build.mjs`).

## Files

- `engine/signals.js`: palettes, motif levels, phases, pulse rings (shared by world and type)
- `engine/world.js`: three.js scene (nebula shader, particles, motifs, bloom, CA)
- `engine/type.js`: layout via canvas measurement and the GSAP timeline for all word and phrase effects
- `engine/overlay.js`: grain, HUD, progress
- `tools/build.mjs`: entry point – transcript → HyperFrames project
- `tools/short.mjs`: a short from a clip, step by step, in one project folder (for agents)
- `tools/analyze.mjs`, `tools/lexicon.mjs`, `tools/viz.mjs`: phrasing, concepts, number graphics
- `tools/llm-annotate.mjs`: staging by Claude or by the agent running the build
- `tools/align.mjs`, `tools/audio.mjs`: word timings snapped to the audio, audiogram bands
- `tools/burnin.mjs`: finds burned-in captions and overlays in the video
- `tools/clip.mjs`: a clip someone brings (video or audio) → folder with `audio.wav`, `video.*`, `transcript.json`
- `tools/asr.mjs`: Parakeet via the HyperFrames CLI in 10-minute chunks (shared by clip and highlight)
- `tools/highlight.mjs`, `tools/repair.mjs`, `tools/gaps.mjs`: highlight finder, ASR repair, voiced-gap detection
- `tools/diarize.py`: speaker detection (sherpa-onnx)
- `tools/footage.mjs`: video background (gradient, push-in, world via `screen`), shared by render and QA
- `tools/qa.mjs`: automatic quality check

## Examples

| Folder | Content |
| --- | --- |
| `examples/demo/` | own demo lyrics (`script.txt`), Kokoro TTS voice, Whisper timings |
| `examples/podcast/` | scripted two-person podcast (`script.json`), Kokoro TTS voices |
| `examples/social/` | scripted short-form voiceover (`script.txt`), Kokoro TTS voice |
| `examples/moonbase/` | excerpt from NASA's "Houston We Have a Podcast" (public domain) |

Only use footage and audio you have the rights to. Build output (`videos/`, `renders/`, `index.html`, `compositions/`, …) is git-ignored.

## Requirements

Node.js 20+, ffmpeg, the HyperFrames CLI (pinned in `package.json`, run via `npx`). Optional: Python 3 + sherpa-onnx (`--diarize`), whisper.cpp (`repair.mjs`), Claude Code or an Anthropic API key (`--llm`).
