# Video thumbnail & intro

Agentitos skill for a **video-specific thumbnail plus a matching 3–5 second intro**, with colours, fonts and logo from the brand-kit skill's `DESIGN.md`. The hierarchy follows Storrito's recurring tutorial series; the brand itself is not hardcoded.

## What this first version does

- Source: a local video or a chosen topic image/screenshot.
- Brand kit: YAML tokens, resolved references, original local logos, Google Fonts or local font files.
- One working base layout: large headline, brand gradient, topic screenshot and arrow. Portrait is laid out on its own, not cropped from landscape.
- A PNG thumbnail and a matching animated MP4, silent.
- Format from the video's orientation or set explicitly: 16:9 or 9:16.
- Local assets, a manifest with sources, checks for missing fonts/images and text overflow.
- No overwriting of existing builds/exports, no publishing, no change to the source video.

**The agent makes the editorial choices:** it reads the brief/script, inspects images and decides on the hook and the frame. The CLI does not analyse the video's content and does not transcribe. It currently has one layout renderer, no preset library and no AI cut-out tool.

## Setup

Node ≥22.12, an installed HyperFrames CLI and a local Chrome are required. For video frames also ffmpeg and ffprobe. Setup only installs this folder's Node dependencies:

```bash
npm ci --ignore-scripts
```

Chrome: `CHROME`, `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH` or `PRODUCER_HEADLESS_SHELL_PATH`; otherwise an existing Puppeteer headless cache or Chrome/Chromium on PATH. HyperFrames: on PATH or `HYPERFRAMES_BIN` with an absolute path. This skill downloads no browser and runs no system-wide install step.

## Usage

`SKILL.md` is the agent workflow. The tools:

```bash
node tools/package.mjs prepare /absolute/job.json /absolute/new-build
node tools/package.mjs render /absolute/new-build
```

Example `job.json`:

```json
{
  "brand": "brand",
  "video": "my-video.mp4",
  "headline": "Schedule stories automatically at last",
  "frameTime": 12.4,
  "layout": "landscape",
  "duration": 4,
  "imageFit": "contain"
}
```

All input paths are relative to `job.json`, the target folder relative to the current working directory. Without `video`, `image` is required. An explicit `image` takes precedence over frame extraction. Without `frameTime` an early position is chosen technically; that is **not a choice of the best moment**. The agent should determine a suitable frame. Headline: 3–8 words. Optional: `subtitle`, `focus: {x: 0.5, y: 0.5}`, `imageFit: "cover"` for photos. For UI, `contain` is the safe default.

Without `layout`, the video's displayed orientation including rotation metadata is used. Without a video the default is landscape. Only `portrait`/`landscape` are supported, no arbitrary aspect ratios.

| Output | Landscape | Portrait |
|---|---|---|
| Thumbnail | 1280 × 720 PNG | 1080 × 1920 PNG |
| Intro | 1920 × 1080 MP4, 30 fps | 1080 × 1920 MP4, 30 fps |
| Duration | 3–5 s, default 4 s | 3–5 s, default 4 s |

The intro's final state matches the thumbnail composition. Different resolutions and video compression can cause small pixel deviations. No linking to the original video, no audio track, no publishing. Uploading portrait covers depends on the platform.

## Brand kit contract

Minimal:

```yaml
---
name: My Brand
colors:
  primary: "#143878"
  secondary: "#542285"
  on-primary: "#FFFFFF"
typography:
  headline-display:
    fontFamily: Inter
    fontWeight: 800
  body-md:
    fontFamily: Inter
    fontWeight: 400
fonts:
  Inter: google
logo:
  primary: logo.svg
---
```

The example explains the schema; it is not a palette for real jobs. Always use the brand's own existing kit.

- `colors.primary` and `headline-display` or `headline-lg` are required.
- Opaque `#RGB`/`#RRGGBB` are supported, as are `white`/`black`. No HSL, OKLCH or alpha colours.
- References such as `{colors.primary}` or `{typography.headline-lg.fontFamily}` work; cycles are errors.
- `body-md` and `label-md` are optional; when missing, the brand's headline token is reused with a warning, no foreign font is invented.
- A single font family with an exact numeric weight. `lineHeight` as a unitless ratio from .8 to 2, or omitted. `letterSpacing` as a number, em, px or rem. No CSS font stacks.
- `fonts: {Inter: google}` or local lists `Inter: [{file: inter-800.ttf, weight: 800}]`. The required weight must exist. No silent system-font substitute. An explicit `system-ui` is allowed and logged as host-dependent.
- Google Fonts are stored locally during prepare. Mind licence notices when redistributing; licence responsibility for supplied fonts stays with the kit's owner. Existing local OFL/LICENSE files are copied along.
- `logo.primary` is optional. The logo sits unchanged on a white chip, never stretched or recoloured. SVG only with self-contained vector paths: no text, script or embedded image. PNG/JPG/WebP also work.
- A missing secondary colour gives a single-colour primary background. White and black are only neutral aids for legibility, image/logo chips and shadows; documented in the manifest.
- When text contrast is insufficient, a minimal black darkening is determined and documented. No additional brand colour is invented. Branding rules in the kit's prose are for the agent to judge; the renderer does not interpret them automatically.

## Results and revisions

A new build contains:

```text
manifest.json
composition/index.html
composition/assets/*
thumbnail.png
intro.mp4
```

`prepare` refuses any existing target folder. Failed preparations may leave a `PREPARE_INCOMPLETE.txt`; choose a new target folder to retry. `render` refuses existing exports and uses an exclusive lock. Actually look at the PNG and MP4 output: technical checks are no substitute for art direction.

Font and image files are local at render time. GSAP 3.14.2 is loaded from a pinned CDN; fully offline operation is not included yet. Downloads, AI image generation, automatic scene selection, cut-outs and multiple layout variants are not part of the CLI.

## Tests

```bash
npm test
```

13 automated tests cover brand references, required fields, image sources, Google/local fonts, portrait, frame extraction, existing results and local file delivery, among others. In addition, real landscape and portrait PNG/MP4 exports were rendered in the development environment with an **unconfirmed Storrito kit draft extracted by the brand-kit skill**. That confirms the technical integration, not the approval of that kit draft or its fit for a specific video not yet known.

## Installing as a skill

Put this whole folder next to the other Agentitos skills and make `SKILL.md` available in the agent environment. The export does not register itself with any service. No existing skills or the central repository state were changed.
