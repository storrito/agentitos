# transcribe

The words of a recording (audio or video), each with its time, through [OpenRouter](https://openrouter.ai): the one transcription of agentitos. [captions](../captions/), [best-takes](../best-takes/), [video-descriptions](../video-descriptions/), [clips](../clips/) and [kinetic-lyrics](../kinetic-lyrics/) run its tool as a program instead of each keeping a copy that drifts.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/transcribe.mjs talk.mp4 --out words.json                              # Scribe: words, fillers, noises
node tools/transcribe.mjs podcast.m4a --out words.json --speakers --speakers-n 2  # Gemini: who speaks
```

Requirements: Node 20+, ffmpeg, OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`). No npm packages.

## The two engines

| | default: ElevenLabs Scribe v2 | `--speakers`: Gemini 3.5 Transcribe |
| --- | --- | --- |
| words | as spoken, `kind`: `word`, `filler` ("äh", "um"), `event` ("[laughs]") | `speaker`: `A`, `B`, … by first appearance |
| timings | 20 ms, the real pauses between words | tenths of a second |
| pieces | 10-minute FLAC with 10 s overlap (through the gateway 5-minute MP3 at 48 kbit/s), at most three at once: a Sprite has little memory | 5-minute pieces with 20 s overlap, all at once (8 through the gateway); FLAC, MP3 when a piece would not fit OpenRouter's 50 MB or always through the gateway |
| cost | about half a cent a minute | about a cent a minute |
| for | cutting, captions, anything timed to the word | interviews, podcasts, finding moments |

`tools/lib/scribe.mjs` keeps each word once: a piece owns the time from the middle of its overlap with the one before to the middle of its overlap with the one after. `tools/lib/gemini.mjs` hands over at the longest pause in the overlap, and follows the voices across pieces: a speaker of a piece is the voice of the piece before that says the same words at the same time in their overlap. `--speakers-n N` caps the voices: the words of any voice beyond the N that say the most go to the nearest (in time) of those. `--lang de` passes the language to the model (both); without it the model hears it.

Requests that fail with 429 or 5xx, or time out, are tried three times.

## Output

```json
{"engine": "scribe", "model": "elevenlabs/scribe-v2", "duration": 63.4, "cost": 0.0061,
 "words": [{"text": "Hallo", "start": 0.42, "end": 0.71, "kind": "word"}, …]}
```

Times in seconds of the file. The tool prints one line on stdout: what it wrote (words, fillers, noises or voices, length, model, cost) and what to do next. Progress (retries, pieces) goes to stderr. An error is one sentence on stdout, exit 1.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `TRANSCRIBE` (the path of `tools/transcribe.mjs`), else beside it (`../transcribe/tools/transcribe.mjs`), else in the machine's clone (`/home/sprite/skills/transcribe/tools/transcribe.mjs`). Each caller keeps a small copy of the same runner, `tools/lib/transcribe.mjs`: it runs the tool into a temporary file, passes its progress lines to the caller's log and returns the JSON; without the tool it fails with "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs)."
