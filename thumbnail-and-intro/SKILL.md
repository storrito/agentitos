---
name: thumbnail-and-intro
description: Create a topic-specific thumbnail and matching short animated intro for the video currently being made. Read the video's actual subject and choose a meaningful frame, screenshot or supplied portrait; inherit colors, typography and original logo from the brand-kit skill's DESIGN.md. Use for YouTube thumbnails, video covers and matching 16:9 or 9:16 intros, not generic logo animations or full video editing.
license: MIT
metadata:
  title: "Video thumbnail & intro"
  title-de: "Video-Thumbnail & Intro"
  summary: "A thumbnail and matching animated intro for your current video, with its own hook and imagery, in your brand kit's colors and fonts."
  summary-de: "Thumbnail und passendes animiertes Intro für dein aktuelles Video: mit eigenem Aufmacher, passenden Motiven und Farben und Schriften aus deinem Brand-Kit."
  ask: "Which video are we packaging? I can use the one we are already making and its brand kit."
  ask-de: "Für welches Video? Ich kann das gerade erstellte Video und sein Brand-Kit verwenden."
  placeholder: "Current video, local file or video link"
  placeholder-de: "Aktuelles Video, Videodatei oder Video-Link"
  inputs: "video,image"
---

# thumbnail-and-intro

`<skill>` is this skill's directory. Run its tools from your own working directory. Do not alter another skill, the brand kit or existing video outputs. Respond briefly in the person's language.

## Setup (once per machine)

```bash
cd <skill> && npm ci --ignore-scripts
```

Needs Node >=22.12, local Chrome and HyperFrames CLI; ffmpeg and ffprobe for video frames. `CHROME` can point at Chrome, `HYPERFRAMES_BIN` at the CLI. These are prerequisites, not automatically installed by this skill. Say clearly when one is missing. Google-font download and the pinned GSAP CDN require network access. Font and image files are local at render time.

## The job

Produce **a specific opening promise for this video**, not a reusable empty brand bumper. Thumbnail and intro share the headline, main visual, type and colors. The intro reveals this same composition in 3–5 seconds, then holds it. Never splice it into the source video unless asked.

The visual starting point is the recurring large-type Storrito tutorial series, not every thumbnail on its channel: short oversized left headline, vivid brand gradient, right-hand subject/UI screenshot and one purposeful arrow. Read `references/storrito-style.md` for what was observed and what not to copy. **Composition is the reference; the current brand kit determines its look.** Never hardcode Storrito's palette, mascot or font for another brand.

## 1. Use the current video's context

First use the video, script, transcript, selected clip and brief already available in this conversation or job. Do not ask for them again. Identify:
- the video's actual topic and one demonstrated outcome;
- the viewer's question and a truthful opening promise;
- the language, target platform and source aspect ratio;
- one image that makes the topic immediately recognizable.

If no video or brief is available, ask once for it. Do not guess a topic from the brand's website alone. A URL may be inspected with available authorized tools; the CLI itself takes local media, not URLs. If the video is not finished, its approved script and an actual related screenshot can supply the packaging.

With a local video, inspect representative frames before choosing one. A default extraction at one second is only a technical fallback, **not semantic scene selection**. Avoid fades, blinks, cursor-obscured UI, tiny unreadable interfaces and meaningless first frames. Pick a deliberate `frameTime`, or supply a cropped image in `image`. Extracting one still does not analyze or transcribe the video.

Use supplied people only; do not invent a presenter or replace a face. Cut out or crop only when authorized and useful. App screenshots should show the actual discussed control or result. Preserve originals; save crops separately. Use `imageFit: "contain"` for UI and `"cover"` for photos, with an explicit focus if needed.

## 2. Read the existing brand kit

Locate the relevant `brand/DESIGN.md` or the brand directory already named in the job. Read it including its prose: colors, typography, logo, voice, imagery, do's and don'ts. The path must belong to this brand, not the first kit found on disk.

If no kit exists, offer the adjacent `brand-kit` skill and follow its workflow first. A website-derived draft is **unconfirmed**, not an approved brand kit. For a clearly labeled technical demo a draft is fine; state that status. Do not silently replace the approved kit with website extraction.

The tool consumes YAML `colors.primary`, optional `secondary`/`tertiary`, `on-primary`, typography `headline-display` or `headline-lg`, optional `body-md`/`label-md`, `fonts`, `uppercase`, and `logo.primary`. Token references such as `{colors.primary}` are resolved. See README for supported values. Missing primary, missing headline typography or unavailable fonts stop the job. There is no silent fallback to Inter or another invented brand identity. Logo missing: omit it and disclose, never redraw it.

Use a brand gradient if suitable. If the brand prohibits gradients, use its solid primary (a single-color gradient); adjust only the NEW job's composition and record that choice, not DESIGN.md. Black/white are neutral contrast and screenshot/logo mat aids, not new brand hues. Contrast scrim decisions appear in the manifest. The logo remains unmodified on a white chip.

## 3. Draft the packaging

Write a short hook, normally 3–6 words (tool accepts 3–8). It must be grounded in the video's content, truthful and legible at thumbnail size. Avoid long German compound words, repeating a full video title, made-up outcomes, fake urgency, invented numbers, rankings or endorsements.

Choose the format from the current output: YouTube long-form uses 16:9; story/reel/short uses 9:16. Do not assume all video work is vertical. Ask only if the destination genuinely remains ambiguous. If both are requested, make separate layouts, not a blind center crop.

For the common layout:
- Landscape: headline left, subject right, one clear focal point; logo small, secondary copy optional. Thumbnail is 1280×720, intro 1920×1080.
- Portrait: headline above subject, mobile-safe internal margins. Thumbnail/cover and intro are 1080×1920. Platform cover handling may vary; do not promise direct YouTube Shorts cover upload.
- One short subtitle at most; remove it if it hurts mobile legibility.
- One arrow at most, pointing at something the video actually discusses. The tool includes an arrow by default; remove it from a new composition when it has no meaning.
- No mascot by default. Use the brand's real mascot only when present in the kit and the job needs it.
- No music or voice by default. The output is a silent graphics intro.

Small decisions can be made without interrupting. If headline meaning is uncertain, show two truthful options and ask one question. Do not ask about every style token already specified by the kit.

## 4. Prepare a new build

Create `work/<video-slug>/job.json`:

```json
{
  "brand": "../../brand",
  "video": "source.mp4",
  "headline": "Instagram Stories automatisch planen",
  "subtitle": "Der Ablauf Schritt für Schritt",
  "frameTime": 12.4,
  "layout": "landscape",
  "duration": 4,
  "imageFit": "contain"
}
```

All input paths are relative to **job.json**. If supplying an approved screenshot rather than a video frame, use `image: "topic.png"`; `video` can be omitted when an image is supplied. An explicit image takes precedence over frame extraction. Omit subtitle if not useful. Omit layout to infer orientation from the source video; without video the default is landscape. Optional photo focus: `"focus": {"x": 0.65, "y": 0.4}`.

```bash
node <skill>/tools/package.mjs prepare work/<video-slug>/job.json work/<video-slug>/build-01
node <skill>/tools/package.mjs render work/<video-slug>/build-01
```

`prepare` creates local assets, manifest and a HyperFrames `composition/index.html`. `render` checks image decoding, exact fonts, overflow, canvas bounds and timeline duration in Chrome, then creates `thumbnail.png` and `intro.mp4`. The static image corresponds to the settled intro state. No source media is modified. The CLI's default render is deliberately one robust layout, not an automatic art director or multiple style presets.

Every revision gets a **new build directory**. Tools refuse existing output dirs and existing exports. Failed preparations may leave a clearly marked incomplete folder; choose a new target rather than deleting or overwriting it. If editing an unrendered new composition to better express the brief, keep the generated file and manifest consistent and revalidate before export. Never claim the rendered file exists just because HTML exists.

## 5. Look, test, show

Open the actual PNG, and inspect at least one early and one settled frame of the MP4. Check:
1. Does it unmistakably describe this particular video?
2. Is the large headline readable at about 320 pixels wide? No accidental clipping, face cutoffs or busy overlap?
3. Are colors/fonts/logo traceable to the correct kit? Does the brand's voice fit?
4. Is the arrow meaningful, with the relevant screenshot area visible?
5. Does the intro move deliberately, settle early and keep the hook visible? Is duration 3–5 seconds?
6. Do exported resolution, duration and PNG match the requested format and manifest?

Fix poor art direction even when automated checks pass. Compare the PNG with a decoded last frame rather than promising byte-identical pixels across codecs. If adding substantive CSS changes, render a new build and inspect it again.

Copy only the deliverables the person needs under a NEW `artifacts/<video-slug>-packaging/` folder. Keep test logs, reference contact sheets and validation notes out of the main deliverables (use `artifacts/notes/` or working files). Link the thumbnail and intro in one short response, mention format/duration and any unconfirmed brand assumptions. Ask whether the hook/style is right. No publishing, scheduling, video replacement or deletion without explicit permission.

## Boundaries

This skill packages a video; it does not make the full video, auto-generate fake screenshots, transcribe media, promise clicks, or publish anything. The agent chooses the hook and the meaningful source frame; the CLI faithfully renders these inputs with the brand kit. Other Agentitos skills can supply the script/video and brand kit. Existing outputs are untouched.
