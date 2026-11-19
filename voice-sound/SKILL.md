---
name: voice-sound
description: Improves the sound of a spoken voice recording (audio, or a video's sound with its picture kept) for social media: the loudness the platforms play at, the level evened, noise, hum, clipping and clicks mended, the tone corrected where it stands out; it says in numbers what was wrong, what it did and what it could not mend. Use when the person wants a recording to sound better, and as the voice step of other skills (best-takes, screencast-cut, launch-video, …): they run its tool instead of keeping their own filters and loudness numbers.
license: MIT
metadata:
  title: "Voice sound"
  title-de: "Stimmklang"
  summary: "Your voice recording, mended and at the loudness the platforms play: less noise, an even level, a clear tone."
  summary-de: "Deine Sprachaufnahme, ausgebessert und in der Lautheit der Plattformen: weniger Rauschen, gleichmäßiger Pegel, klarer Klang."
  ask: "Upload a voice recording or a video of you talking, and tell me where it goes if you know. I mend its sound and you hear before and after."
  ask-de: "Lade eine Sprachaufnahme oder ein Video hoch, in dem du sprichst, und sag mir, wohin es geht, wenn du es weißt. Ich bessere den Ton aus, und du hörst vorher und nachher."
  placeholder: "Upload a recording"
  placeholder-de: "Aufnahme hochladen"
  inputs: "video, audio"
---

# voice-sound

You run in rragent. `<skill>` below is the folder this file is in. Run the tool as `node <skill>/tools/voice.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

It is for one voice (or people talking in turn) with nothing laid under it. Music under the voice, a finished film's mix: not for this tool, its noise step takes music for noise; a film's loudness is its own skill's `finish`.

## What it needs

Node 20+ and ffmpeg (6.1 or later). No key, no model, no network: it costs nothing and nothing leaves the machine. When ffmpeg or one of its filters is missing, the tool says which; say so in one sentence instead of installing it.

## The flow

The recording comes as a line `audio: uploads/<file>` or `video: uploads/<file>`. Ask nothing before the result: where it goes, if they wrote it, becomes `--for`; anything else they wrote ("leave the room in", "only make it louder") becomes an option below. `<name>` is a short slug of what it is (lowercase letters, digits, dashes).

### 1. Clean it

Say in one sentence that you are working on the sound. Then

```bash
node <skill>/tools/voice.mjs clean uploads/<file> artifacts/<name>.m4a --before artifacts/<name>-before.m4a [--for <platform…>]
node <skill>/tools/voice.mjs clean uploads/<video> artifacts/<name>.mp4 --before artifacts/<name>-before.m4a [--for <platform…>]   # the picture kept as it is
```

The tool measures the recording, mends what the numbers give a reason for and nothing else, and prints each step with its reason, the numbers before and after, and what it could not mend. A recording with nothing wrong only gets its loudness. `--before` writes the untouched sound as loud as the result, so that the two can be compared: louder always sounds better, and a comparison at two levels says nothing.

`--for` takes the platforms' names as platform-zones has them (`reels`, `tiktok`, `shorts`, `youtube`, `linkedin`, …) and `podcast`; without it the master for video (`targets` below).

What it cannot mend it says, and you pass that on as it is, never softened:

- **The room** (a hall, an echoing kitchen): it stays. Next time closer to the microphone, a room with soft things in it.
- **Noise that changes** (traffic, voices, a keyboard, wind): lowered a little at most.
- **A narrow source** (a call, a 16 kHz recording): what was not recorded is not brought back.

### 2. Let them hear it

You measured it, you did not hear it. Show both, the result first, with what you did in their words (from the steps' reasons, at most four points, no number they did not ask for), what stays as it is, and the question:

```hiccup
[:div
 [:p [:strong "After"]] [:audio {:src "artifacts/kueche.m4a" :controls true}]
 [:p [:strong "Before"] " (as loud as after, to compare)"] [:audio {:src "artifacts/kueche-before.m4a" :controls true}]
 [:ul
  [:li "It was quiet and uneven: now every sentence is as loud as the videos around it."]
  [:li "The fridge's hum is out, the hiss in the pauses is lower."]
  [:li "The kitchen's echo stays: no filter takes a room out of a voice."]]
 [:p "I measured this, I did not hear it. Does it sound right?"]
 [:button {:class "primary" :send "The sound is good"} "Sounds good"]
 [:p [:small "Or tell me what should be different."]]]
```

A video: `[:video {:src "artifacts/<name>.mp4" :controls true}]` for the result, the `before` as audio.

### 3. What they say, and what to run again

Run `clean` again on the upload (never on a result) with the option, and show both again.

| they say | option |
| --- | --- |
| watery, tinny, robotic, "under water", syllables swallowed | `--denoise gentle`; still so: `--denoise off` |
| still noisy | `--denoise strong`, and say that it may cost the voice some of its body |
| "that is not my voice", too sharp, too dull | `--tone off` |
| it pumps, it breathes, too flat, "like the radio" | `--level plain`: as loud as before, but the recording's own dynamics (no evening out, no compressor) |
| too loud, too quiet beside other videos | `--loudness <LUFS>` (a platform's own figure: `targets`) |
| the echo, the room | nothing here helps; say so, and how to record it next time |

### 4. After their yes

The download link of the result (`[:a {:href "artifacts/<name>.m4a" :download "<name>.m4a"} "Download"]`). A video they want posted goes to agentitos' **publish-video** (beside this skill); never call Storrito's schedule procedures yourself. `remember` what they want every time ("never touch my tone") and apply it to the next upload without asking.

## Only looking: measure and targets

```bash
node <skill>/tools/voice.mjs measure uploads/<file> [--json]     # what stands out in a recording, in numbers; changes nothing
node <skill>/tools/voice.mjs targets [platform…] [--json]         # what the platforms do with sound, and the master for them
node <skill>/tools/voice.mjs targets list
```

`measure` for "what is wrong with my sound?" and before advising how to record. `targets` when the person asks what a platform wants: each line says whether it is the platform's own word (`official`), someone's measurement (`measured`), its ads' number (`ads`) or not known (`unknown`); say "not known" where it says so. No platform publishes a loudness for organic video; never state one as theirs.

## For another skill

A skill runs the tool as a program, never imports its code: `VOICE_SOUND` naming `tools/voice.mjs`, else `<skill>/../voice-sound/tools/voice.mjs` beside it, else `/home/sprite/skills/voice-sound/tools/voice.mjs`. Without the tool such a skill says: "The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs)."

- `clean <in> <out> --json` writes `<out>` and `<out>.json` (what was measured before and after, every step with its `why`, what was `left`); stdout is that JSON, exit 1 with `{"error": "…"}`.
- A skill that levels itself (best-takes, take by take): `clean <in> <out.wav> --level off` mends and leaves the level alone (`--level plain`: the target loudness by gain alone). Clean the whole recording before it is cut: the noise is read in its pauses, which a cut removes.
- `--mono` for a voice that is mounted as one track of a film; its loudness is then the one channel's, 3 LU under what it plays at on two speakers.
- Loudness, peak and range numbers come from `targets --json` (`master.lufs`, `master.truePeakDbtp.aim` and `.max`, `master.rangeLu`), never from a number written into the skill.
- `measure <file> --json` for a check of its own (`findings`: `quiet`, `noise`, `hum`, `clipped`, `uneven`, `roomy`, …, each `some` or `strong`).

## In the chat

Speak the person's language and keep it short. Say what you did as what they will hear, not as filters ("the hum is out", never "four notches at 50 Hz"); a number only when they ask. Always say that you measured and did not hear. Never put a token, a path of your working files or a raw error into the chat.
