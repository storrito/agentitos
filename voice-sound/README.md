# voice-sound

The sound of a spoken voice for social media: a recording is measured, mended where the numbers give a reason, and brought to the loudness the platforms play at. It says what was wrong, what it did, and what it could not mend. No key and no network: Node and ffmpeg, and a small neural denoiser where the machine has one. The voice step that the other agents of this collection run as a program instead of keeping filters and loudness numbers of their own.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/voice.mjs clean talk.mp4 out/talk.m4a --before out/talk-before.m4a   # mended, with the sound as it was, as loud, beside it
node tools/voice.mjs clean talk.mp4 out/talk.mp4 --for reels tiktok              # the picture kept, the sound new
node tools/voice.mjs measure talk.mp4                                           # what stands out, nothing changed
node tools/voice.mjs targets tiktok podcast                                     # what the platforms want of sound
```

Requirements: Node 20+ and ffmpeg (6.1 or later; the tests pass with 8.1.3, which rragent's machines run, and with 9.0.2). No npm packages. Optional, and never installed by the tool: the denoiser below.

It is for one voice, or people talking in turn, with nothing laid under it, in clips of a few seconds up to videos of a quarter of an hour. Music under the voice is taken for noise. It is built to be good enough for such clips and quick, not to mend every rare recording: what it meets and does not mend it names (see "What it does not do").

## measure

One streamed pass over the first audio stream at 48 kHz, whatever its length (three hours in under two minutes, 170 MB at its peak). It gives the numbers and, as `findings`, what stands out:

| finding | what is measured |
| --- | --- |
| `quiet`, `loud` | the speech's own loudness (its pauses left out), the true peak |
| `noise` | the level in the pauses against the speech, A-weighted; its kind: `hiss`, `rumble`, `hum`, `broadband`, or `changing` (traffic, voices, a keyboard) |
| `hum` | lines near 50 or 60 Hz and their harmonics, each where it really lies (`hum.fundamentalHz`, a line's `lineHz`: a recording played 2 % fast has its hum at 51 Hz). Judged in the pauses, where each line must stand over the bins beside it in every part and keep its level; with under 0.7 s of pause, from windows of 2.7 s over the whole recording, where a hum is a line a fraction of a hertz wide that is there all the time and a voice's pitch is smeared (`hum.from`: `pauses` or `whole`). A line counts only within 2.5 % of a multiple of the mains. Under 5.5 s of sound without a pause it is not judged, and the numbers say so (`hum.judged: false`) |
| `clipped` | samples piled up at a ceiling, also one below full scale (turned down after it clipped), in at least twelve separate runs; a DC offset is taken out first, and the few values a very low 16-bit recording takes are not read as a ceiling |
| `bursts` | a short loud sound far over the voice that is no voice (a knock, a clap, a bump; at most 0.2 s; also one in the voice's own band): set aside from every number that describes the voice (`speech.bursts` says where, every one of them), still counted in the file's loudness and true peak |
| `uneven` | how far the level of 3-second phrases spreads; a step between two parts |
| `dull`, `harsh`, `boomy`, `thin`, `sibilant` | the speech's long-term spectrum against ANSI S3.5's average voice, beyond what voices differ by among themselves (±5 dB a band) |
| `narrow` | where the voice ends at the top: a 16 kHz source, a call |
| `rumble`, `thumps`, `clicks`, `dc` | energy under 80 Hz, low bursts, isolated spikes, an offset |
| `one-channel`, `inverted` | two channels against each other: one dead, one the other upside down (a phone's speaker would cancel the voice) |
| `roomy` | how long the sound hangs on after the voice stops |

Every threshold is a named constant in [`tools/lib/findings.mjs`](tools/lib/findings.mjs) with where its value comes from. Against 520 recordings with known faults: band limits, codecs, clicks, clipping, an offset, hiss, a quiet recording and the channel faults are named nearly always; mild tone faults in 0 to 38 % of the files, because a voice 6 dB off in one band is often still a normal voice; the room's time is right for small rooms and about half for large ones. Hum is named on 3 of the 43 real recordings of the tuning part (each a steady line; two are of one session whose hum lies at 50.9 Hz) and on none of the 42 clean ones; built in, it is found in 39 to 42 of 42 files at its usual and strong levels and in 24 of 42 at its weak one. An offset is called clipped on none of 84 files, a clean reading turned down by 40 to 70 dB and written at 16 bits on none of 168.

`measure` also says whether what it took for speech is a voice (`voice.found`): a pitch in at least a tenth of those frames, or a level that moves at a syllable's pace (a whisper has no pitch); and where the noise in the pauses lies less than 6 dB under the speech it says yes whatever it reads, since no pitch can be read under noise that loud, and a noise raised is the lesser harm than a voice refused. It found a voice in all 2473 recordings of the tuning part, each of which holds one, and in 40 of 40 made-up voices under noise as loud as themselves. Noise alone is refused only where that is clear (steady, without pitch or rhythm, its pauses well under it); the rest is raised like a voice.

A knock in a recording used to set the voice's numbers: with one 30 ms burst in it, a quiet voice read 9 LU louder than it is, harsh, sibilant and uneven. Set aside, 143 of 144 made-up cases (a burst, a clap, a thump, five of them, at four levels of voice) read as the same voice without it, and so do 84 of 84 knocks and thumps a review made, those in the voice's own band among them; a shouted word, a laugh, a cough and a loud first word are never set aside. `speech.spans` gives the stretches `measure` took for speech.

## clean

Three stages, each in a file of its own. A step runs only when the numbers give a reason for it, with its strength taken from them; a recording with nothing wrong gets a high-pass under the voice and its loudness, its peaks held to fit.

**Repair** ([`tools/lib/repair.mjs`](tools/lib/repair.mjs)), the output in step with the input to the sample and exactly as long:

- The filters work in float from the first one on, whatever the file's format: ffmpeg's high-pass on 16-bit sound rounds it a second time and clips its overshoot (a voice 45 dB down at 16 bits: PESQ 2.78 with it, 3.49 without).
- What comes before the noise step (channels, clipping, the high-pass, hum, clicks) is done once, into one intermediate that the denoiser's probe, the denoiser and ffmpeg's noise method all read.
- Two channels become one voice: the live one, one of an inverted pair, else their mean.
- Clipped peaks are redrawn (`adeclip`), with headroom made first, in pieces at the same time on the machine's cores less one (the joined result is the one-piece result sample for sample; fewer at once where memory is short). On 126 clipped files redrawing scored higher than leaving them at every share of clipped samples (PESQ 1.45 → 2.15 at 15 to 20 %). Its time grows with the share and the length, so its window is chosen before it runs, from a prediction: the full 55 ms where that fits 150 s and once the length, else a coarser one (20 or 10 ms), and from 30 % clipped the full window or none, which the step and what is left say. No attempt is run to be thrown away, and the same file gets the same treatment whatever else the machine is doing. The 126 files took 637 s in all instead of 1587, each output the same file as before.
- A high-pass at 80 Hz, steeper when rumble or thumps stand out, never above 90 Hz (a low voice begins there).
- Hum: a notch 2 Hz wide on every harmonic that was found, at the frequency measured for it: a tenth of a hertz beside its line a notch still takes 20 dB, half a hertz beside it 7. A voice loses under 1 dB in any third-octave band through nine of them. The step says what was notched, never that the hum is gone.
- Clicks: `adeclick`, set over a plosive's release.
- Noise, to bring it 45 dB under the speech and no further, by one of two methods:
  - *The denoiser*, where the machine has it (below). It runs when `measure` named noise in the pauses, or when a probe finds noise under the voice: up to 40 s of the recording are denoised and what was taken out is compared with what was kept; from 8 to 21 dB the recording counts as noisy. Its reduction is limited to what the recording needs, at most 18 dB (`--denoise gentle` 12, `strong` 24).
  - *ffmpeg alone*: `afftdn` with the shape of the recording's own noise, sampled from its longest pause (laid in front of the recording, sampled, cut off again), at most 12 dB (`gentle` 6, `strong` 18), where a spectral filter starts to cost the voice more than the noise it removes. It learns one steady noise and cannot follow one that changes; that is named and left.
  - `--denoise gentle` or `strong` is the person's word that it is noisy: the step runs although nothing was measured, and `strong` goes to its cap whatever the aim needs, so it never writes what `auto` wrote. On the 42 clean recordings `strong` with the denoiser left the speech's level within 0.1 dB and cost PESQ 0.12 on average, 0.8 on one voice.

**Tone** ([`tools/lib/tone.mjs`](tools/lib/tone.mjs)): a correction of what stands out, never a house sound. Each finding's band takes back half of its distance beyond ±5 dB from the average voice; cuts to 6 dB, boosts to 3 dB. No boost of the highs when the noise is close under the voice or the source is band-limited; a de-esser only for a sibilant voice. None of 42 clean studio recordings got a step; of 60 real ones (calls, amateur readers, phones), 18 did.

**Level** ([`tools/lib/level.mjs`](tools/lib/level.mjs)):

- Where `measure` named a short loud sound (a knock, a clap, a bump: `bursts`), the mended sound is measured again: a knock that repair took out (a thump the high-pass removes, an offset's step) is said to be gone, and nothing is turned down there. A knock still there is turned down where it is loud, with 5 ms ramps: to 6 dB under the voice's loud frames in a pause, to the speech beside it on a word, never lower. So the gain is found for the voice, the knocks' stretches left out, and the limiters are not left to hold a knock down and duck the voice after it; what is left says the knock stays. On six clean readings at −25 to −65 LUFS with a burst, a clap, a thump or five bursts, as .wav and .m4a, the voice came out within 0.3 LU of −14 and within 0.4 of the same voice without the knock (before: up to 41 LU under). On twenty cases a review made (thumps on a word, pops at a word's start, an offset's step) nothing is turned down any more, where a first version left holes of up to 28 dB. `--level off` leaves knocks as they are.
- A leveller, only where the phrases are uneven: slow gain towards the level most phrases have, at most ±8 dB and 3 dB a second, held through the pauses so that their noise is never raised on its own. A ten-minute reading that spread over 11.6 LU came out at 3.0.
- The loudness: gain, measured on the delivered file as it is encoded and corrected until it is within 0.3 LU of the target with its true peak at the ceiling aimed at, both in the same rounds (at most six encodings, the best kept): an encoder raises the true peak, the ceiling is lowered for it, and the gain is found again. Where both cannot be had, what is left says which gave way and by how much. On 20 recordings of the tuning part as .m4a, .mp3 and .wav every one lay within 0.2 LU of −14 with its true peak at −1.5 dBTP or under, in at most two encodings.
- The peaks. A voice at −14 LUFS needs its peaks 5 to 8 dB nearer its loudness than a raw recording has them. A slow limiter (10 ms ahead, 200 ms release) 2 dB over the ceiling takes most of that, a fast one at four times the sample rate the rest (about 2 dB), and the true peak is measured after the encoding, which raises it. There is no compressor: one with a normal attack lets the transients through to the limiter and only flattens the vowels.

Options: `--level plain` is the loudness and the fast limiter alone; `--level off` keeps the loudness the recording came with, for a skill that sets the level itself. `--mono` writes one channel whose loudness is the target as played on two speakers (the file measures 3 LU lower), where both get the channel whole (`pan=stereo|c0=c0|c1=c0`); ffmpeg's own upmix to two channels (`-ac 2`) gives each 3 dB less, and the voice plays 3 LU under the target (−17.0 for −14). `--before <file>` writes the sound as it was at the output's loudness, to compare by ear: matched to the output as the output was levelled (to its voice where knocks stay), written, measured and corrected; its line gives that file's own loudness and true peak, and by how much it falls short where one limiter cannot make the untouched sound as loud. `--audio <n>` takes another of a video's audio streams than the first, and a refusal for no voice names it where the file has more than one; a video keeps its picture in its own container (.mp4, .mov, .m4v, .mkv, .webm).

A quiet voice is raised to the target. Gain brings up, with the voice, what lies under it: its room, its noise and at the end the recorder's own steps (16 bits lie about −98 LUFS). A voice 40 dB or more under the target (under −54 LUFS as played, for −14) is delivered all the same, and what is left says plainly that it was recorded very low and that its noise and its room came up with it: twelve clean readings turned down and written at 16 bits kept NISQA 4.59 at 32 dB of gain (4.67 at their own level), 4.16 at 42, 3.75 at 47. Four real recordings of the corpus, phones held far off, lie 41 to 48 dB under and are delivered with that line (DNSMOS overall about as before or higher, one 0.4 lower with ffmpeg's noise method alone). A voice under ebur128's gate (−70 LUFS) is measured through a gain and that gain taken back.

It refuses, in one sentence: a recording in which `measure` finds no speech, under half a second of it, or no voice in what it took for speech, and a voice more than 70 dB under −14 LUFS (under −84 as played, whatever the target: `--loudness` does not move it). Twelve clean readings brought to −23 LUFS, turned down and written at 16 bits, then raised: at 47 dB of gain PESQ 3.15, NISQA 3.75 (4.50 and 4.67 at their own level); at 68 dB 1.43 and 1.63, the best NISQA 2.33; at 75 dB none of them scored 2 by NISQA. There the voice stands about 10 dB over the floor of 16 bits, and what comes up is that floor as much as the voice; where between 68 and 75 dB the line is drawn is a judgement.

Hum: where `measure` could not judge it (a short recording without a pause), the lines and `notJudged` in the JSON say so, never that it is gone. After a notch the result is measured again; where that still names hum, what is left says so with its numbers.

Beside the output, `<out>.json`: what was measured before and after, every step with its reason, what was left. The output and its report appear together at the end; a run that is ended by a signal stops its ffmpeg at once and leaves neither. While it runs, its working files lie in a hidden folder beside the output, at most 23 MB for a minute of sound.

What it costs, measured on a Sprite (8 cores, 4 GB of which 0.9 GB were free, ffmpeg 8.0.1, 2026-11-20), written as .m4a:

| recording | length | ffmpeg alone | with the denoiser |
| --- | --- | --- | --- |
| a headset in a café | 15 s | 2.2 s | 5.8 s |
| | 60 s | 8.7 s | 17 s |
| | 5 min | 36 s | 74 s |
| | 15 min | 104 s | 216 s |
| a clean reader | 60 s | 7.9 s | 16 s (the probe; nothing is denoised) |
| clipped on 20 % of its samples | 15 s | 39 s | 34 s |

About an eighth of the length with ffmpeg alone and a quarter with the denoiser, with at most 230 MB in one process (the whole run holds more where several pieces run at once: see the denoiser below). The denoiser's pieces and the redrawing of clipped peaks run as many at once as the free memory allows: with more memory free the clipped clip took 16 s. Of a long recording's time without the denoiser most is the level stage, which encodes the file, measures it and encodes it again where the encoder raised the true peak over the ceiling (on a laptop 83 s of 15 minutes as .m4a, 22 s as .wav). `measure` alone takes 0.3 s for 15 s and 7 s for 15 minutes.

## The denoiser

ffmpeg has no filter that follows a changing noise. Where a machine has sherpa-onnx's offline denoiser with the network DPDFNet-2 at 48 kHz, `clean` uses it; rragent's machines have it in their image. The tool finds the program through `VOICE_SOUND_DENOISER`, else as `sherpa-onnx-offline-denoiser` on the PATH, and the model through `VOICE_SOUND_DPDFNET`, else as `models/dpdfnet2_48khz_hr.onnx` beside the folder of the program's real file, else at `/opt/sherpa-onnx/models/`. It downloads neither. (sherpa-onnx and DPDFNet: Apache-2.0; onnxruntime, which runs the network: MIT.)

- It runs after clipping, the high-pass, hum and clicks are mended, and only on a recording that is noisy by the rules above: on recordings without noise it changes nothing, since it is not run.
- It takes some voices for noise: a voice in a telephone's band, a video call's processed sound, a whisper, the quieter of two people talking at once. So the probe declines where its sample's speech frames came back lower (more than a fifth of them 6 dB down, or 1.5 dB in all) or where the "noise" it found is nearly as loud as the voice (under 8 dB), and every run is checked the same way afterwards, on the whole recording and on every 30 s of it (more than half of the speech frames 6 dB down, or 3 dB in all; a knock's frames left out): such a result is thrown away, the stage goes on with ffmpeg's method or without a noise step, and the step and what is left say so. Of eleven cases that lost 1.7 to 18 LU of their voice before (seven recordings a review named, and made-up ones: two people at once, a whisper, a sung tone), every one keeps it now; of the noisy recordings none lost the denoiser (10 of 12 café and keyboard recordings, 55 of 60 noisy pairs, as before).
- It writes 16 bits, so the sound goes to it at the voice's level (its speech frames at −26 dBFS, a peak held where it would pass full scale) and the gain is taken back; its output comes in whole 480-sample blocks, so each piece is padded and cut back; its delay is measured (0 samples on 21 real recordings) and taken out.
- More threads make it little faster and more runs at once nearly as many times faster (on a Sprite, two minutes of sound: 47 s in one run, 30 s with four threads, 12 s as four pieces at once). So a recording of 40 s and more goes in pieces of 20 to 60 s, cut at pauses and on the program's 480-sample grid, as many at once as the cores less one and half of the free memory allow; the probe's windows too. Each piece starts 10 s early and is cross-faded over 1 s: on noise that changes the network took up to 17 s to settle, and with the 3 s of a first version one seam of a 15-minute recording stepped by 6.8 dB; with 10 s the largest step is 0.17 dB. A recording of 15 minutes held up to 860 MB on 8 cores. A failing piece ends the others, a signal ends them all.
- When it fails, writes nothing, a wrong length, silence, clipping, numbers that are not finite or sound that does not follow its input, the stage falls back to ffmpeg's method for the whole recording and says so.

## targets

What each platform does with a video's sound, each fact with its basis (`official`: the platform's own page; `measured`: a named third party's test; `ads`: its number for ads; `unknown`), in [`tools/lib/targets.mjs`](tools/lib/targets.mjs), compared 2026-11-19. What is known is little: YouTube's player turns louder sound down to about −14 LUFS and never raises a quieter one (measured, not published); Spotify asks −14 LUFS and −1 dBTP; Apple Podcasts −16 LUFS ±1 and −1 dBTP; Meta's apps set the level at playback and publish no target; TikTok publishes nothing, and the often repeated "−14 LUFS" has no source.

The master for video follows from that: −14 LUFS as played on two speakers, true peak −1.5 dBTP aimed at and −1 accepted, measured after the encoding, a loudness range of 5 LU or under for a phone in a noisy place, 48 kHz, the voice the same in both channels. For sound alone (`podcast`): −16 LUFS and −1 dBTP. The standards for speech are quieter (EBU R 128 s2: −20 to −16; AES TD1008: −18): the master follows the platforms, and says so.

## What it was measured on

A lab corpus of 673 recordings: clean studio speech in German and English with 54 faults built in at known strengths, 80 pairs of clean and noisy speech, 60 real recordings (calls, phone takes, amateur readers, headsets in cafés). Three quarters to tune on, one quarter kept apart. On the 205 recordings of the tuning part (2026-11-20, ffmpeg 8.1.3), `clean` with its defaults against what two skills of this collection did to a voice before it. Scores from 1 to 5 by models that judge speech (DNSMOS, NISQA), each recording heard at the same level:

| | as recorded | best-takes' levelling | screencast-cut's cleaning | `clean`, ffmpeg alone | `clean` with the denoiser |
| --- | --- | --- | --- | --- | --- |
| 12 real recordings with a café or a keyboard, background | 2.72 | 2.18 | 2.93 | 2.81 | 3.56 |
| the same, NISQA | 2.37 | 2.13 | 2.44 | 2.36 | 3.30 |
| 60 noisy pairs, NISQA | 3.49 | 3.29 | 3.92 | 4.23 | 4.54 |
| the same, PESQ against the clean original | 2.29 | 2.04 | 2.60 | 2.63 | 3.03 |
| 19 with built-in noise, hiss, wind, mixed, DNSMOS overall | 2.88 | 2.82 | 2.94 | 2.98 | 3.22 |
| 41 with faults that are not noise, DNSMOS overall | 3.19 | 3.28 | 3.28 | 3.33 | 3.34 |
| 31 other real recordings, DNSMOS overall | 3.12 | 3.06 | 3.13 | 3.17 | 3.22 |
| 42 clean recordings, NISQA | 4.67 | 4.58 | 4.66 | 4.69 | 4.69 |
| clearly worse than as recorded, of 163 that are not clean | – | 50 | 22 | 6 | 0 |

("Clearly worse": DNSMOS overall down by more than 0.15, which is more than the score moves by itself.) The six with ffmpeg alone: two recordings with a keyboard and one with strong wind, which its method cannot follow; two clips of 1.3 and 1.5 s; and a voice 47 dB under the target whose noise was learnt from a pause of 0.4 s. On four of the six NISQA or PESQ rose all the same. Against the clean original where there is one (119 recordings), PESQ went from 2.73 to 2.98 with ffmpeg alone and to 3.24 with the denoiser; best-takes' levelling took it to 2.45. A clean recording keeps PESQ 4.48 of 4.64 against itself through `clean`: what its high-pass and its limiters cost. Every one of the 205 was delivered, between −14.2 and −13.9 LUFS with its true peak at −1.5 dBTP or under; best-takes' levelling landed within 0.5 LU on 170 of 204 and left 10 over −1 dBTP.

These are models' scores, not ears, on recordings the settings were tuned on.

## What it does not do (yet)

- **A room.** No ffmpeg filter takes reverberation out of a voice; it is named and left. The denoiser takes some of it when it runs.
- **Noise that changes, on a machine without the denoiser** (a café, traffic, a keyboard): named and left.
- **Noise under the voice that the probe does not find**: two of the twelve café and keyboard recordings stayed over its threshold and got ffmpeg's method. Noise nearly as loud as the voice with none in the pauses is taken for a voice the denoiser rejects, and left; `--denoise strong` then takes it out (DNSMOS overall 1.8 → 2.8 on two such recordings).
- **Noise louder than the voice.** The check on the denoiser's run reads the loud frames as speech, and where they are the noise it throws good work away and falls back to ffmpeg's method (6 of 80 made-up recordings: traffic or a park 5 dB over the voice). A voice 15 dB under steady noise is taken for no voice.
- **What was not recorded**: a call's or a 16 kHz source's missing highs stay missing.
- **A knock.** It is turned down and stays in the recording: cutting is the editor's. One in the first tenth of a second is not set aside. After a knock that stays, an .m4a's voice can lie up to 3 dB off for 0.3 s (the encoder raises the knock's peak, and the ceiling comes down for the whole file). A steep high-pass that takes a thump out takes 4 to 5 dB off some low voices' lowest frames.
- **A second voice, music.** One voice at a time, nothing under it. The quieter of two people talking at once is noise to the denoiser: the probe declines an equal pair, but with noise in the pauses no probe runs, and one of two equal speakers came back 3.6 dB down. A second speaker 15 dB lower, in turn with the first, was left 25 dB under him in one of three recordings, with nothing said.
- **Hum off the usual.** A buzz at twice the mains with no line at the mains itself (100 or 120 Hz, a rectifier's) is not named where the recording has no pause; a hum more than 2.5 % off the mains is no hum.
- **Clipping.** A low steady wave's crests can read as clipped (one of 2473 recordings). A recording clipped on a third of its samples or more is redrawn only where that fits the time, else named and left.
- **Its ears.** It measures. The person hears.

## ffmpeg's own faults

Found while building it, in ffmpeg 9.0.2 (8.0.1 and 8.1.3 do not have them): `anlmdn` ends with a memory error on every input, so it is never used; `arnndn` writes its last 480 samples as invalid numbers unless its input is a whole number of 480-sample blocks, so where it is asked for (a model named in `VOICE_SOUND_RNNOISE`; the skill ships none) its input is padded and its output cut back. A test asks every noise method the machine can run for finite samples to the last one.

## From another skill

A skill runs the tool as a program, never imports its code: `VOICE_SOUND` naming `tools/voice.mjs`, else `../voice-sound/tools/voice.mjs` beside it, else `/home/sprite/skills/voice-sound/tools/voice.mjs`. `clean <in> <out> --json` prints the report and exits 1 with `{"error": "…"}`, a refusal included; `--level off` for a skill that sets the level itself, on the whole recording before it is cut (the noise is read in its pauses); `--mono` for a voice mounted as one track; `targets --json` for the numbers to aim at.
