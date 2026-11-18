---
name: transcribe
description: Writes down every word of a recording with its time (ElevenLabs Scribe with "äh"s and noises, and who speaks where the pieces' voices tell it, with --speakers also where they do not); for a transcript and as other skills' transcription step.
license: MIT
metadata:
  title: "Transcribe"
  title-de: "Transkribieren"
  summary: "Every word of your recording with its time, the \"ähs\" and who speaks included."
  summary-de: "Jedes Wort deiner Aufnahme mit seiner Zeit, samt „Ähs“ und wer spricht."
  ask: "Upload a video or an audio file. I write down every word with its time; tell me if several people speak and how many."
  ask-de: "Lade ein Video oder eine Audiodatei hoch. Ich schreibe jedes Wort mit seiner Zeit auf; sag mir, ob mehrere Leute sprechen und wie viele."
  placeholder: "Upload a video or an audio file"
  placeholder-de: "Video oder Audiodatei hochladen"
  inputs: "video, audio"
---

# transcribe

`<skill>` is the folder of this file. Run `node <skill>/tools/transcribe.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## What it needs

Node 20+, ffmpeg and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tool finds it at `http://sprite.internal`). About 0.37 cents a minute (22 cents an hour, as OpenRouter billed Scribe on 2026-11-18), twice that where `--speakers` needs its second transcription. When something is missing, say so in one sentence; never install it.

## The words

The recording comes as a line `video: uploads/<file>` or `audio: uploads/<file>`.

```bash
node <skill>/tools/transcribe.mjs uploads/<file> --out transcribe/<name>/words.json
node <skill>/tools/transcribe.mjs uploads/<file> --out transcribe/<name>/words.json --speakers [--speakers-n 3] [--lang de]
```

- Without `--speakers`: ElevenLabs Scribe v2, every word as spoken, `"kind": "word" | "filler" | "event"` ("äh", "[laughs]"), 20 ms timings with the real pauses. For cutting, captions, anything timed to the word. Every word's time is checked against the recording's own sound: the few the recognizer squeezed, drew over a pause or put into silence are moved to where the voice is (`"by": "sound"`), a stretch that stays doubtful is heard again alone (`"by": "second hearing"`). Then the edges of all words are set where their sound begins and ends: Scribe starts a word about 60 ms late and ends one in eight more than 100 ms early, so a cut or a caption by its own times comes after the word has begun. The summary line says how many words lie where the voice is and which spots stay doubtful.
- Who speaks, without `--speakers`: Scribe names the voice of every word, but only within one request, and a long recording goes in pieces side by side (ten minutes each, five on a Sprite). Where that is enough, the words carry `"speaker": "A"`, `"B"`, … in the order they first speak and the JSON `"speakers": {"by": "scribe", "people": 2, …}`: a recording of one piece (up to 12 minutes, 7 on a Sprite), or one where some piece names two voices, none names more, and the sound puts every voice of a piece to one of those two people, near enough to be that one and clearly nearer than to the other. Else the words carry no speaker, and the summary line says why ("Who speaks is not in it: …") and what `--speakers` does about it. Never take a missing speaker for one voice. Measured on 2026-11-18 in five-minute pieces: 12 of 16 two-voice recordings got speakers (98.7 % of the words right), none of 12 with more voices, none of 4 with one voice: pieces of one voice each are not told from two people who take turns (`--speakers` settles it, `--speakers-n 1` when you know it is one person). The sound alone takes someone who sounds like one of the two for that one in about one case of seven; what keeps a third person out is the model naming three voices in some piece, so do not rely on the speakers of a recording where a third person may speak only now and then.
- `--speakers`: when who speaks matters (an interview, a podcast). The same, and where the pieces' voices cannot be told to be the same people (a piece with three voices, two voices too alike, a voice unlike both people: 4 of 16 two-voice recordings, and every one with more voices) the recording is written down once more in requests of three quarters of an hour, each of which keeps its voices apart: twice the cost. Such a request has its own errors (on 2026-11-18 three people for two in one recording, 94 % right; a meeting of four 89 to 92 %). Where the long requests fail, for any reason, the speakers are Gemini's, as `--speakers` gave them before, laid on Scribe's words by their times (`"speakers": {"by": "gemini", "because": …}`, and the line says so; weaker: 85 % right for two voices, 59 % for four in one test); where that fails too, the words come without speakers and the line says why. `--speakers-n N` when the person said how many speak: `1` makes every word A without a further request, from three on the long requests at once, and more voices than N are merged into the nearest of the N that speak most. Where long requests share no words in their overlap (music, an ad), `"unlinked"` names the stretch and the line says the people may be fewer.
- `--speakers gemini`: Gemini 3.5 Transcribe instead, as `--speakers` was before: times to a tenth of a second, no kinds, no check against the sound, about half a cent a minute (0.47 cents on 2026-11-18). Only for what was built on it.
- `--lang de` when you know the language; else the model hears it.

The tool writes `{engine, model, duration, cost, speakers, timing, edges, words: [{text, start, end, kind, speaker, …}]}`; `"speakers"` is there when the words carry them; `"edges": "sound"` says the words' edges lie on the sound, and a skill that takes them times nothing a second time. Read the words: correct a misheard name (a product, an account like "storrito_com", a person) in `words.json` yourself, keeping the times.

## When a time looks wrong

A spot the summary calls doubtful, or one the person says is off (a caption too early, a cut into a word):

```bash
node <skill>/tools/timing.mjs sheet uploads/<file> transcribe/<name>/words.json --at 2:14
node <skill>/tools/timing.mjs check uploads/<file> <words.json> [--fix]
```

`sheet` draws six seconds of the sound around the moment: the waveform, in green where a voice is, every word as a box over its time, doubtful words in red; read the picture and set a wrong word's start and end in `words.json` to its voice. `check` measures words from anywhere against the sound, `--fix` moves the ones it contradicts. Words with one time each (start = end) it refuses: the sound cannot say which stretch of voice is which word, take them again with `transcribe.mjs`.

## For another skill

A skill runs the tool as a program, never imports its code: `TRANSCRIBE` naming `tools/transcribe.mjs`, else `<skill>/../transcribe/tools/transcribe.mjs` beside it, else `/home/sprite/skills/transcribe/tools/transcribe.mjs`. It reads the JSON from `--out`; the tool's progress goes to stderr, its last line on stdout is the summary or, with exit 1, the error in one sentence. Without the tool such a skill says: "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs)."

## In the chat

Speak the person's language and keep it short: how long the recording is, how many words, who speaks, and a few lines of the text; the whole text as a file when they want it. A question with buttons for the likely answers when you need one (one speaker or several), one question per block, the button that moves on `:class "primary"`. Never put a token, a path of your working files or a raw error into the chat.
