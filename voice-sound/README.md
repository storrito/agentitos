# voice-sound

The sound of a spoken voice for social media: a recording is measured, mended where the numbers give a reason, and brought to the loudness the platforms play at. It says what was wrong, what it did, and what it could not mend. No model, no key, no network: Node and ffmpeg. The voice step that the other agents of this collection run as a program instead of keeping filters and loudness numbers of their own.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/voice.mjs clean talk.mp4 out/talk.m4a --before out/talk-before.m4a   # mended, with the untouched sound as loud beside it
node tools/voice.mjs clean talk.mp4 out/talk.mp4 --for reels tiktok              # the picture kept, the sound new
node tools/voice.mjs measure talk.mp4                                           # what stands out, nothing changed
node tools/voice.mjs targets tiktok podcast                                     # what the platforms want of sound
```

Requirements: Node 20+ and ffmpeg (6.1 or later; the tests run with 9.0). No npm packages.

It is for one voice, or people talking in turn, with nothing laid under it. Music under the voice is taken for noise.

## measure

One streamed pass over the first audio stream at 48 kHz, whatever its length (three hours in under two minutes, 170 MB at its peak). It gives the numbers and, as `findings`, what stands out:

| finding | what is measured |
| --- | --- |
| `quiet`, `loud` | the speech's own loudness (its pauses left out), the true peak |
| `noise` | the level in the pauses against the speech, A-weighted; its kind: `hiss`, `rumble`, `hum`, `broadband`, or `changing` (traffic, voices, a keyboard) |
| `hum` | narrow lines at 50 or 60 Hz and their harmonics against their neighbours |
| `clipped` | samples piled up at a ceiling, also one below full scale (turned down after it clipped) |
| `uneven` | how far the level of 3-second phrases spreads; a step between two parts |
| `dull`, `harsh`, `boomy`, `thin`, `sibilant` | the speech's long-term spectrum against ANSI S3.5's average voice, beyond what voices differ by among themselves (±5 dB a band) |
| `narrow` | where the voice ends at the top: a 16 kHz source, a call |
| `rumble`, `thumps`, `clicks`, `dc` | energy under 80 Hz, low bursts, isolated spikes, an offset |
| `one-channel`, `inverted` | two channels against each other: one dead, one the other upside down (a phone's speaker would cancel the voice) |
| `roomy` | how long the sound hangs on after the voice stops |

Every threshold is a named constant in [`tools/lib/findings.mjs`](tools/lib/findings.mjs) with where its value comes from. Against 520 recordings with known faults (2026-11-19): band limits, codecs, clicks, clipping, an offset, hiss, hum, a quiet recording and the channel faults are named nearly always; mild tone faults in 0 to 38 % of the files, because a voice 6 dB off in one band is often still a normal voice; the room's time is right for small rooms and about half for large ones.

## clean

Three stages, each in a file of its own. A step runs only when `measure` gives a reason for it, with its strength taken from the measured numbers; a recording with nothing wrong gets a high-pass and its loudness.

**Repair** ([`tools/lib/repair.mjs`](tools/lib/repair.mjs)), one ffmpeg pass, the output in step with the input to the sample:

- Two channels become one voice: the live one, one of an inverted pair, else their mean.
- Clipped peaks are redrawn (`adeclip`), with headroom made first.
- A high-pass at 80 Hz, steeper when rumble or thumps stand out, never above 90 Hz (a low voice begins there).
- Hum: a narrow notch on every harmonic that was found, as deep as it stands over its surroundings.
- Clicks: `adeclick`, set over a plosive's release.
- Noise: `afftdn` with the shape of the recording's own noise, sampled from its longest pause (laid in front of the recording, sampled, cut off again). The aim is noise 45 dB under the speech; the reduction stops at 12 dB (`--denoise gentle` 6, `strong` 18), where a spectral filter starts to cost the voice more than the noise it removes.

**Tone** ([`tools/lib/tone.mjs`](tools/lib/tone.mjs)): a correction of what stands out, never a house sound. Each finding's band takes back half of its distance beyond ±5 dB from the average voice; cuts to 6 dB, boosts to 3 dB. No boost of the highs when the noise is close under the voice or the source is band-limited; a de-esser only for a sibilant voice. Of 42 clean recordings none got a step.

**Level** ([`tools/lib/level.mjs`](tools/lib/level.mjs)):

- A leveller, only where the phrases are uneven: slow gain towards the level most phrases have, at most ±8 dB and 3 dB a second, held through the pauses so that their noise is never raised on its own.
- A gentle compressor (2.5:1 from 4 dB over the speech's loudness).
- The loudness: gain, then a limiter at four times the sample rate, measured and corrected until the delivered file is within 0.3 LU of the target, its true peak measured after the encoding.

`--level plain` is the loudness and the limiter alone; `--level off` leaves the level to a skill that sets it itself. `--before <file>` writes the untouched sound at the output's loudness, to compare by ear. Beside the output, `<out>.json`: what was measured before and after, every step with its reason, what was left.

Ten minutes take about two minutes on one core and under 100 MB.

## targets

What each platform does with a video's sound, each fact with its basis (`official`: the platform's own page; `measured`: a named third party's test; `ads`: its number for ads; `unknown`), in [`tools/lib/targets.mjs`](tools/lib/targets.mjs), compared 2026-11-19. What is known is little: YouTube's player turns louder sound down to about −14 LUFS and never raises a quieter one (measured, not published); Spotify asks −14 LUFS and −1 dBTP; Apple Podcasts −16 LUFS ±1 and −1 dBTP; Meta's apps set the level at playback and publish no target; TikTok publishes nothing, and the often repeated "−14 LUFS" has no source.

The master for video follows from that: −14 LUFS as played on two speakers, true peak −1.5 dBTP aimed at and −1 accepted, measured after the encoding, a loudness range of 5 LU or under for a phone in a noisy place, 48 kHz, the voice the same in both channels. For sound alone (`podcast`): −16 LUFS and −1 dBTP. The standards for speech are quieter (EBU R 128 s2: −20 to −16; AES TD1008: −18): the master follows the platforms, and says so.

## What it was measured on

A lab corpus of 673 recordings (clean studio speech in German and English with 54 faults built in at known strengths, 80 pairs of clean and noisy speech, 60 real recordings: calls, phone takes, amateur readers, headsets in cafés), three quarters to tune on, one quarter kept apart. On the 205 recordings of the tuning part (2026-11-19, ffmpeg 9.0.2), the mean change against the recording as it was, and the share that got worse:

| | DNSMOS overall | NISQA | PESQ (with a reference) | worse by DNSMOS |
| --- | --- | --- | --- | --- |
| best-takes' levelling as it was | −0.09 | −0.15 | −0.28 | 31 % |
| screencast-cut's cleaning as it was | +0.04 | +0.22 | +0.17 | 14 % |
| `clean --level off` (repair and tone) | +0.11 | +0.35 | +0.23 | 3 % |
| `clean` | +0.10 | +0.32 | +0.09 | 4 % |

(Levelling changes a voice's dynamics, which PESQ counts as a difference from the reference: the last row's PESQ says that, not that it sounds worse.) All 33 real recordings tried landed within 0.2 LU of −14 LUFS with no true peak over −1 dBTP.

These are models' scores, not ears. Nobody had listened to the results when this was written.

## What it does not do (yet)

- **A room.** No ffmpeg filter takes reverberation out of a voice; it is named and left.
- **Noise that changes** (a café, traffic, a keyboard). A filter that learns one noise cannot follow it: on twelve real recordings of that kind the background's score moved from 2.72 to 2.74. A neural denoiser moved it to 3.56 (DPDFNet-2 in front of `clean`, in the lab); the skill does not use one.
- **What was not recorded**: a call's or a 16 kHz source's missing highs stay missing.
- **A second voice, music.** One voice at a time, nothing under it.
- **Its ears.** It measures. The person hears.

## ffmpeg's own faults

Found while building it, in ffmpeg 9.0.2 (4.4, 8.0 and 8.1 do not have them): `anlmdn` ends with a memory error on every input, so it is never used; `arnndn` writes its last 480 samples as invalid numbers unless the input is a whole number of 480-sample blocks, so its input is padded and its output cut back. A test asks every noise method for finite samples to the last one.

## From another skill

A skill runs the tool as a program, never imports its code: `VOICE_SOUND` naming `tools/voice.mjs`, else `../voice-sound/tools/voice.mjs` beside it, else `/home/sprite/skills/voice-sound/tools/voice.mjs`. `clean <in> <out> --json` prints the report and exits 1 with `{"error": "…"}`; `--level off` for a skill that levels itself, on the whole recording before it is cut (the noise is read in its pauses); `--mono` for a voice mounted as one track; `targets --json` for the numbers to aim at.
