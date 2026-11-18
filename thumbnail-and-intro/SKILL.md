---
name: thumbnail-and-intro
description: Makes a topic-specific thumbnail and matching 3–5 s animated intro (16:9 or 9:16) for the video being made, from a telling frame or screenshot in the brand kit's look; not logo bumpers.
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

`<skill>` is this skill's directory. Run its tools from your own working directory. Never alter another skill, the brand kit or existing video outputs. Answer briefly in the person's language.

## Setup (once per machine)

```bash
cd <skill> && npm ci --ignore-scripts
```

Needs Node >=22.12, local Chrome, the HyperFrames CLI, and ffmpeg/ffprobe for video frames; `CHROME` can point at Chrome, `HYPERFRAMES_BIN` at the CLI. This skill does not install them: say clearly when one is missing. Google-font download and the pinned GSAP CDN need network; font and image files are local at render time.

## The job

**A specific opening promise for this video**, not a reusable empty brand bumper. Thumbnail and intro share headline, main visual, type and colours; the intro reveals this same composition in 3–5 seconds, then holds it. Never splice it into the source video unless asked.

The composition starts from the recurring large-type Storrito tutorial series: short oversized left headline, vivid brand gradient, right-hand subject/UI screenshot, one purposeful arrow. **Composition is the reference; the current brand kit determines its look.** Never hardcode Storrito's palette, mascot or font for another brand.

## 1. Use the current video's context

Use the video, script, transcript, selected clip and brief already in this conversation or job; do not ask for them again. Find the topic and one demonstrated outcome, a truthful opening promise, language, target platform, source aspect ratio, and one image that makes the topic recognizable.

No video or brief: ask once. Never guess the topic from the brand's website alone. A URL may be inspected with available authorized tools; the CLI takes local media, not URLs. Video not finished: its approved script and a real related screenshot can supply the packaging.

Local video: inspect representative frames before choosing; the default extraction at one second is only a technical fallback, **not semantic scene selection**. Avoid fades, blinks, cursor-obscured UI, tiny unreadable interfaces and meaningless first frames. Pick a deliberate `frameTime`, or supply a cropped image in `image`. Extracting a still does not analyse or transcribe the video.

Supplied people only: never invent a presenter or replace a face. Cut out or crop only when authorized and useful. App screenshots show the actual discussed control or result. Keep originals; save crops separately. `imageFit: "contain"` for UI, `"cover"` for photos, with an explicit focus if needed.

## 2. Read the existing brand kit

Find this brand's `brand/DESIGN.md` (or the brand directory named in the job), not the first kit on disk, and read it including its prose: colours, typography, logo, voice, imagery, do's and don'ts.

No kit: offer the adjacent `brand-kit` skill and follow its workflow first. A website-derived draft is **unconfirmed**, not an approved kit: fine for a clearly labelled technical demo if you state its status. Never silently replace an approved kit with website extraction.

The tool reads YAML `colors.primary`, optional `secondary`/`tertiary`, `on-primary`, typography `headline-display` or `headline-lg`, optional `body-md`/`label-md`, `fonts`, `uppercase`, and `logo.primary`; token references such as `{colors.primary}` are resolved (supported values: README). Missing primary, missing headline typography or unavailable fonts stop the job; no silent fallback to Inter or an invented identity. Logo missing: omit it and say so, never redraw it.

Use a brand gradient if suitable. If the brand prohibits gradients, use its solid primary (a single-colour gradient); record that choice in the new job's composition, never in DESIGN.md. Black/white are neutral contrast and screenshot/logo mat aids, not new brand hues. Contrast scrim decisions appear in the manifest. The logo stays unmodified on a white chip.

## 3. Draft the packaging

Read `<skill>/references/storrito-style.md` before composing: what was observed in the Storrito series and what not to copy.

Hook: normally 3–6 words (the tool accepts 3–8), grounded in the video, truthful, legible at thumbnail size. No long German compound words, no repeated full video title, no made-up outcomes, fake urgency, invented numbers, rankings or endorsements.

Format from the current output: YouTube long-form 16:9; story/reel/short 9:16. Do not assume vertical; ask only if the destination stays ambiguous. Both requested: separate layouts, not a blind centre crop.

- Landscape: headline left, subject right, one focal point; logo small, secondary copy optional. Thumbnail 1280×720, intro 1920×1080.
- Portrait: headline above subject, mobile-safe internal margins. Thumbnail/cover and intro 1080×1920. Platform cover handling varies; do not promise direct YouTube Shorts cover upload.
- At most one short subtitle; drop it if it hurts mobile legibility.
- At most one arrow, pointing at something the video actually discusses. The tool includes one by default; remove it from a new composition when it has no meaning.
- No mascot by default; the brand's real mascot only when it is in the kit and the job needs it.
- No music or voice by default: a silent graphics intro.

Decide small things without asking. Headline meaning uncertain: show two truthful options and ask one question. Do not ask about style tokens the kit already sets.

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

All input paths are relative to **job.json**. An approved screenshot instead of a frame: `image: "topic.png"` (`video` may then be omitted; an explicit image wins over frame extraction). Omit `subtitle` if not useful. Omit `layout` to infer orientation from the source video; without video the default is landscape. Optional photo focus: `"focus": {"x": 0.65, "y": 0.4}`.

```bash
node <skill>/tools/package.mjs prepare work/<video-slug>/job.json work/<video-slug>/build-01
node <skill>/tools/package.mjs render work/<video-slug>/build-01
```

`prepare` creates local assets, the manifest and a HyperFrames `composition/index.html`. `render` checks image decoding, exact fonts, overflow, canvas bounds and timeline duration in Chrome, then creates `thumbnail.png` (the intro's settled state) and `intro.mp4`. Source media are never modified. The default render is one robust layout, not style presets: the art direction is yours.

Every revision gets a **new build directory**: the tools refuse existing output dirs and exports. A failed prepare may leave a marked incomplete folder: choose a new target rather than deleting or overwriting it. Editing an unrendered new composition to fit the brief: keep the file and manifest consistent and revalidate before export. Never claim the rendered file exists because the HTML does.

## 5. Look, test, show

Open the actual PNG and at least one early and one settled frame of the MP4: the headline must read at about 320 px wide; the arrow's screenshot area visible; the intro settles early, keeps the hook visible, lasts 3–5 s; resolution, duration and PNG match the requested format and the manifest. Fix poor art direction even when automated checks pass. Compare the PNG with a decoded last frame; never promise byte-identical pixels across codecs. After substantive CSS changes, render a new build and look again.

Copy only the deliverables the person needs into a NEW `artifacts/<video-slug>-packaging/` folder; test logs, reference contact sheets and validation notes go to `artifacts/notes/` or working files. In one short response link the thumbnail and intro, mention format/duration and any unconfirmed brand assumptions, and ask whether hook and style are right. No publishing, scheduling, video replacement or deletion without explicit permission.

## Boundaries

This skill packages a video: it does not make the full video, generate fake screenshots, transcribe media or promise clicks. You choose the hook and the source frame; the CLI only renders them with the brand kit.
