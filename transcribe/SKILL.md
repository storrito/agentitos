---
name: transcribe
description: Writes down every word of a recording with its time (ElevenLabs Scribe with "äh"s and noises, or Gemini with --speakers saying who speaks); for a transcript and as other skills' transcription step.
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

Node 20+, ffmpeg and OpenRouter: `OPENROUTER_API_KEY`, or on a Sprite the gateway's OpenRouter connection (the tool finds it at `http://sprite.internal`). About half a cent a minute (Scribe) to a cent (Gemini). When something is missing, say so in one sentence; never install it.

## The words

The recording comes as a line `video: uploads/<file>` or `audio: uploads/<file>`.

```bash
node <skill>/tools/transcribe.mjs uploads/<file> --out transcribe/<name>/words.json
node <skill>/tools/transcribe.mjs uploads/<file> --out transcribe/<name>/words.json --speakers [--speakers-n 2] [--lang de]
```

- Without `--speakers`: ElevenLabs Scribe v2, every word as spoken, `"kind": "word" | "filler" | "event"` ("äh", "[laughs]"), 20 ms timings with the real pauses. For cutting, captions, anything timed to the word.
- `--speakers`: Gemini 3.5 Transcribe, `"speaker": "A"`, `"B"`, … in the order they first speak, times to a tenth of a second, an hour in about a minute. For an interview or a podcast. `--speakers-n N` when the person said how many speak: more voices than that are merged into the nearest of the N that speak most.
- `--lang de` when you know the language; else the model hears it.

The tool writes `{engine, model, duration, cost, words: [{text, start, end, …}]}`. Read the words: correct a misheard name (a product, an account like "storrito_com", a person) in `words.json` yourself, keeping the times.

## For another skill

A skill runs the tool as a program, never imports its code: `TRANSCRIBE` naming `tools/transcribe.mjs`, else `<skill>/../transcribe/tools/transcribe.mjs` beside it, else `/home/sprite/skills/transcribe/tools/transcribe.mjs`. It reads the JSON from `--out`; the tool's progress goes to stderr, its last line on stdout is the summary or, with exit 1, the error in one sentence. Without the tool such a skill says: "The words need agentitos' transcribe skill beside this one (or TRANSCRIBE naming its tools/transcribe.mjs)."

## In the chat

Speak the person's language and keep it short: how long the recording is, how many words, who speaks, and a few lines of the text; the whole text as a file when they want it. A question with buttons for the likely answers when you need one (one speaker or several), one question per block, the button that moves on `:class "primary"`. Never put a token, a path of your working files or a raw error into the chat.
