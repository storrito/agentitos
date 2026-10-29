# screencast-cut

Cuts a screencast recorded from **several sources at the same time** (the screen, the webcam, a phone's screen or camera, the microphone: what [rragent](https://github.com/storrito/rragent)'s screencast recorder writes) into **one video that shows where the action is**. The sources go on one clock, the voice is cleaned and evened out, the shot switches between screen, phone and face and zooms in on what changes, waits play as timelapses, and every result stays long enough to see. The cut is a [HyperFrames](https://hyperframes.heygen.com) project, so the person sees it as a preview before anything is rendered; the render is that same project.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for rragent: the recording comes from its recorder, the words from its `transcribe` tool, the preview is a project of its `hyperframes` template, the video comes from its `render` tool.

```bash
node tools/screencast.mjs new screencast/demo artifacts/recordings/2026-10-23T11-04-56   # sources on one clock, voice, activity
# the transcribe tool: file screencast/demo/source/voice.m4a, words: true, names: "Storrito, storrito_com"
node tools/screencast.mjs words screencast/demo artifacts/notes/screencast-demo/voice.words.json   # → source/brief.md
node tools/screencast.mjs propose screencast/demo                                       # every sentence → proposal.json
node tools/screencast.mjs sheets screencast/demo --proposal                             # each keep's frames → sheets/keep-NN.jpg
# write screencast/demo/cut.json (the story, per keep what must be readable); the project tool: create demo, kind hyperframes
node tools/screencast.mjs build screencast/demo --out artifacts/demo/composition         # the preview beside the chat (--speed 1.15: faster)
node tools/screencast.mjs check screencast/demo                                         # the cut as text, and what to fix
node tools/screencast.mjs at screencast/demo 0:23                                       # what plays at 0:23 of the preview
node tools/screencast.mjs frame screencast/demo 0:23                                    # its source there, with a grid and the crop
# the render tool: demo → artifacts/demo.mp4
node tools/screencast.mjs finish screencast/demo artifacts/demo.mp4                     # at −14 LUFS, and demo.srt
```

Outside rragent the same works with any HyperFrames project folder (`--out <project>/composition`, then `hyperframes render` there) and any folder with a `recording.json` (below); `transcribe` takes the words from ElevenLabs Scribe when there is no `transcribe` tool.

Requirements: Node 20+, ffmpeg, the HyperFrames CLI, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (found at `http://sprite.internal/v1/gateway/list`; an rragent agent there has no key of its own). OpenRouter finds the face in the webcam (`google/gemini-3.8-flash`, three frames, under half a cent) and marks the captions' key words; without it the circle shows the webcam's middle. No npm dependencies. Built after [best-takes](../best-takes/): its cut points, levels, timelapses and finish, copied and adapted (agentitos' folders never import from each other); captions come from [captions](../captions/), called as a tool.

## The recording

A folder with the sources and a `recording.json`:

```json
{"started": {"webcam": 1792746297058, "phone-screen": 1792746297195, "screen": 1792746297331},
 "devices": {"mic": "Standard", "camera": "FHD Webcam"},
 "files": ["phone-screen.webm", "screen.webm", "webcam.webm"]}
```

The sources are `screen`, `webcam`, `phone` (the phone's camera), `phone-screen` and `audio` (the microphone alone), any of them; `started` is when each began, in milliseconds.

## How it works

1. **`new`** makes every source a video the preview and the renderer play well (H.264 at a steady 30 fps, a keyframe every second so every cut seeks at once, at most 2560 px wide; a phone's screen arrives with a varying frame rate). It puts them on **one clock**: the earliest start is 0, every other source starts as much later as `recording.json` says, and since every source carries the microphone, each is laid onto the main microphone by its sound (the best correlation of their loudness envelopes within ±1.5 s; a match under 0.5 keeps the recorded start). The **voice** is the clearest microphone (a source of sound alone first), on the recording's clock, rumble and hiss filtered out (`highpass`, `afftdn`). It measures **where each picture moves**, four times a second, from the same decoding that converts it (one read of each source; all sources at once): the share of changed pixels, the box around them, and which cells of a grid changed. While it converts it prints how far each source is, every ten seconds. Last, it finds the **face** in the webcam (`tools/lib/face.mjs`: three frames to a vision model, the middle answer kept as `face` in `sources.json`): the circle and the face view sit on it, not on the picture's middle (a person off to one side, a camera set high). A build finds it when `new` could not.
2. **`words`** takes the words rragent's `transcribe` tool wrote (`words: true`: every word with its times and confidence, the misheard names corrected from the conversation and the names passed); **`transcribe`** takes them from ElevenLabs Scribe instead. Words the recognizer squeezed or stretched are put where the voice is (best-takes' `retime`), sentences written twice dropped. The voice between the words is lowered by `--duck` dB (10 by default: keyboard, mouse, the room), with 60 ms ramps. `source/brief.md` is the rules of a good screencast cut, every sentence with how much each source moves in it, and every word, numbered.
3. **`propose`** drafts `proposal.json`: every sentence a keep, `"hold": 2.5` after "posted", "there it is", a wait where a picture moves between two keeps; no view, no zoom. **`sheets`** makes one image per keep (of `cut.json`, or of the proposal with `--proposal`): every video source in a row, at the keep's first, middle and last moment and where a screen changes almost whole, the screens with a grid of tenths, the times in the frames when ffmpeg can write text; it prints each keep's words and moments. The agent reads the brief, the words and the sheets and writes `cut.json`: the story, and per keep the view and the zoom it decides.
4. **`build`** plans the pieces as best-takes does (cuts in the quiet between words, fillers out, pauses over `--pause` cut where nothing moves and shown where something does, faster when long, every take at one level), plus:
   - **a hold after every keep**: `--tail` (0.45 s) after its last word, `--end` (1.5 s) after the last keep, a keep's `"hold"` (a result to see), never into the next words of the recording;
   - **waits**: the time from the word in `"waits"` to the next keep's first word plays at ×3 to ×10 (in 3–5 s) with a badge when anything on a screen changes in at least 15 % of it (a small change counts here: an agent's chat, a progress bar), else it holds 3 s before the cut; one over 50 s plays its first and last 20 s at ×10;
   - **the view** of each keep: the screen unless the agent names another (`view`; `auto` only on request: what moves most over the keep), the same for all its pieces, a pause inside it too, so the shot does not jump; a **wait** shows the keep's `waitView`, else the screen that changes most during it, the laptop's screen when none does, never the face or an idle phone;
   - **the zoom** is the agent's: `"zoom"` on a keep is a box `[x0, y0, x1, y1]` in 0–1 of the source, what must be readable (chosen from the keep's sheet), `"off"` or nothing the whole source. The box is made as large as the safe room allows (`layout.spread`: the safe box above the circle, beside it down to the captions, or all of it with `"circle": false`; never deeper than 30 % of the source's width across that room, nor more than twice its pixels), and the rest of the source shows around it out to the frame's edges above the captions, under the apps' bars and buttons too: what matters stays clear of them, what is only context may lie under them. A phone's screen is shown whole. Only on request, `"zoom": "auto"`, the tool guesses by what moved: a heat map of where the screen changed during the keep (cells of a 32-column grid; cells that always change or that change in step with the webcam's picture left out), the hottest region padded, at least 38 % of the source's width, at most half in a narrow frame, a crop per scene where the screen changes almost whole and settles. It knows where pixels changed, not what is being talked about, which is why it is not the default;
   - **the speed**: `--speed 1.15` plays the whole cut that much faster (kept in settings.json), the timelapses on top; the voice keeps its pitch (`atempo`), the words' times follow for the captions;
   - **the layout** (`tools/lib/layout.mjs`) comes from what the platforms the video goes to lay over it: `--platform reels,tiktok` (kept in settings.json), none for the usual ones of the frame, from agentitos' [platform-zones](../platform-zones/) (`tools/lib/zones.mjs` finds its tool: `PLATFORM_ZONES`, else beside this skill, else `/home/sprite/skills/platform-zones`). Everything that must be seen sits in its safe box, the captions' band at its bottom (the captions get the same platforms), and the shot takes the rest: in 9:16 the webcam's circle above the captions on the left, a phone's screen beside it, a screen across the whole width where no app has buttons on the right (a Story), else across the whole width above the buttons' column or inside the safe box, whichever shows it larger; in 4:5 and 1:1 the circle in the top right corner and the shot across the width below it; in 16:9 the shot across the width between the apps' bar at the top and the captions, the circle and the label over its corners where they meet. A 1:1 or 4:5 frame keeps room for two lines of captions, a 16:9 one for one. Room for captions and labels is kept only when the cut has them; a zoom takes the shape of the room, so a frame with more room (a Story) gets a taller crop. `face` is the webcam over the whole frame. The build says for which platforms it laid out;
   - **the sound** is the cleaned voice as one track for the whole cut (`tools/lib/tracks.mjs`, cut by ffmpeg at build time: each spoken piece at its take's gain with 10 ms fades, silence for the rest), through one bus (high-pass at 75 Hz, a gentle compressor, a −2 dB true-peak ceiling); the videos are muted. The webcam too is one track for the whole cut, every piece's moment at its speed, and one element shows it, moved into place at each piece as the circle or the face. A browser plays only about 75 media elements on a page (Chrome); with a clip per piece a cut of 35 pieces had 94 and its preview went silent at the 76th. Now only the screens' shots are one element each, and check warns past 70; `"music"` plays under it, lower while someone speaks;
   - labels (`"label"`), captions (clean subtitles unless `"captions"` names another style or is `false`), the brand's colour and font from `brand/DESIGN.md` (or `--brand`);
   - **behind the shots** each piece's own screen, 320 px wide, blurred and darkened, one track for the whole cut (`tracks.backdropTrack`), so that the room a shot leaves free is not a flat colour; `"background": "plain"` for the brand's background.
5. **`check`** lists the cut as it plays and what to look at: a piece that starts inside a word (✗), one that ends right after its last word because the next words follow at once, an end without a moment's hold, a result ("posted", "there it is") without 2 s of proof after it or with the face as its proof, over 6 s without words at their own speed (a wait not listed), a source that could not be laid onto the voice, and HyperFrames' own lint.
6. **`at`** answers a moment the person names in the preview: the piece, its keep, its time in the recording, its view and zoom, its words. **`frame`** saves that moment's source, whole, with a blue line every tenth and the shot's crop in red (`screencast/<name>/frames/`).
7. **`finish`** brings the rendered video to `--loudness` (−14 LUFS) with a gain and a limiter, the picture copied, and writes the subtitles (`.srt`).

## cut.json

```json
{
  "keep": [
    {"words": "296-301", "view": "phone-screen", "hold": 2.5, "label": "The result", "why": "the hook: the story live on the phone"},
    {"words": "12-31", "view": "screen", "label": "01 · Ask", "why": "the question to the agent"},
    {"words": "60-75", "view": "screen", "zoom": [0.3, 0.55, 0.75, 0.95], "why": "the prompt"},
    {"words": "190-205", "view": "phone-screen", "hold": 2.5, "why": "the reel is live"}
  ],
  "waits": [75, 205],
  "fixes": {"70": "storrito_com"},
  "captions": {"style": "hormozi", "highlight": [20, 70]},
  "music": {"file": "uploads/bed.mp3", "volume": 0.3}
}
```

| key | what |
| --- | --- |
| `keep[].words` | a range of word numbers from the brief, both ends included, or one number |
| `keep[].view` | `screen` (the default), `phone-screen`, `phone`, `face` (or `auto`, the tool's guess by what moves) |
| `keep[].zoom` | what must be readable: a box `[x0, y0, x1, y1]` in 0–1 of the source, shown as large as the safe room allows with the source around it; or `off` (the default: the whole source), or `auto` (the tool's guess) |
| `keep[].circle` | `false`: no webcam circle while the keep plays, the shot takes its room |
| `keep[].hold` | seconds the shot stays after its last word (default `--tail`, the last keep `--end`) |
| `keep[].label` | a short title in the frame while the keep plays |
| `keep[].waitView` | the view of a wait after this keep (`screen`, `phone-screen`, `phone`, `face`); else the screen that changes most during it |
| `keep[].hook` | `true`: a moment shown ahead that plays again in its place; its words may be in another keep too |
| `keep[].pauses` / `sounds` / `gain` | as in best-takes: `"keep"` plays its pauses / fillers as they are; dB on top of the evened-out level |
| `waits` | word numbers after which the time up to the next keep plays as a timelapse |
| `fixes` | the captions' spelling by word number; `""` drops a word from the text |
| `captions` | written by `captions`: the style and the key words; `false` for none (default: clean subtitles) |
| `background` | `plain`: the brand's background behind the shots instead of the blurred screen |
| `music` | `file`, `volume` (0–1, default 0.35), `from` (seconds into the file) |
