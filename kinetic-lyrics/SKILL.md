---
name: kinetic-lyrics
description: Turn spoken audio or a talking-head/podcast clip into a kinetic-typography video (lyric-video style) where words animate by meaning over a three.js world. Use for lyric videos, podcast audiograms, short-form social clips (9:16) with animated captions, or cutting the best highlight out of a long episode. Input is an audio/video file or a word-timed transcript; output is a HyperFrames project rendered to MP4.
---

# kinetic-lyrics

Self-contained recipe: everything lives in this folder. Run all commands from here. Full reference: [README.md](README.md).

## Setup (once)

```bash
npm install                                   # node 20+, ffmpeg required
npx hyperframes models install parakeet       # word-level ASR
```

Optional extras, only when the task needs them (see README for the exact steps):
- `--diarize` (who speaks when): Python venv + sherpa-onnx models in `models/diarize/`
- `tools/repair.mjs` (fix ASR gaps/mishearings): `whisper-cli` on the PATH + a model in `~/.cache/whisper.cpp/`

## Pick the entry point

| You have | Run first |
| --- | --- |
| a short clip (video or audio, < ~3 min) | `node tools/clip.mjs <clip> --out work/<name>` → `audio.wav`, `video.*`, `transcript.json` |
| a long episode, want the best 40–75 s | `node tools/highlight.mjs <episode> --out work/<name> [--hint "…"]` |
| audio only | `npx hyperframes transcribe audio.wav -e parakeet` → `transcript.json` |
| a word-timed transcript | go straight to the build |

## Build

```bash
node tools/build.mjs work/<name>/transcript.json --audio work/<name>/audio.wav \
  [--video work/<name>/video.mp4] --preset lyric|podcast|social [--aspect 9:16] \
  [--world cosmos|aurora|editorial|geometry|bokeh|neon|noir] \
  [--title "…"] [--subtitle "…"] [--speakers "A=Name,B=Name"] [--diarize [N]] \
  --out videos/<name>
```

- Presets: `lyric` (music, big gestures, 16:9), `podcast` (calm, speaker chips, audiogram, keyword mode), `social` (9:16, hook card, CTA via `--cta "…" --handle @x`).
- For Instagram Stories / Reels / TikTok use `--aspect 9:16` (social is 9:16 by default); add `--full-text` for podcast footage in portrait.

### Directing (staging)

The staging decides phrases, hero words, effects, moods and annotations. Three options:

1. **You direct (preferred when you are an agent):** add `--staging-brief work/<name>/brief.md --staging work/<name>/staging.json` and run the build. It writes the brief and stops. Read `brief.md`, write `staging.json` that follows its schema exactly, then rerun the same command with `--staging work/<name>/staging.json --out videos/<name>`. Exit code 2 means the staging failed validation; the message names the field. Fix it and rerun. You may add `fixes` for misheard words.
2. `--llm`: the build calls Claude itself (`claude -p`, or `--llm-backend api` with `ANTHROPIC_API_KEY`). Cached as `<transcript>.staging-*.json`; `--llm-refresh` to redo.
3. Neither: deterministic keyword lexicon (English + German).

## Check and render

```bash
node tools/qa.mjs videos/<name>          # exit 1 on errors; findings + frames in videos/<name>/qa/
cd videos/<name>
npx hyperframes render -o renders/out.mp4             # CPU, ~3 s/frame
npm run render:gpu -- -o renders/out.mp4              # NVIDIA GPU, ~0.2 s/frame
```

Fix every QA error (✗) before rendering: usually by changing the staging (shorter phrases, `break`, a different layout) or `--video-shade` for footage. Review warnings (⚠). For a visual check use `node tools/qa.mjs videos/<name> --frames 5,12.5` and look at `qa/at-*.png`.

## Rules

- Never hand-edit generated `compositions/*.html` or `assets/engine/*`; change the transcript overrides, the staging or `plan.json` and rebuild (`node tools/build.mjs --plan videos/<name>/plan.json --out videos/<name>`).
- Everything must stay deterministic (no `Date.now()`, `Math.random()`, network in compositions).
- Only use footage and audio the user has the rights to.
- When editing the engine or compositions by hand, follow [AGENTS.md](AGENTS.md) (HyperFrames rules) and load the `/hyperframes` skills if available.
