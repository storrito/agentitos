# transcribe

The words of a recording (audio or video), each with its time, through [OpenRouter](https://openrouter.ai): the one transcription of agentitos. [captions](../captions/), [best-takes](../best-takes/), [video-descriptions](../video-descriptions/), [clips](../clips/), [kinetic-lyrics](../kinetic-lyrics/), [launch-video](../launch-video/) and [screencast-cut](../screencast-cut/) run its tool as a program instead of each keeping a copy that drifts.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/transcribe.mjs talk.mp4 --out words.json                              # Scribe: words, fillers, noises; speakers where two people speak
node tools/transcribe.mjs podcast.m4a --out words.json --speakers [--speakers-n 3] # the speakers are wanted: long requests where the pieces cannot say
node tools/transcribe.mjs podcast.m4a --out words.json --speakers gemini          # Gemini, as --speakers was before
node tools/timing.mjs check talk.mp4 words.json [--fix]                         # words from anywhere against the sound
node tools/timing.mjs sheet talk.mp4 words.json --at 2:14                        # one spot as a picture
node --test tools/test.mjs                                                       # the timing check, the edges, who speaks: no request
```

Requirements: Node 20+, ffmpeg, OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs` asks `http://sprite.internal/v1/gateway/list`). No npm packages.

## The two engines

| | ElevenLabs Scribe v2 (default, and `--speakers`) | `--speakers gemini`: Gemini 3.5 Transcribe |
| --- | --- | --- |
| words | as spoken, `kind`: `word`, `filler` ("äh", "um"), `event` ("[laughs]"); `speaker`: `A`, `B`, … by first appearance where they can be told | `speaker`: `A`, `B`, … by first appearance |
| timings | 20 ms, the real pauses between words | tenths of a second |
| pieces | 10-minute FLAC with 10 s overlap (through the gateway 5-minute MP3 at 48 kbit/s), at most three at once: a Sprite has little memory. For `--speakers`, where those cannot say who is who: 45-minute MP3 at 48 kbit/s | 5-minute pieces with 20 s overlap, all at once (8 through the gateway); FLAC, MP3 when a piece would not fit OpenRouter's 50 MB or always through the gateway |
| cost | 0.37 cents a minute, 22 cents an hour (OpenRouter's cost on 2026-11-18), twice with the long requests | about half a cent a minute (0.47 cents on 2026-11-18) |
| for | cutting, captions, anything timed to the word; interviews, podcasts | what was built on it |

`tools/lib/scribe.mjs` keeps each word once: a piece owns the time from the middle of its overlap with the one before to the middle of its overlap with the one after. A last piece that would own under two minutes is none: the others are that much longer. The last piece is cut five minutes longer than the file's header says (ffmpeg stops where the sound does): a header that states less than there is, as an MP3 without its length can, loses nothing. `tools/lib/gemini.mjs` hands over at the longest pause in the overlap, and follows the voices across pieces: a speaker of a piece is the voice of the piece before that says the same words at the same time in their overlap. `--lang de` passes the language to the model (both); without it the model hears it.

Requests that fail with 429 or 5xx, or time out, are tried three times.

## Who speaks

Every request to Scribe asks for the voices (`diarize`, the same price): a word comes with the voice it was heard in, a number that holds within that one request. The speakers are `A`, `B`, … in the order they first speak; a noise carries the speaker of its voice. `tools/lib/voices.mjs` makes them of the voices in three ways, and Gemini is the fourth:

1. **One request**: its voices are its people, as the model told them apart, however little they say; a voice that only made noise is nobody. A recording of one piece (up to 12 minutes, 7 through the gateway), and a long request of the whole recording.
2. **Pieces side by side, by the sound** (the default, no further request). While the pieces are with the model the tool reads the sound once (ffmpeg, streamed, cut into blocks of a minute that up to four other threads work on; about 32 MB an hour kept) and takes a fingerprint of every voice of every piece from the sound of its own words: how high it speaks (the median of log2 F0 and its spread, autocorrelation over 40 ms, 60 to 400 Hz) and how it sounds (mean and deviation of MFCC 1 to 19). This holds for two people only, so a recording qualifies when every piece names two voices at most (a voice with under 5 s of speech does not count, its words go to the nearer person). The first piece with two voices gives the two people; every other piece is put to them, two voices the way round with the smaller distance (each number brought to mean 0 and deviation 1 over the recording's voices), one voice the nearer person. A decision is trusted when the worse way round is 1.15 times as far as the better, and when every voice sounds like the person it is put to: within 1.1 of them (a person is the mean of the voices put to them so far), the numbers taken in units of how much voices spread around their recording's mean (pooled over 316 voices of 32 recordings). A voice farther away is someone else, a third person, and the pieces cannot say who is who. Pieces of one voice each, and no piece of two: no speakers, since one person is not told from two who take turns (`--speakers` asks a long request, which keeps its voices apart by itself; `--speakers-n 1` says it is one person). Where the pieces cannot say, the words carry no speaker, and the line says why.
3. **Long requests, by the words** (`--speakers`, where 2 gave nothing; with `--speakers-n 3` or more at once). The recording once more in requests of 45 minutes, three at a time; one after the first is heard from five minutes before what it owns, and a voice of it is the person of the piece before that wrote the same words at the same time there (two shared words at least; one voice left over is the one person left over; any other is someone new). Where a stretch both heard holds no shared word at all (music, an ad), every voice after it is someone new: `"unlinked": [{from, to}]` names it and the line says the people may be fewer. `--speakers-n N` then caps the voices: the words of any voice beyond the N that say the most go to the nearest (in time) of those.
4. **Gemini's** (`--speakers`, where the long requests fail for any reason, a 413 or a time-out): Gemini 3.5 Transcribe as `--speakers` went before, its speakers laid on Scribe's words by their times (the word of Gemini's that overlaps most, else the nearest within a second, else none): `"speakers": {"by": "gemini", "people", "because"}`. Where Gemini fails too, no speakers, and the line names both failures.

A piece that fails calls the others off (their requests are aborted, none is begun after it); what the pieces answered before is counted in `cost`. `--speakers-n 1` makes every word A from the short pieces, without a further request.

How far a voice is from the person it is put to (finding the bound, 2026-11-18, on the cached answers of all 32 recordings, each voice named by the reference speaker of most of its words): a voice of one of the two people of a two-voice piece lies at a median 0.58 from that person's voice in another piece (95 % under 1.12, the longest-lasting voices nearest, the farthest 1.86); a voice of someone else at least 0.89 from the nearer of the two (median 1.41). The two overlap: of 73 voices of someone else put to the two people of another piece, 11 pass both the distance and the margin (15 %), and two people of one sex, or on a telephone line, lie as near as one person's own pieces. Both bounds were set and tested on the same 32 recordings, none held out. What keeps a third person out in the measurements below is the model naming three voices in some piece, not the distance: someone who sounds like one of the two and never speaks in a piece beside both is taken for that one. A person whose sound changes (another microphone, music under it) is refused.

Measured on the answers of the model, against references of who speaks when:

| | |
| --- | --- |
| 16 two-voice recordings (12 to 27 minutes), cached ten-minute pieces | 11 give speakers (the same 11 as with the margin alone), 17 of 17 decisions right, 99.02 % of the words with the right speaker, which is what each piece alone gives |
| the same, live through a Sprite's gateway in five-minute pieces as the tool cuts them (2026-11-18) | 12 give speakers, 41 of 41 decisions right, 98.7 % of the words (each piece alone 98.6 %); the other four: a piece with three voices, two margins of 1.08 and 1.10, a voice 1.63 from its person (without the distance it would have been decided right) |
| 12 recordings of more voices (4 to 15) | none get speakers, cached or live (live: all refused by a piece with three voices or more; cached, a meeting of four whose pieces never name more than two, by the distance 1.27) |
| 4 recordings of one voice (117 minutes of files) | none get speakers: no piece names two voices (the fourth, 68 minutes, has a piece where Scribe heard three). Before that rule 3 of 4 came out as one person, and so did 5 of 6 two-voice recordings spliced so that each piece held one of the two |
| made-up voices (the review's cases) | one voice a piece of two who take turns, someone else beside one of the two, alone, four people two a piece: no speakers; two who first speak alone and then together: right |
| `--speakers`, the long requests through the gateway (2026-11-18) | bodies of 11.8 to 21.7 MB all answered, in 25 to 64 s; a two-voice recording came back with three people (94.5 % right), meetings of four with 3 and 4 people (92.1 %, 88.8 %), a 68-minute monologue in two long requests with three |
| Gemini's speakers on Scribe's words (the long requests refused on purpose) | 85.1 % for two voices (4 people), 59.0 % for a meeting of four (11) |

A long request is a body of up to 16 MB, 22 MB as base64. `tools/lib/openrouter.mjs` keeps the 7 MB measured for the gateway on 2026-10-23 (8 MB was refused with 413) as `GATEWAY_MAX`, which other skills guard with; on 2026-11-18 the Sprites gateway answered bodies of 12 to 21.7 MB (on 2026-11-16 it ended a request of 127 minutes after about 130 s).

`--speakers gemini` is the way `--speakers` went before: Gemini's own speakers, linked through its 20 s of overlap, `--speakers-n N` as above.

## Word times against the sound

A recognizer writes the words well and times most of them well, not all: next to a noise it squeezes a word into 40 ms, it draws a word's start back over the pause before it (or its end over the pause after), now and then it puts one into silence. Some give one time per word and no end at all. Everything timed to the word (a cut between two words, a caption) goes wrong at exactly those words, and they are rare enough that nobody looks. So after Scribe the tool checks every word against the recording's own sound (`tools/lib/timing.mjs`; the speakers stay with the words through all of it; not with `--speakers gemini`, whose tenths of a second are for finding moments):

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
{"engine": "scribe", "model": "elevenlabs/scribe-v2", "duration": 1213.004, "cost": 0.0759,
 "speakers": {"by": "scribe", "people": 2, "pieces": 2, "linked": "sound", "margin": 1.65},
 "timing": {"checked": 4228, "inVoice": 0.9768, "moved": 281, "heardAgain": 0, "edged": 3373, "doubtful": [12, 27, …]}, "edges": "sound",
 "words": [{"text": "[laughs]", "start": 0.12, "end": 1.18, "kind": "event", "speaker": "A"}, {"text": "Yeah,", "start": 1.23, "end": 1.52, "kind": "word", "speaker": "A"}, …]}
```

Times in seconds of the file. `"speakers"` is there when the words carry them: `by` (`scribe` or `gemini`), `people`, and for Scribe the `pieces` they come from and how those were `linked` (`sound` with the smallest `margin` of a decision, `overlap` for the long requests, nothing for one request). Without it no word has a `speaker`. The tool prints one line on stdout: what it wrote (words, fillers, noises, voices, length, model, cost; without speakers, why) and what to do next. Progress (retries, pieces) goes to stderr. An error is one sentence on stdout, exit 1.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `TRANSCRIBE` (the path of `tools/transcribe.mjs`), else beside it (`../transcribe/tools/transcribe.mjs`), else in the machine's clone (`/home/sprite/skills/transcribe/tools/transcribe.mjs`). Each caller keeps a small copy of the same runner, `tools/lib/transcribe.mjs`: it runs the tool into a temporary file, passes its progress lines to the caller's log and returns the JSON; without the tool it fails with "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs)."
