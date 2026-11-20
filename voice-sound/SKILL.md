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

Node 20+ and ffmpeg (6.1 or later). No key, no network: it costs nothing and nothing leaves the machine. A machine may have a voice denoiser beside ffmpeg (rragent's machines do: the program `sherpa-onnx-offline-denoiser` with its model): the tool finds it and uses it for a noisy recording by itself, and works with ffmpeg alone where it is not there. When ffmpeg or one of its filters is missing, the tool says which; say so in one sentence instead of installing it, and never install the denoiser.

## The flow

The recording comes as a line `audio: uploads/<file>` or `video: uploads/<file>`. Ask nothing before the result: where it goes, if they wrote it, becomes `--for`; anything else they wrote ("leave the room in", "only make it louder") becomes an option below. `<name>` is a short slug of what it is (lowercase letters, digits, dashes).

### 1. Clean it

Say in one sentence that you are working on the sound. Then

```bash
node <skill>/tools/voice.mjs clean uploads/<file> artifacts/<name>.m4a --before artifacts/<name>-before.m4a [--for <platform…>]
node <skill>/tools/voice.mjs clean uploads/<video> artifacts/<name>.<its ending> --before artifacts/<name>-before.m4a [--for <platform…>]   # the picture kept as it is
```

A video's output keeps the upload's own ending (`IMG_0042.MOV` → `artifacts/<name>.mov`, `clip.webm` → `artifacts/<name>.webm`): the picture is copied into the same kind of file, and another ending is refused.

The tool measures the recording, mends what the numbers give a reason for and nothing else, and prints each step with its reason, the numbers before and after, and what it could not mend. A recording with nothing wrong gets a high-pass under the voice and its loudness, its peaks held to fit. `--before` writes the sound as it was, brought to the result's loudness, so that the two can be compared: louder always sounds better, and a comparison at two levels says nothing.

`--for` takes the platforms' names as platform-zones has them (`reels`, `tiktok`, `shorts`, `youtube`, `linkedin`, …) and `podcast`; without it the master for video (`targets` below). A video keeps its picture in its own kind of file (`.mp4`, `.mov`, `.m4v`, `.mkv`, `.webm`). When the line says the video has several audio streams, the first was taken: `--audio <n>` takes another. Where the refusal says no voice was found and names `--audio`, run it again with that `--audio <n>` before you ask anything: the voice is often in the second stream.

It refuses, in one sentence, a recording in which it finds no voice or under half a second of one, and a voice so quiet that little of it stands over the floor of its recording (more than 70 dB under the platforms' loudness). Pass the reason on in their words and ask for the recording they meant, or for one made closer to the microphone or with the recorder's input turned up; do not try to get round it (a lower `--loudness` does not: the bound is the recording's own level). A voice recorded very low but over that bound comes out at the target, and its line says that it was very low and that its noise and its room came up with it: pass that on as it is, with how to record it next time.

Where the lines say "Not judged: hum", say that whether it hums could not be told from this recording, never that it has none.

Where what is left says a knock (a clap, a bump) stays, say that it is still in the recording, at about the voice's level, and that it can be cut where the video is edited; the voice itself was brought to the loudness without it. Where the step says repair took one out, say that it is gone; never that one stays where what is left does not say so.

What it cannot mend it says, and you pass that on as it is, never softened:

- **The room** (a hall, an echoing kitchen): it stays. Next time closer to the microphone, a room with soft things in it.
- **Noise that changes** (traffic, voices, a keyboard, wind): with the denoiser on the machine it is taken down, by as much as the line says, and what remains remains; without the denoiser it stays nearly as it was.
- **A narrow source** (a call, a 16 kHz recording): what was not recorded is not brought back.

Two lines of the tool need a word of their own:

- A step that reads "the neural denoiser failed (…)": the result was made all the same, by ffmpeg's simpler method, and the noise may be less reduced than it could be. Say so in one sentence, and ask them to pass on to whoever runs this machine that voice-sound's neural denoiser fails on it (every recording falls back until it is mended; the reason stands in the `.json` beside the result, the `denoise` step's `fallback.reason`). Not the reason itself: it is a raw error. Do not run it again to try: it fails the same way until the machine is mended.
- A refusal of a video in a kind of file clean cannot put new sound into (`.avi`, `.ts`, `.3gp`, `.flv`, …): offer what the refusal names, its sound alone, cleaned, as `.m4a`, to lay under the picture where they edit the video, with a button for it; on their yes run `clean uploads/<video> artifacts/<name>.m4a --before artifacts/<name>-before.m4a`. Never turn their video into another kind of file yourself to get round it.

### 2. Let them hear it

You measured it, you did not hear it. Show both, the result first, with what you did in their words (from the steps' reasons, at most four points, no number they did not ask for), what stays as it is, and the question:

```hiccup
[:div
 [:p [:strong "After"]] [:audio {:src "artifacts/kueche.m4a" :controls true}]
 [:p [:strong "Before"] " (brought to the same loudness, to compare)"] [:audio {:src "artifacts/kueche-before.m4a" :controls true}]
 [:ul
  [:li "It was quiet and uneven: now every sentence is as loud as the videos around it."]
  [:li "The fridge's hum is turned down, the noise in the pauses is lower."]
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
| still noisy | `--denoise strong`, once: the noise step then runs even where the numbers named no noise, and may take up to 24 dB off with the denoiser (18 with ffmpeg alone) instead of 18 (12). Say that it may cost the voice some of its body |
| still noisy after `strong`, or the noise before → after did not move | nothing more here: say plainly that this tool took out of this recording's noise what it could, and how to record it next time (closer to the microphone, a quieter room). Never run it again with another option to try, never promise that more is possible |
| what is left says "The neural denoiser took this voice for noise …" | pass on what that line says, in their words: the better noise method would have taken part of the voice with the noise, so its result was not used and the simpler method did the noise this time. Say nothing more than that line does: neither that the noise cannot be taken out at all, nor that another run would take it out |
| "that is not my voice", too sharp, too dull | `--tone off` |
| it pumps, it breathes, too flat, "like the radio" | `--level plain`: as loud, with the recording's own dynamics (no evening out of its phrases) |
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

`measure` for "what is wrong with my sound?" and before advising how to record. Where it says that something was not judged (a hum, in a recording without pauses), say that, not that it is absent. `targets` when the person asks what a platform wants: each line says whether it is the platform's own word (`official`), someone's measurement (`measured`), its ads' number (`ads`) or not known (`unknown`); say "not known" where it says so. No platform publishes a loudness for organic video; never state one as theirs.

## For another skill

A skill runs the tool as a program, never imports its code: `VOICE_SOUND` naming `tools/voice.mjs`, else `<skill>/../voice-sound/tools/voice.mjs` beside it, else `/home/sprite/skills/voice-sound/tools/voice.mjs`. Without the tool such a skill says: "The voice's sound needs agentitos' voice-sound skill beside this one (or VOICE_SOUND naming its tools/voice.mjs)."

- `clean <in> <out> --json` writes `<out>` and `<out>.json` (what was measured before and after, every step with its `why`, what was `left`) together at its end; stdout is that JSON; a refusal or an error is exit 1 with `{"error": "…"}` and no output file. While it runs, its working files lie in a hidden folder beside `<out>`, about 23 MB for a minute of sound, gone at the end.
- A skill that sets the level itself (best-takes, take by take): `clean <in> <out.wav> --level off` mends and keeps the loudness the recording came with (`--level plain`: the target loudness by gain and the limiter alone). Clean the whole recording before it is cut: the noise is read in its pauses, which a cut removes.
- Loudness is always as played on two speakers. `--mono` writes one channel for a voice that is mounted as one track of a film: at a target of −14 LUFS that file measures −17.0 as ffmpeg measures a file of one channel, and plays at −14.0 where both speakers get the channel whole: mount it with `pan=stereo|c0=c0|c1=c0` (or `asplit,amerge`). ffmpeg's own upmix of one channel to two (`-ac 2`, `aformat=channel_layouts=stereo`, `amix` onto a stereo track) gives each speaker the channel 3 dB down: −17.0, 3 LU under the target.
- Loudness, peak and range numbers come from `targets --json` (`master.lufs`, `master.truePeakDbtp.aim` and `.max`, `master.rangeLu`), never from a number written into the skill.
- `measure <file> --json` for a check of its own (`findings`: `quiet`, `noise`, `hum`, `clipped`, `uneven`, `roomy`, …, each `some` or `strong`).

## UI in the chat

Speak the person's language and keep it short: one or two sentences and a block. Say what you did as what they will hear, not as filters ("the hum is turned down", never "notches at 50 Hz"), and only what the report shows: a hum was notched, not taken out; where what is left names it, some of it is still there, and you say so. A number only when they ask. Always say that you measured and did not hear. Never put a token, a path of your working files or a raw error into the chat.

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:send "text"` on a button sends that text as the person's next message. Links, sounds and videos point at `https://…`, `artifacts/…` or `uploads/…`. No text fields: for a change they type.

- One question per block, with buttons for the likely answers when a click is the whole answer, and a line under them saying that they can type anything else.
- A button only where a click makes you act at once. Never one that only leads to your next question ("Change something"): they type what to change.
- The button that moves on gets `:class "primary"`; the others stay plain. A button's text says what happens; its `:send` reads as the person's answer ("The sound is good"). A button that opens an artifact ends its text with " ↗".
- Several picks from one list are checkboxes with one button. Several questions that must all be answered, none depending on another's answer, are one block: a group of radio buttons per question (own `:name`, every `:value` saying what it answers, at most four groups) and one button whose `:send` holds `{checked}`.
