# transcribe

The words of a recording (audio or video), each with its time, through [OpenRouter](https://openrouter.ai): the one transcription of agentitos. [captions](../captions/), [best-takes](../best-takes/), [video-descriptions](../video-descriptions/), [clips](../clips/), [kinetic-lyrics](../kinetic-lyrics/), [launch-video](../launch-video/) and [screencast-cut](../screencast-cut/) run its tool as a program instead of each keeping a copy that drifts.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/transcribe.mjs talk.mp4 --out words.json                              # Scribe: words, fillers, noises
node tools/transcribe.mjs podcast.m4a --out words.json --speakers --speakers-n 2  # Gemini: who speaks
node tools/timing.mjs check talk.mp4 words.json [--fix]                         # words from anywhere against the sound
node tools/timing.mjs sheet talk.mp4 words.json --at 2:14                        # one spot as a picture
node --test tools/test.mjs                                                       # the timing check and the edges, no request
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

## Word times against the sound

A recognizer writes the words well and times most of them well, not all: next to a noise it squeezes a word into 40 ms, it draws a word's start back over the pause before it (or its end over the pause after), now and then it puts one into silence. Some give one time per word and no end at all. Everything timed to the word (a cut between two words, a caption) goes wrong at exactly those words, and they are rare enough that nobody looks. So after Scribe the tool checks every word against the recording's own sound (`tools/lib/timing.mjs`; not with `--speakers`, whose tenths of a second are for finding moments):

1. **Without lengths, no times.** When more than 30 % of the words (of 20 or more) come with start = end, the tool fails in one sentence instead of writing them: the sound says where a voice is, not which word it is, so such times can only be spread by letter counts, a guess at every word.
2. **The sound.** ffmpeg decodes the file once to 16 kHz mono, read as it streams (an hour is 360,000 frames, not 115 MB in memory); the loudness of every 10 ms, smoothed over 30 ms. A frame is voice above 8 % of loud speech (the 95th percentile), holes under 80 ms closed, stretches under 60 ms dropped. Stretches under 150 ms apart are one island; an island's weight is its loudness summed over its time.
3. **The check.** A word is wrong when it is squeezed (under 60 ms for two letters or more), drawn over a pause (its voice sets in 0.3 s after its start, ends 0.45 s before its end, or it lasts longer than such a word is said: 0.12 s a letter plus 0.35 s, 0.8 s at least) or in silence. All other words stay exactly as Scribe timed them.
4. **The repair**, only of those, between their well-timed neighbours: a squeezed word or one in silence goes onto the voice between the words around it; a run of squeezed words gets one island each when there are as many, else they share the voiced time by their letters; a word with one silent end keeps its other end and gets the voice next to it. Clicks and breaths in a pause are islands too, but light ones: an island counts when it weighs a third of the heaviest (inside a word's own time a sixth, so a soft start or a stutter counts). Every moved word gets `"by": "sound"`. Where the sound leaves a choice (words sharing an island, a word with voice at both ends of too long a time, several islands for one word) the time is a guess and the spot is doubtful.
5. **The second hearing** (`tools/lib/again.mjs`), of the doubtful spots and the words the check still contradicts: the spot with three words on either side and 0.35 s of sound around them is cut out (FLAC) and transcribed again alone, at most 8 spots per recording; a recognizer that lost its place in ten minutes of sound usually finds it in ten seconds. Its times are taken only when it wrote every doubtful word, each with a length, between the words around them, and the well-timed words of the context lie within 0.25 s of where they were; then `"by": "second hearing"`. Else the guess stays. Its cost is added.

6. **The edges** (`tools/lib/edges.mjs`), of all words, after the gross errors are out. Scribe times a word a little inside its sound: it begins a word 60 ms late in the middle and ends one in eight more than 100 ms early. In the stretch it left between two words, the word before ends where its sound stops and the word after begins where its sound sets in, each moved 0.4 s at most; where the sound runs through for half a second at most, the two meet where it is weakest. No edge moves inward, so an ending too soft to measure is not cut off. Quiet is what lies under 8 % of loud speech, or under twice the ground of the three seconds to either side (the 10th percentile), the larger: with noise, voices or music under the speech nothing is ever under 8 %.

The JSON gets `"timing": {"checked", "inVoice", "moved", "heardAgain", "edged", "doubtful": [word indices]}` and `"edges": "sound"`, by which best-takes, screencast-cut and kinetic-lyrics know not to time the words a second time; the summary line says the same in a sentence and names up to five doubtful words with their times.

Measured for the edges against the forced alignment of an earnings call (2,164 words, 2026-11-16): as Scribe gave them, 15.0 % of the starts were more than 100 ms late and 13.0 % of the ends more than 100 ms early; with the edges set by the sound 4.8 % and 4.7 %, no edge moved inward. A forced-alignment model of its own (MMS_FA, 1.2 GB) came to 8.6 % and 18 %. With pink noise 15 dB under the speech 5.7 % and 8.5 % (14.8 % and 14.1 % as given), with music 5 dB under it 8.3 % and 8.8 % (15.7 % and 12.1 %).

Measured on a 10:41 screencast voice with Scribe's 897 words: the check finds 2 of them doubtful, one a real error (Scribe's "I" starts half a second before the voice), one a stutter. With every word squeezed into 40 ms in turn (860 times), the repair puts 816 back over their whole word and 9 beside it, 6 of those flagged as doubtful; with a word's start or end drawn over a pause of 0.6 s or more next to it (230 times) it moves 208, and the 6 it puts beside their word are all flagged.

`tools/timing.mjs` is the same as a program: `check` for words from anywhere (`--fix` writes the repaired file), `sheet` draws a spot (ffmpeg's `showwavespic`, a green bar where a voice is, every word a box over its time, doubtful words red) for an agent to read.

## Output

```json
{"engine": "scribe", "model": "elevenlabs/scribe-v2", "duration": 63.4, "cost": 0.0061,
 "timing": {"checked": 152, "inVoice": 1, "moved": 2, "heardAgain": 0, "edged": 131, "doubtful": []}, "edges": "sound",
 "words": [{"text": "Hallo", "start": 0.42, "end": 0.71, "kind": "word"}, {"text": "zusammen", "start": 0.8, "end": 1.31, "kind": "word", "by": "sound"}, …]}
```

Times in seconds of the file. The tool prints one line on stdout: what it wrote (words, fillers, noises or voices, length, model, cost) and what to do next. Progress (retries, pieces) goes to stderr. An error is one sentence on stdout, exit 1.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `TRANSCRIBE` (the path of `tools/transcribe.mjs`), else beside it (`../transcribe/tools/transcribe.mjs`), else in the machine's clone (`/home/sprite/skills/transcribe/tools/transcribe.mjs`). Each caller keeps a small copy of the same runner, `tools/lib/transcribe.mjs`: it runs the tool into a temporary file, passes its progress lines to the caller's log and returns the JSON; without the tool it fails with "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs)."
