# voice-sound

The sound of a spoken voice for social media: a recording is measured, mended where the numbers give a reason, and brought to the loudness the platforms play at. It says what was wrong, what it did, and what it could not mend. No key and no network: Node and ffmpeg, and a small neural denoiser where the machine has one. The voice step that the other agents of this collection run as a program instead of keeping filters and loudness numbers of their own.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/voice.mjs clean talk.mp4 out/talk.m4a --before out/talk-before.m4a   # mended, with the sound as it was, as loud, beside it
node tools/voice.mjs clean talk.mp4 out/talk.mp4 --for reels tiktok              # the picture kept, the sound new
node tools/voice.mjs measure talk.mp4                                           # what stands out, nothing changed
node tools/voice.mjs targets tiktok podcast                                     # what the platforms want of sound
```

Requirements: Node 20+ and ffmpeg (6.1 or later; the tests pass with 8.0.1 and 9.0.2). No npm packages. Optional, and never installed by the tool: the denoiser below.

It is for one voice, or people talking in turn, with nothing laid under it. Music under the voice is taken for noise.

## measure

One streamed pass over the first audio stream at 48 kHz, whatever its length (three hours in under two minutes, 170 MB at its peak). It gives the numbers and, as `findings`, what stands out:

| finding | what is measured |
| --- | --- |
| `quiet`, `loud` | the speech's own loudness (its pauses left out), the true peak |
| `noise` | the level in the pauses against the speech, A-weighted; its kind: `hiss`, `rumble`, `hum`, `broadband`, or `changing` (traffic, voices, a keyboard) |
| `hum` | lines at 50 or 60 Hz and their harmonics, in the pauses alone: each must stand over the bins beside it in every part of the pauses and keep its level. With under 0.7 s of pause it is not judged, and the numbers say so (`hum.judged: false`): a voice's own pitch is a line too |
| `clipped` | samples piled up at a ceiling, also one below full scale (turned down after it clipped), in at least twelve separate runs |
| `uneven` | how far the level of 3-second phrases spreads; a step between two parts |
| `dull`, `harsh`, `boomy`, `thin`, `sibilant` | the speech's long-term spectrum against ANSI S3.5's average voice, beyond what voices differ by among themselves (±5 dB a band) |
| `narrow` | where the voice ends at the top: a 16 kHz source, a call |
| `rumble`, `thumps`, `clicks`, `dc` | energy under 80 Hz, low bursts, isolated spikes, an offset |
| `one-channel`, `inverted` | two channels against each other: one dead, one the other upside down (a phone's speaker would cancel the voice) |
| `roomy` | how long the sound hangs on after the voice stops |

Every threshold is a named constant in [`tools/lib/findings.mjs`](tools/lib/findings.mjs) with where its value comes from. Against 520 recordings with known faults: band limits, codecs, clicks, clipping, an offset, hiss, a quiet recording and the channel faults are named nearly always; mild tone faults in 0 to 38 % of the files, because a voice 6 dB off in one band is often still a normal voice; the room's time is right for small rooms and about half for large ones. Hum is named on 1 of 43 real recordings (a steady tone) and on none of 42 clean ones; built into short clips it is found in about a third, since most of them have too little pause to judge it.

## clean

Three stages, each in a file of its own. A step runs only when the numbers give a reason for it, with its strength taken from them; a recording with nothing wrong gets a high-pass under the voice and its loudness, its peaks held to fit.

**Repair** ([`tools/lib/repair.mjs`](tools/lib/repair.mjs)), the output in step with the input to the sample and exactly as long:

- Two channels become one voice: the live one, one of an inverted pair, else their mean.
- Clipped peaks are redrawn (`adeclip`), with headroom made first.
- A high-pass at 80 Hz, steeper when rumble or thumps stand out, never above 90 Hz (a low voice begins there).
- Hum: a notch 2 Hz wide on every harmonic that was found. A voice loses under 1 dB in any third-octave band through nine of them; the lines go down by 57 dB and more.
- Clicks: `adeclick`, set over a plosive's release.
- Noise, to bring it 45 dB under the speech and no further, by one of two methods:
  - *The denoiser*, where the machine has it (below). It runs when `measure` named noise in the pauses, or when a probe finds noise under the voice: up to 40 s of the recording are denoised and what was taken out is compared with what was kept; under 21 dB the recording counts as noisy. Its reduction is limited to what the recording needs, at most 18 dB (`--denoise gentle` 12, `strong` 24).
  - *ffmpeg alone*: `afftdn` with the shape of the recording's own noise, sampled from its longest pause (laid in front of the recording, sampled, cut off again), at most 12 dB (`gentle` 6, `strong` 18), where a spectral filter starts to cost the voice more than the noise it removes. It learns one steady noise and cannot follow one that changes; that is named and left.

**Tone** ([`tools/lib/tone.mjs`](tools/lib/tone.mjs)): a correction of what stands out, never a house sound. Each finding's band takes back half of its distance beyond ±5 dB from the average voice; cuts to 6 dB, boosts to 3 dB. No boost of the highs when the noise is close under the voice or the source is band-limited; a de-esser only for a sibilant voice. None of 42 clean studio recordings got a step; of 60 real ones (calls, amateur readers, phones), 18 did.

**Level** ([`tools/lib/level.mjs`](tools/lib/level.mjs)):

- A short loud sound that `measure` set aside from the voice (a knock, a clap, a bump: `bursts`) is first turned down over its stretch to 6 dB under the voice's loud frames, with 5 ms ramps, so that the gain is found for the voice and the limiters are not left to hold it down and duck the voice after it; the step says so, and what is left says it is still in the recording. On six clean readings at −25 to −65 LUFS with a burst, a clap, a thump or five bursts, as .wav and .m4a, the voice came out within 0.3 LU of −14 and of the same voice without the knock, and the 300 ms after a knock within 0.8 dB of it (before: up to 41 LU under, and up to 46 dB of hole). More knocks than measure lists (ten), and `--level off`, leave them as they are.
- A leveller, only where the phrases are uneven: slow gain towards the level most phrases have, at most ±8 dB and 3 dB a second, held through the pauses so that their noise is never raised on its own. A ten-minute reading that spread over 11.6 LU came out at 3.0.
- The loudness: gain, measured on the delivered file as it is encoded and corrected until it is within 0.3 LU of the target with its true peak at the ceiling aimed at, both in the same rounds (at most six encodings, the best kept): an encoder raises the true peak, the ceiling is lowered for it, and the gain is found again. Where both cannot be had, what is left says which gave way and by how much. On 20 recordings of the tuning part as .m4a, .mp3 and .wav every one lay within 0.2 LU of −14 with its true peak at −1.5 dBTP or under, in at most two encodings.
- The peaks. A voice at −14 LUFS needs its peaks 5 to 8 dB nearer its loudness than a raw recording has them. A slow limiter (10 ms ahead, 200 ms release) 2 dB over the ceiling takes most of that, a fast one at four times the sample rate the rest (about 2 dB), and the true peak is measured after the encoding, which raises it. There is no compressor: one with a normal attack lets the transients through to the limiter and only flattens the vowels.

Options: `--level plain` is the loudness and the fast limiter alone; `--level off` keeps the loudness the recording came with, for a skill that sets the level itself. `--mono` writes one channel whose loudness is the target as played on two speakers (the file measures 3 LU lower), where both get the channel whole (`pan=stereo|c0=c0|c1=c0`); ffmpeg's own upmix to two channels (`-ac 2`) gives each 3 dB less, and the voice plays 3 LU under the target (−17.0 for −14). `--before <file>` writes the sound as it was at the output's loudness, to compare by ear; its peaks are held by a limiter where that gain would push them over the ceiling, and the line says so. `--audio <n>` takes another of a video's audio streams than the first; a video keeps its picture in its own container (.mp4, .mov, .m4v, .mkv, .webm).

A quiet voice is raised to the target. Gain brings up, with the voice, what lies under it: its room, its noise and at the end the recorder's own steps (16 bits lie about −98 LUFS). A voice 40 dB or more under the target (under −54 LUFS as played, for −14) is delivered all the same, and what is left says plainly that it was recorded very low and that its noise and its room came up with it: twelve clean readings turned down and written at 16 bits kept NISQA 4.59 at 32 dB of gain (4.67 at their own level), 4.16 at 42, 3.75 at 47. Four real recordings of the corpus, phones held far off, lie 41 to 48 dB under and are delivered with that line (DNSMOS overall about as before or higher, one 0.4 lower with ffmpeg's noise method alone). A voice under ebur128's gate (−70 LUFS) is measured through a gain and that gain taken back.

It refuses, in one sentence: a recording in which `measure` finds no voice or under half a second of one, and a voice more than 70 dB under −14 LUFS (under −84 as played, whatever the target: `--loudness` does not move it). Twelve clean readings brought to −23 LUFS, turned down and written at 16 bits, then raised: at 47 dB of gain PESQ 3.15, NISQA 3.75 (4.50 and 4.67 at their own level); at 68 dB 1.43 and 1.63, the best NISQA 2.33; at 75 dB none of them scored 2 by NISQA. There the voice stands about 10 dB over the floor of 16 bits, and what comes up is that floor as much as the voice; where between 68 and 75 dB the line is drawn is a judgement.

Hum: where `measure` could not judge it (too little pause), the lines and `notJudged` in the JSON say so, never that it is gone. After a notch the result is measured again; where that still names hum, what is left says so with its numbers.

Beside the output, `<out>.json`: what was measured before and after, every step with its reason, what was left. The output and its report appear together at the end; a run that is ended by a signal stops its ffmpeg at once and leaves neither. While it runs, its working files lie in a hidden folder beside the output, at most 23 MB for a minute of sound.

Ten minutes take about half a minute on one core with ffmpeg alone (110 MB of memory) and about two minutes with the denoiser (285 MB).

## The denoiser

ffmpeg has no filter that follows a changing noise. Where a machine has sherpa-onnx's offline denoiser with the network DPDFNet-2 at 48 kHz, `clean` uses it; rragent's machines have it in their image. The tool finds the program through `VOICE_SOUND_DENOISER`, else as `sherpa-onnx-offline-denoiser` on the PATH, and the model through `VOICE_SOUND_DPDFNET`, else as `models/dpdfnet2_48khz_hr.onnx` beside the folder of the program's real file, else at `/opt/sherpa-onnx/models/`. It downloads neither. (sherpa-onnx and DPDFNet: Apache-2.0; onnxruntime, which runs the network: MIT.)

- It runs after clipping, the high-pass, hum and clicks are mended, and only on a recording that is noisy by the rules above: on recordings without noise it changes nothing, since it is not run.
- It writes 16 bits, so the sound goes to it at a sensible level and the gain is taken back; its output comes in whole 480-sample blocks, so each piece is padded and cut back; its delay is measured (0 samples on 21 real recordings) and taken out.
- It holds a recording in memory (about 80 MB a minute), so long ones go in pieces of 150 s cut at pauses, each started 3 s early (the network needs about 2.5 s to settle) and cross-faded over 1 s: under 300 MB whatever the length.
- When it fails, writes nothing, a wrong length, silence, clipping, numbers that are not finite or sound that does not follow its input, the stage falls back to ffmpeg's method for the whole recording and says so.

## targets

What each platform does with a video's sound, each fact with its basis (`official`: the platform's own page; `measured`: a named third party's test; `ads`: its number for ads; `unknown`), in [`tools/lib/targets.mjs`](tools/lib/targets.mjs), compared 2026-11-19. What is known is little: YouTube's player turns louder sound down to about −14 LUFS and never raises a quieter one (measured, not published); Spotify asks −14 LUFS and −1 dBTP; Apple Podcasts −16 LUFS ±1 and −1 dBTP; Meta's apps set the level at playback and publish no target; TikTok publishes nothing, and the often repeated "−14 LUFS" has no source.

The master for video follows from that: −14 LUFS as played on two speakers, true peak −1.5 dBTP aimed at and −1 accepted, measured after the encoding, a loudness range of 5 LU or under for a phone in a noisy place, 48 kHz, the voice the same in both channels. For sound alone (`podcast`): −16 LUFS and −1 dBTP. The standards for speech are quieter (EBU R 128 s2: −20 to −16; AES TD1008: −18): the master follows the platforms, and says so.

## What it was measured on

A lab corpus of 673 recordings: clean studio speech in German and English with 54 faults built in at known strengths, 80 pairs of clean and noisy speech, 60 real recordings (calls, phone takes, amateur readers, headsets in cafés). Three quarters to tune on, one quarter kept apart. On the 205 recordings of the tuning part (2026-11-20, ffmpeg 9.0.2), `clean` with its defaults against what two skills of this collection did to a voice before it. Scores from 1 to 5 by models that judge speech (DNSMOS, NISQA), each recording heard at the same level:

| | as recorded | best-takes' levelling | screencast-cut's cleaning | `clean`, ffmpeg alone | `clean` with the denoiser |
| --- | --- | --- | --- | --- | --- |
| 12 real recordings with a café or a keyboard, background | 2.72 | 2.18 | 2.93 | 2.82 | 3.50 |
| the same, NISQA | 2.37 | 2.13 | 2.44 | 2.35 | 3.25 |
| 60 noisy pairs, NISQA | 3.49 | 3.30 | 3.94 | 4.24 | 4.53 |
| 19 with built-in noise, hiss, wind, mixed, DNSMOS overall | 2.88 | 2.82 | 2.94 | 2.98 | 3.22 |
| 41 with faults that are not noise, DNSMOS overall | 3.19 | 3.28 | 3.28 | 3.32 | 3.34 |
| 42 clean recordings, NISQA | 4.67 | 4.58 | 4.66 | 4.70 | 4.70 |
| clearly worse than as recorded, of 163 that are not clean | – | 50 | 22 | 3 | 0 |

("Clearly worse": DNSMOS overall down by more than 0.15, which is more than the score moves by itself.) Against the clean reference where there is one, PESQ went from 2.74 to 2.99 with ffmpeg alone and to 3.25 with the denoiser; best-takes' levelling took it to 2.45. Every recording `clean` delivered lay between −14.2 and −13.8 LUFS with its true peak at −1.5 dBTP or under; best-takes' levelling landed within 0.5 LU on 170 of 204 and left 10 over −1 dBTP.

These are models' scores, not ears, on recordings the settings were tuned on.

## What it does not do (yet)

- **A room.** No ffmpeg filter takes reverberation out of a voice; it is named and left. The denoiser takes some of it when it runs.
- **Noise that changes, on a machine without the denoiser** (a café, traffic, a keyboard): named and left.
- **Noise under the voice that the probe does not find**: two of the twelve café and keyboard recordings stayed over its threshold and got ffmpeg's method.
- **What was not recorded**: a call's or a 16 kHz source's missing highs stay missing.
- **A second voice, music.** One voice at a time, nothing under it.
- **Its ears.** It measures. The person hears.

## ffmpeg's own faults

Found while building it, in ffmpeg 9.0.2 (8.0.1 and 8.1.3 do not have them): `anlmdn` ends with a memory error on every input, so it is never used; `arnndn` writes its last 480 samples as invalid numbers unless its input is a whole number of 480-sample blocks, so where it is asked for (a model named in `VOICE_SOUND_RNNOISE`; the skill ships none) its input is padded and its output cut back. A test asks every noise method the machine can run for finite samples to the last one.

## From another skill

A skill runs the tool as a program, never imports its code: `VOICE_SOUND` naming `tools/voice.mjs`, else `../voice-sound/tools/voice.mjs` beside it, else `/home/sprite/skills/voice-sound/tools/voice.mjs`. `clean <in> <out> --json` prints the report and exits 1 with `{"error": "…"}`, a refusal included; `--level off` for a skill that sets the level itself, on the whole recording before it is cut (the noise is read in its pauses); `--mono` for a voice mounted as one track; `targets --json` for the numbers to aim at.
