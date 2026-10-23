# screencast-cut

Cuts a screencast recorded from **several sources at the same time** (the screen, the webcam, a phone's screen or camera, the microphone: what [rragent](https://github.com/storrito/rragent)'s screencast recorder writes) into **one video that shows where the action is**. The sources go on one clock, the voice is cleaned and evened out, the shot switches between screen, phone and face and zooms in on what changes, waits play as timelapses, every result stays long enough to see, and secrets on screen are blurred. The cut is a [HyperFrames](https://hyperframes.heygen.com) project, so the person sees it as a preview before anything is rendered; the render is that same project.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for rragent: the recording comes from its recorder, the words from its `transcribe` tool, the preview is a project of its `hyperframes` template, the video comes from its `render` tool.

```bash
node tools/screencast.mjs new screencast/demo artifacts/recordings/2026-10-23T11-04-56   # sources on one clock, voice, activity
# the transcribe tool: file screencast/demo/source/voice.m4a, words: true, names: "Storrito, storrito_com"
node tools/screencast.mjs words screencast/demo artifacts/notes/screencast-demo/voice.words.json   # → source/brief.md
node tools/screencast.mjs propose screencast/demo                                       # a first cut → proposal.json
# write screencast/demo/cut.json; the project tool: create demo, kind hyperframes
node tools/screencast.mjs build screencast/demo --out artifacts/demo/composition         # the preview beside the chat
node tools/screencast.mjs privacy screencast/demo                                       # secrets found and blurred
node tools/screencast.mjs check screencast/demo                                         # the cut as text, and what to fix
node tools/screencast.mjs at screencast/demo 0:23                                       # what plays at 0:23 of the preview
node tools/screencast.mjs frame screencast/demo 0:23                                    # its source there, with a grid and the crop
# the render tool: demo → artifacts/demo.mp4
node tools/screencast.mjs finish screencast/demo artifacts/demo.mp4                     # at −14 LUFS, and demo.srt
```

Outside rragent the same works with any HyperFrames project folder (`--out <project>/composition`, then `hyperframes render` there) and any folder with a `recording.json` (below); `transcribe` takes the words from ElevenLabs Scribe when there is no `transcribe` tool.

Requirements: Node 20+, ffmpeg, the HyperFrames CLI, and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (found at `http://sprite.internal/v1/gateway/list`; an rragent agent there has no key of its own). No npm dependencies. Built after [best-takes](../best-takes/): its cut points, levels, timelapses and finish, copied and adapted (agentitos' folders never import from each other); captions come from [captions](../captions/), called as a tool.

## The recording

A folder with the sources and a `recording.json`:

```json
{"started": {"webcam": 1792746297058, "phone-screen": 1792746297195, "screen": 1792746297331},
 "devices": {"mic": "Standard", "camera": "FHD Webcam"},
 "files": ["phone-screen.webm", "screen.webm", "webcam.webm"]}
```

The sources are `screen`, `webcam`, `phone` (the phone's camera), `phone-screen` and `audio` (the microphone alone), any of them; `started` is when each began, in milliseconds.

## How it works

1. **`new`** makes every source a video the preview and the renderer play well (H.264 at a steady 30 fps, a keyframe every second so every cut seeks at once, at most 2560 px wide; a phone's screen arrives with a varying frame rate). It puts them on **one clock**: the earliest start is 0, every other source starts as much later as `recording.json` says, and since every source carries the microphone, each is laid onto the main microphone by its sound (the best correlation of their loudness envelopes within ±1.5 s; a match under 0.5 keeps the recorded start). The **voice** is the clearest microphone (a source of sound alone first), on the recording's clock, rumble and hiss filtered out (`highpass`, `afftdn`). It measures **where each picture moves**, four times a second: the share of changed pixels, the box around them, and which cells of a grid changed.
2. **`words`** takes the words rragent's `transcribe` tool wrote (`words: true`: every word with its times and confidence, the misheard names corrected from the conversation and the names passed); **`transcribe`** takes them from ElevenLabs Scribe instead. Words the recognizer squeezed or stretched are put where the voice is (best-takes' `retime`), sentences written twice dropped. The voice between the words is lowered by `--duck` dB (10 by default: keyboard, mouse, the room), with 60 ms ramps. `source/brief.md` is the rules of a good screencast cut, every sentence with how much each source moves in it, and every word, numbered.
3. **`propose`** drafts `proposal.json`: every sentence a keep, neighbours of the same view joined; the view the source that moves most (something happens on it in at least a quarter of the sentence's time), else the face; a wait where a picture moves between two keeps; `"hold": 2.5` after "posted", "there it is". The agent turns it into `cut.json`: the hook first, the slips out.
4. **`build`** plans the pieces as best-takes does (cuts in the quiet between words, fillers out, pauses over `--pause` cut where nothing moves and shown where something does, faster when long, every take at one level), plus:
   - **a hold after every keep**: `--tail` (0.45 s) after its last word, `--end` (1.5 s) after the last keep, a keep's `"hold"` (a result to see), never into the next words of the recording;
   - **waits**: the time from the word in `"waits"` to the next keep's first word plays at ×3 to ×10 (in 3–5 s) with a badge when anything on a screen changes in at least 15 % of it (a small change counts here: an agent's chat, a progress bar), else it holds 3 s before the cut; one over 50 s plays its first and last 20 s at ×10;
   - **the view** of each keep (its `view`, or `auto`: what moves most over the keep), the same for all its pieces so the shot does not jump; a piece that shows a pause gets the view of what moves in it;
   - **the zoom**: the crop of the source where it changed most during the keep. `measure` keeps, four times a second, which cells of a 32-column grid changed and by how many pixels; a cell that changes in most frames around (±10 s) always moves (a spinner) and does not count. Over the keep each cell's heat is its average change in the frames it changed in, so what appears at once (an answer, a loaded page, typed words) outweighs what fidgets (a webcam's preview inside the screen, a ticking timer). The crop is the hottest cells' box, padded by 10 %, in the shape of the frame's content area, at least 38 % of the source's width; in a frame narrower than the source (a screen in 9:16) at most half its width, else no zoom when it would take over 55 % of the source; placed where it holds the most heat, centred on it. A phone's screen is shown whole. `frame` shows a moment's whole source with a grid and the crop, to set a `zoom` by hand;
   - **the layout** (`tools/lib/layout.mjs`): in 9:16 the screen or phone in the upper half (rounded), the webcam in a circle below it on the left, the band between free for the captions (whose lower edge sits at 70 % of the height), clear of the platforms' buttons; `face` is the webcam over the whole frame; 16:9, 1:1 and 4:5 alike;
   - **the sound** is the cleaned voice on a track of its own, an `<audio>` clip per spoken piece with its take's gain and 10 ms fades, all through one bus (high-pass at 75 Hz, a gentle compressor, a −2 dB true-peak ceiling); the videos are muted. `"music"` plays under it, lower while someone speaks;
   - labels (`"label"`), blurs (`privacy.json`), captions (`"captions"`), the brand's colour and font from `brand/DESIGN.md` (or `--brand`).
5. **`privacy`** sends frames of every shot of a screen (one every 3 s, at least one a shot) to a vision model (`google/gemini-3.6-flash`, `--model` for another) and asks for boxes around what must not be readable in public: a link with a token, keys, passwords, one-time codes, e-mail addresses, phone numbers, private chats and notifications; not account handles or the app's own interface. A box found in a shot is blurred for the whole shot (`backdrop-filter`, over a grey veil). `privacy.json` keeps what was found: `"off": true` leaves one readable, a box added by hand is blurred too. A few cents a run.
6. **`check`** lists the cut as it plays and what to look at: a piece that starts inside a word (✗), one that ends right after its last word because the next words follow at once, an end without a moment's hold, a result ("posted", "there it is") without 2 s of proof after it or with the face as its proof, over 6 s without words at their own speed (a wait not listed), a source that could not be laid onto the voice, shots not yet looked at for secrets, and HyperFrames' own lint.
7. **`at`** answers a moment the person names in the preview: the piece, its keep, its time in the recording, its view and zoom, its words. **`frame`** saves that moment's source, whole, with a blue line every tenth and the shot's crop in red (`screencast/<name>/frames/`).
8. **`finish`** brings the rendered video to `--loudness` (−14 LUFS) with a gain and a limiter, the picture copied, and writes the subtitles (`.srt`).

## cut.json

```json
{
  "keep": [
    {"words": "296-301", "view": "phone-screen", "hold": 2.5, "label": "The result", "why": "the hook: the story live on the phone"},
    {"words": "12-31", "view": "screen", "label": "01 · Ask", "why": "the question to the agent"},
    {"words": "60-75", "view": "screen", "zoom": [0.3, 0.55, 0.75, 0.95], "why": "the prompt"},
    {"words": "190-205", "view": "auto", "hold": 2.5, "why": "the reel is live"}
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
| `keep[].view` | `screen`, `phone-screen`, `phone`, `face`, or `auto` (the default) |
| `keep[].zoom` | `auto` (the default), `off`, or a box `[x0, y0, x1, y1]` in 0–1 of the source |
| `keep[].hold` | seconds the shot stays after its last word (default `--tail`, the last keep `--end`) |
| `keep[].label` | a short title in the frame while the keep plays |
| `keep[].pauses` / `sounds` / `gain` | as in best-takes: `"keep"` plays its pauses / fillers as they are; dB on top of the evened-out level |
| `waits` | word numbers after which the time up to the next keep plays as a timelapse |
| `fixes` | the captions' spelling by word number; `""` drops a word from the text |
| `captions` | written by `captions`: the style and the key words |
| `music` | `file`, `volume` (0–1, default 0.35), `from` (seconds into the file) |

## privacy.json

```json
{"found": [
  {"source": "screen", "from": 12.4, "to": 31.0, "what": "address bar with a login token", "box": [0.08, 0.02, 0.62, 0.06]},
  {"source": "phone-screen", "from": 205.1, "to": 216.8, "what": "notification", "box": [0.03, 0.01, 0.97, 0.09], "off": true}
]}
```

Times are the recording's, boxes in 0–1 of the source; `privacy` writes it, the person's changes stay.
